/**
 * ClaudeCodeFactoryAgent — LoopAgent backed by the Claude Agent SDK.
 *
 * This agent runs inside the factory process and uses
 * `@anthropic-ai/claude-agent-sdk`'s `query()` plus `createSdkMcpServer` +
 * `tool()` to expose each FactoryTool as an in-process callback. When a tool
 * callback returns a DONE / CLARIFICATION signal, the agent aborts the query
 * early and surfaces the corresponding AgentRunResult. Otherwise the query
 * runs to normal completion (maxTurns or no-more-tool-calls).
 *
 * Relationship to OpenRouterFactoryAgent:
 *   - Same prompt assembly (FilePromptLoader + assemble*Prompt helpers)
 *   - Same tool catalog (FactoryTool[])
 *   - Same exit signals (DONE_SIGNAL / CLARIFICATION_SIGNAL)
 *   - Different transport: Agent SDK instead of OpenRouter HTTP
 *
 * The factory's deterministic ralph loop is oblivious to which agent is
 * running — the LoopAgent contract (`run(context, tools)`) is identical.
 */

import {
  createSdkMcpServer,
  query as defaultQuery,
  tool,
  type Options,
  type Query,
  type SDKMessage,
  type SdkMcpToolDefinition,
} from '@anthropic-ai/claude-agent-sdk';

import type {
  AgentContext,
  AgentRunResult,
  ClaudeCodeAgentConfig,
  LoopAgent,
  ResolvedSkill,
} from './types';
import {
  assembleBootstrapPrompt,
  assembleImplementPrompt,
  assembleIteratePrompt,
  FilePromptLoader,
  type PromptLoader,
} from '../factory-prompt-loader';
import {
  CLARIFICATION_SIGNAL,
  DONE_SIGNAL,
  type FactoryTool,
  type ToolCallEntry,
} from '../factory-tool-builder';
import { jsonSchemaToZodShape } from '../factory-tool-schema-adapter';
import { logger } from '../logger';

const MCP_SERVER_NAME = 'factory';
const MAX_TOOL_USE_TURNS = 50;

/**
 * Built-in Claude Code tools the factory exposes to the model on the
 * Claude backend. These replace the custom `read_file` / `write_file`
 * factory tools — they operate on the SDK query's `cwd` (the factory
 * workspace), so the model uses native semantics for fs work and we
 * keep MCP focused on operations that genuinely need realm runtime
 * access (search_realm, validators, structured updates, signals).
 */
const NATIVE_FS_TOOLS = ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'];

/**
 * Factory tool names that are filtered out of the MCP catalog on the
 * Claude backend because the model has a native or boxel CLI
 * alternative — keeping them in the catalog would just be a duplicate
 * surface for the same operation. OpenRouter still gets these tools;
 * it has no native fs and no Bash.
 *
 * Each entry's replacement:
 * - `read_file`              → native `Read`
 * - `write_file`             → native `Write` / `Edit`
 * - `run_command`            → unused in practice (card-type schemas
 *                                are pre-loaded by the wiring); if ever
 *                                needed, the boxel CLI exposes
 *                                `boxel run-command` over Bash.
 * - `fetch_transpiled_module`→ Bash + `boxel read-transpiled <path>
 *                                --realm <url>`. Used only when a
 *                                validator reports a transpiled
 *                                line/column, so the marginal cost of
 *                                shelling out is negligible.
 * - `search_realm`           → Bash + `boxel search --realm <url>
 *                                --query '<json>' --json`. Single-quote
 *                                the JSON in shell to avoid expansion;
 *                                see the operations skill for examples.
 */
const CLAUDE_FILTERED_FACTORY_TOOLS = new Set([
  'read_file',
  'write_file',
  'run_command',
  'fetch_transpiled_module',
  'search_realm',
]);

let log = logger('factory-agent-claude-code');

type CapturedSignal =
  | { kind: 'done' }
  | { kind: 'clarification'; message: string };

export type ClaudeAgentQueryFn = (params: {
  prompt: string;
  options?: Options;
}) => Query;

export class ClaudeCodeFactoryAgent implements LoopAgent {
  private config: ClaudeCodeAgentConfig;
  private promptLoader: PromptLoader;
  private queryFn: ClaudeAgentQueryFn;
  // Emitted once (on the very first SDK `init` message) so the operator can
  // see which model the Agent SDK inherited from the user's Claude Code
  // install. Suppressed on every subsequent inner-loop iteration to keep
  // the log quiet.
  private modelLogged = false;
  // tool_use_id → tool name. SDK tool_result blocks identify which call
  // they correspond to by `tool_use_id` only, so we maintain this map
  // (populated from each assistant `tool_use` block as it streams) to
  // label tool-result lines in debug output. Without this, every
  // result message looks like an opaque `[user/tool-result]` and the
  // operator can't tell which tool actually ran.
  private toolUseIdToName = new Map<string, string>();

  constructor(
    config: ClaudeCodeAgentConfig = {},
    overrides?: {
      promptLoader?: PromptLoader;
      /** Override the SDK's `query()` — used by tests to avoid hitting the LLM. */
      queryFn?: ClaudeAgentQueryFn;
    },
  ) {
    this.config = config;
    this.promptLoader = overrides?.promptLoader ?? new FilePromptLoader();
    this.queryFn = overrides?.queryFn ?? defaultQuery;
  }

  async run(
    context: AgentContext,
    tools: FactoryTool[],
  ): Promise<AgentRunResult> {
    // Filter out factory tools the Claude backend doesn't need —
    // native Claude Code tools (Read / Write / Edit / Bash) cover the
    // workspace fs surface, and a few others (`run_command`) have a
    // boxel CLI alternative or are unused in practice. The shared
    // FactoryTool[] is built once for both backends; OpenRouter still
    // sees the full list because it has no native fs and no Bash.
    let mcpFactoryTools = tools.filter(
      (t) => !CLAUDE_FILTERED_FACTORY_TOOLS.has(t.name),
    );

    let systemPrompt = this.buildSystemPrompt(context, mcpFactoryTools);
    let userPrompt = this.buildUserPrompt(context);

    let toolCallLog: ToolCallEntry[] = [];
    let captured: CapturedSignal | undefined;
    let abortController = new AbortController();

    let sdkTools = buildSdkToolsFromFactoryTools(mcpFactoryTools, {
      onToolCall: (entry) => toolCallLog.push(entry),
      onSignal: (signal) => {
        captured = signal;
        abortController.abort();
      },
    });

    let mcpServer = createSdkMcpServer({
      name: MCP_SERVER_NAME,
      tools: sdkTools,
    });

    let allowedTools = [
      ...NATIVE_FS_TOOLS,
      ...mcpFactoryTools.map((t) => `mcp__${MCP_SERVER_NAME}__${t.name}`),
    ];

    let options: Options = {
      systemPrompt,
      mcpServers: { [MCP_SERVER_NAME]: mcpServer },
      // Enable native Claude Code fs / shell tools so the model can read
      // and write workspace files directly (Read / Write / Edit) and run
      // boxel CLI / shell helpers (Bash, Glob, Grep). Realm I/O still goes
      // through factory MCP tools — the ralph loop owns the realm-side
      // control plane, Claude Code is the LLM + native-tool surface.
      tools: NATIVE_FS_TOOLS,
      allowedTools,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      maxTurns: MAX_TOOL_USE_TURNS,
      // Anchor native fs tools to the factory workspace so relative paths
      // emitted by the model (e.g. `sticky-note.gts`) resolve inside the
      // mirror of the target realm, not the user's home directory.
      ...(this.config.workspaceDir ? { cwd: this.config.workspaceDir } : {}),
      // Isolate from the host user's Claude Code settings — we want
      // deterministic agent behavior regardless of whose machine this runs on.
      settingSources: [],
      abortController,
      debug: this.config.debug === true,
    };

    let q = this.queryFn({ prompt: userPrompt, options });

    try {
      for await (let message of q) {
        // Surface the actual model the Agent SDK picked (inherited from
        // the user's Claude Code install) so operators can tell at a
        // glance which model is driving the run. SDK fires an `init`
        // message at the start of every `query()` call — we only need it
        // once per factory run, guarded by `this.modelLogged`. Matches
        // the openrouter path's `Agent backend: openrouter (model=…)`
        // format for a single consistent log line across backends.
        if (
          !this.modelLogged &&
          message.type === 'system' &&
          (message as { subtype?: string }).subtype === 'init'
        ) {
          let modelName = (message as { model?: string }).model;
          if (modelName) {
            log.info(`Agent backend: claude (model=${modelName})`);
            this.modelLogged = true;
          }
        }
        if (this.config.debug) {
          this.debugLog(message);
        }
        if (captured) break;
      }
    } catch (error) {
      // An intentional abort from our signal-capture path is not an error.
      if (!captured) {
        throw error;
      }
    }

    if (captured?.kind === 'done') {
      return { status: 'done', toolCalls: toolCallLog };
    }
    if (captured?.kind === 'clarification') {
      return {
        status: 'blocked',
        toolCalls: toolCallLog,
        message: captured.message,
      };
    }

    // Stream ended without an explicit signal. Mirror OpenRouterFactoryAgent:
    // if the agent called at least one tool, treat as done; otherwise
    // needs_iteration so the orchestrator feeds validation failures back.
    return {
      status: toolCallLog.length > 0 ? 'done' : 'needs_iteration',
      toolCalls: toolCallLog,
    };
  }

  private buildSystemPrompt(
    context: AgentContext,
    tools: FactoryTool[],
  ): string {
    let skills = context.skills.map((s: ResolvedSkill) => ({
      name: s.name,
      content: s.content,
      references: s.references ?? [],
    }));

    let base = this.promptLoader.load('system', {
      targetRealmUrl: context.targetRealmUrl,
      skills,
    });

    // Two tool surfaces are visible to the model on the Claude backend:
    //   1. Native Claude Code tools (Read / Write / Edit / Bash / Glob /
    //      Grep) — anchored to the factory workspace via the SDK query's
    //      `cwd`. These replace the factory's old `read_file` /
    //      `write_file` shims; the model works on the local mirror of the
    //      target realm directly.
    //   2. Factory tools exposed via an in-process MCP server, prefixed
    //      with `mcp__<server>__`. Used for everything that needs realm
    //      runtime access (search, validators, host commands, structured
    //      updates) and for control signals (signal_done /
    //      request_clarification).
    //
    // The shared prompt template / skills reference factory operations by
    // their plain names (e.g. `signal_done`). Append a short rename map
    // so the model translates plain names into MCP-prefixed calls.
    // Build the authoritative list of MCP tool names so the addendum can
    // both rename them and serve as the closed catalog. Adding entries
    // that look related but are not actually registered (e.g. `realm-read`,
    // `realm-write`) invites the model to invent siblings, so we keep the
    // list to exactly the tools the SDK MCP server exposes.
    let mcpRows = tools
      .map((t) => `- \`${t.name}\` → \`mcp__${MCP_SERVER_NAME}__${t.name}\``)
      .join('\n');

    // Names of the structured update tools that exist in this run. Used
    // both in the rule (`Write must not be used for these`) and in the
    // surrounding rationale, so collect them once. The agent only sees
    // the ones we actually registered.
    let structuredCardTools = new Set([
      'update_project',
      'update_issue',
      'create_knowledge',
      'create_catalog_spec',
      'add_comment',
    ]);
    let structuredCardToolList = tools
      .map((t) => t.name)
      .filter((n) => structuredCardTools.has(n));
    let structuredCardToolHumanList = structuredCardToolList
      .map((n) => `\`${n}\``)
      .join(' / ');

    let toolNamingNote = [
      '',
      '# Tools (Claude Code backend)',
      '',
      'You have two tool surfaces. Pick the right one for the file you are',
      'about to touch — they are not interchangeable.',
      '',
      '## Workspace files — use native Claude Code tools',
      '',
      'The factory mirrors the target realm to a local workspace directory',
      'and sets it as your working directory. Use the native tools you',
      'already know — `Read`, `Write`, `Edit`, `Glob`, `Grep`, `Bash` —',
      'with realm-relative paths (e.g. `sticky-note.gts`,',
      '`StickyNote/note-1.json`). The orchestrator syncs your changes back',
      'to the realm between iterations.',
      '',
      'Use native tools for:',
      '',
      '- Card definitions: `*.gts` files',
      '- Card tests: `*.test.gts` files',
      '- Card instances under `<CardType>/<id>.json` (the user data the cards represent)',
      '- Inspection: `Read`, `Glob`, `Grep`, and read-only `Bash` (`ls`, `find`, `cat`, `boxel status`, `boxel history`)',
      '',
      'Stay inside the workspace directory. Never write to absolute paths',
      'outside it.',
      '',
      '## Tracker-schema cards + realm operations — use factory MCP tools',
      '',
      `These are exposed through an in-process MCP server named`,
      `\`${MCP_SERVER_NAME}\` and prefixed with \`mcp__${MCP_SERVER_NAME}__\`.`,
      'Use them by their plain names in your reasoning, but invoke them by',
      'their prefixed names.',
      '',
      '**Critical rule — do NOT use `Write` or `Edit` for tracker-schema',
      'cards.** Project, Issue, KnowledgeArticle, Spec, and issue comments',
      'all have dedicated factory tools that enforce schema and invariants',
      '(e.g. `update_issue` strips `description` so it stays immutable;',
      '`create_catalog_spec` sets the correct `adoptsFrom`; all of them do',
      'read-patch-write merging that preserves attributes you did not pass).',
      'Going around them via native `Write` produces malformed cards or',
      'silently violates invariants the orchestrator depends on.',
      '',
      structuredCardToolList.length > 0
        ? `Always use these structured tools for the corresponding files: ${structuredCardToolHumanList}.`
        : '',
      '',
      'The complete factory tool catalog is below. **Do not call any tool',
      'whose plain name is not in this list** — there is no `realm-read`,',
      '`realm-write`, or other realm-side fs tool. Realm reads go through',
      '`search_realm` / `fetch_transpiled_module`; realm writes happen by',
      'editing workspace files (or calling a structured tool above) and',
      'letting the orchestrator sync.',
      '',
      mcpRows,
      '',
    ]
      .filter((line) => line !== null && line !== undefined)
      .join('\n');

    return base + toolNamingNote;
  }

  private buildUserPrompt(context: AgentContext): string {
    let issueType = (context.issue as Record<string, unknown>).issueType;
    if (issueType === 'bootstrap' && context.briefUrl) {
      return assembleBootstrapPrompt({
        context,
        loader: this.promptLoader,
      });
    }
    if (context.validationContext) {
      return assembleIteratePrompt({
        context,
        previousActions: [],
        iteration: context.iteration ?? 1,
        loader: this.promptLoader,
      });
    }
    return assembleImplementPrompt({
      context,
      loader: this.promptLoader,
    });
  }

  private debugLog(message: SDKMessage): void {
    try {
      let summary: string;
      if (message.type === 'assistant') {
        // Capture tool_use_id → name from each tool_use block so the next
        // tool_result message can be labelled with the actual tool name.
        for (let entry of collectToolUseEntries(message)) {
          this.toolUseIdToName.set(entry.id, entry.name);
        }
        summary = `[assistant] ${summarizeAssistantMessage(message)}`;
      } else if (message.type === 'user') {
        summary = `[user/tool-result] ${summarizeUserMessage(
          message,
          this.toolUseIdToName,
        )}`;
      } else if (message.type === 'result') {
        summary = `[result] subtype=${(message as { subtype?: string }).subtype ?? 'unknown'}`;
      } else {
        summary = `[${(message as { type: string }).type}]`;
      }
      log.info(summary);
    } catch {
      // best-effort
    }
  }
}

/**
 * Convert an array of FactoryTools into an array of Agent SDK
 * `SdkMcpToolDefinition`s. Exported for testability: unit tests invoke the
 * returned `handler` directly and make assertions about the schema without
 * needing to spin up the SDK's MCP server / query pipeline.
 */
export function buildSdkToolsFromFactoryTools(
  tools: FactoryTool[],
  hooks: {
    onToolCall: (entry: ToolCallEntry) => void;
    onSignal: (signal: CapturedSignal) => void;
  },
): SdkMcpToolDefinition[] {
  return tools.map((factoryTool) =>
    tool(
      factoryTool.name,
      factoryTool.description,
      jsonSchemaToZodShape(factoryTool.parameters),
      async (args) => {
        let start = Date.now();
        let typedArgs = args as Record<string, unknown>;
        let result: unknown;
        try {
          result = await factoryTool.execute(typedArgs);
        } catch (error) {
          result = {
            error: error instanceof Error ? error.message : String(error),
          };
        }
        let durationMs = Date.now() - start;
        hooks.onToolCall({
          tool: factoryTool.name,
          args: typedArgs,
          result,
          durationMs,
        });

        if (result && typeof result === 'object' && 'signal' in result) {
          let signal = (result as Record<string, unknown>).signal;
          if (signal === DONE_SIGNAL) {
            hooks.onSignal({ kind: 'done' });
          } else if (signal === CLARIFICATION_SIGNAL) {
            let message = String(
              (result as Record<string, unknown>).message ?? '',
            );
            hooks.onSignal({ kind: 'clarification', message });
          }
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(serializeSignalResult(result)),
            },
          ],
        };
      },
    ),
  );
}

/**
 * Serialize a FactoryTool execute() result into a JSON-safe object before
 * handing it to the LLM.
 *
 * The factory's control-flow signals (`DONE_SIGNAL` / `CLARIFICATION_SIGNAL`)
 * are `Symbol.for('factory:*')` values. Symbols don't survive
 * `JSON.stringify`, so we substitute a human-readable string tag so the model
 * sees a sensible tool result and we don't emit `null` in place of the
 * signal.
 */
function serializeSignalResult(result: unknown): unknown {
  if (result && typeof result === 'object' && 'signal' in result) {
    let r = result as Record<string, unknown>;
    let signal = r.signal;
    let tag =
      signal === DONE_SIGNAL
        ? 'factory:done'
        : signal === CLARIFICATION_SIGNAL
          ? 'factory:clarification'
          : String(signal);
    return { ...r, signal: tag };
  }
  return result;
}

function summarizeAssistantMessage(msg: {
  message: { content?: unknown };
}): string {
  let content = msg.message?.content;
  if (!Array.isArray(content)) {
    return '(no content)';
  }
  let parts = content.map((block: unknown) => {
    if (block && typeof block === 'object' && 'type' in block) {
      let t = (block as { type: string }).type;
      if (t === 'tool_use') {
        let name = (block as { name?: string }).name ?? '<unnamed>';
        return `tool_use(${name})`;
      }
      if (t === 'text') {
        let text = (block as { text?: string }).text ?? '';
        return `text(${text.slice(0, 80)}${text.length > 80 ? '…' : ''})`;
      }
      return t;
    }
    return 'unknown';
  });
  return parts.join(', ');
}

/**
 * Pull `{ id, name }` from each `tool_use` block in an assistant message.
 * Used to maintain the tool_use_id → name map that lets us label
 * subsequent `tool_result` messages with the actual tool name.
 */
function collectToolUseEntries(msg: {
  message: { content?: unknown };
}): { id: string; name: string }[] {
  let content = msg.message?.content;
  if (!Array.isArray(content)) {
    return [];
  }
  let entries: { id: string; name: string }[] = [];
  for (let block of content) {
    if (
      block &&
      typeof block === 'object' &&
      (block as { type?: string }).type === 'tool_use'
    ) {
      let id = (block as { id?: string }).id;
      let name = (block as { name?: string }).name;
      if (typeof id === 'string' && typeof name === 'string') {
        entries.push({ id, name });
      }
    }
  }
  return entries;
}

/**
 * Format a user message for debug output. User messages from the SDK
 * carry `tool_result` blocks (one per prior `tool_use`); we pull each
 * one's correlated tool name from `idToName`, mark error results, and
 * include a short snippet of the payload so the operator can see what
 * actually came back without scrolling through full payloads.
 */
function summarizeUserMessage(
  msg: { message: { content?: unknown } },
  idToName: Map<string, string>,
): string {
  let content = msg.message?.content;
  if (typeof content === 'string') {
    return collapseAndTruncate(content);
  }
  if (!Array.isArray(content)) {
    return '(no content)';
  }
  let parts: string[] = [];
  for (let block of content) {
    if (!block || typeof block !== 'object') {
      parts.push('unknown');
      continue;
    }
    let t = (block as { type?: string }).type;
    if (t === 'tool_result') {
      let id = (block as { tool_use_id?: string }).tool_use_id;
      let name =
        (id && idToName.get(id)) ??
        (id ? `<tool ${id.slice(0, 8)}>` : '<unknown>');
      let isError = (block as { is_error?: boolean }).is_error === true;
      let payload = stringifyToolResultContent(
        (block as { content?: unknown }).content,
      );
      let label = isError ? `tool_result(${name}, ERROR)` : `tool_result(${name})`;
      parts.push(`${label}: ${collapseAndTruncate(payload)}`);
    } else if (t === 'text') {
      let text = (block as { text?: string }).text ?? '';
      parts.push(`text(${collapseAndTruncate(text, 80)})`);
    } else {
      parts.push(typeof t === 'string' ? t : 'unknown');
    }
  }
  return parts.length > 0 ? parts.join(' | ') : '(no content)';
}

/**
 * SDK `tool_result.content` is `string | Array<{ type, text, ... }>`.
 * Normalize to a single string so the debug summarizer can truncate it.
 */
function stringifyToolResultContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (typeof c === 'string') return c;
        if (c && typeof c === 'object') {
          let text = (c as { text?: unknown }).text;
          if (typeof text === 'string') return text;
          try {
            return JSON.stringify(c);
          } catch {
            return '';
          }
        }
        return '';
      })
      .join('');
  }
  if (content === undefined || content === null) {
    return '';
  }
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

/**
 * Collapse newlines and truncate to a single readable line for log
 * output. Long results are tagged with their original length so the
 * operator can tell how much was elided.
 */
function collapseAndTruncate(value: string, max = 200): string {
  let oneLine = value.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= max) {
    return oneLine;
  }
  return `${oneLine.slice(0, max)}… (+${oneLine.length - max} chars)`;
}
