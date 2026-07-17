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
 * The sibling backend (`./opencode.ts`) drives the same factory loop
 * via the opencode SDK + an OpenRouter (or boxel-proxy) provider —
 * same prompt assembly, same tool catalog, same exit signals, just a
 * different transport. The factory's deterministic ralph loop is
 * oblivious to which agent is running: the LoopAgent contract
 * (`run(context, tools)`) is identical for both.
 */

import { realpathSync } from 'node:fs';
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from 'node:path';

import {
  createSdkMcpServer,
  query as defaultQuery,
  tool,
  type CanUseTool,
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
} from './types.ts';
import {
  assembleBootstrapPrompt,
  assembleImplementPrompt,
  assembleIteratePrompt,
  FilePromptLoader,
  requireDarkfactoryModuleUrl,
  type PromptLoader,
} from '../factory-prompt-loader.ts';
import {
  CLARIFICATION_SIGNAL,
  DONE_SIGNAL,
  type FactoryTool,
  type ToolCallEntry,
} from '../factory-tool-builder.ts';
import { deriveCatalogRealmUrl } from '../factory-catalog-realm.ts';
import { jsonSchemaToZodShape } from '../factory-tool-schema-adapter.ts';
import { logger } from '../logger.ts';

const MCP_SERVER_NAME = 'factory';
const MAX_TOOL_USE_TURNS = 100;

/**
 * Built-in Claude Code tools the factory exposes to the model on the
 * Claude backend. They operate on the SDK query's `cwd` (the factory
 * workspace), so the model handles workspace files natively while MCP
 * stays focused on what needs realm runtime access (`get_card_schema`,
 * validators, control signals).
 */
const NATIVE_FS_TOOLS = ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'];

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
    // `'registered'` tools come from the ToolRegistry's `realm-api`
    // manifests (currently just `realm-create`, which the entrypoint
    // drives before the agent runs). Keep them off the agent's hot
    // path so future registry additions don't accidentally surface
    // here.
    let mcpFactoryTools = tools.filter((t) => t.source !== 'registered');

    let systemPrompt = this.buildSystemPrompt(context, mcpFactoryTools);
    let userPrompt = this.buildUserPrompt(context);

    let toolCallLog: ToolCallEntry[] = [];
    let sessionId: string | undefined;
    let usage: AgentRunResult['usage'];
    let captured: CapturedSignal | undefined;
    let abortController = new AbortController();

    let sdkTools = buildSdkToolsFromFactoryTools(mcpFactoryTools, {
      onToolCall: (entry) => {
        toolCallLog.push(entry);
        try {
          context.onToolCall?.(entry);
        } catch {
          // Live-blog streaming must never break the run.
        }
      },
      onSignal: (signal) => {
        captured = signal;
        abortController.abort();
      },
    });

    let mcpServer = createSdkMcpServer({
      name: MCP_SERVER_NAME,
      tools: sdkTools,
    });

    // Native fs tools are only safe when we have a workspace to scope
    // them to. Without `workspaceDir` we'd run with no `cwd` and no
    // `canUseTool` hook — relative paths would resolve against the
    // process's working directory and absolute paths would be
    // unrestricted, which is exactly the host-fs access this whole
    // change is trying to prevent. So if no workspace was configured,
    // fall back to MCP-only (factory tools and nothing else).
    let workspaceDir = this.config.workspaceDir;
    let nativeFsEnabled = workspaceDir !== undefined;

    // Critical interaction between `allowedTools` and `canUseTool`
    // (verified empirically via scripts/canusetool-repro.ts, CS-11033):
    //
    //   - A tool listed in `allowedTools` is auto-approved by the SDK
    //     and `canUseTool` is **never** invoked for it.
    //   - A tool NOT in `allowedTools` runs `canUseTool` (under
    //     `permissionMode: 'default'`), and the hook's allow/deny is
    //     honored.
    //
    // So if we put `Write` / `Edit` etc. into `allowedTools`, the
    // workspace-scoping hook becomes dead code. We keep MCP tools in
    // `allowedTools` (they're our own in-process implementations and
    // safe to auto-approve) but deliberately omit native fs tools so
    // each `Read` / `Write` / `Edit` call is gated by `canUseTool`.
    let allowedTools = mcpFactoryTools.map(
      (t) => `mcp__${MCP_SERVER_NAME}__${t.name}`,
    );

    let options: Options = {
      systemPrompt,
      mcpServers: { [MCP_SERVER_NAME]: mcpServer },
      // Per-turn model/thinking budget from the orchestrator's policy
      // (fix iterations don't need the flagship model at full effort).
      // Absent fields inherit the session default.
      ...(context.modelBudget?.model
        ? { model: context.modelBudget.model }
        : {}),
      ...(context.modelBudget?.effort
        ? { effort: context.modelBudget.effort }
        : {}),
      // When `workspaceDir` is configured, expose the SDK's native fs /
      // shell tools so the model can work on workspace files directly
      // (`Read` / `Write` / `Edit`) and run inspection helpers (`Bash`,
      // `Glob`, `Grep`). Bash is **not** path-scoped — see the
      // `canUseTool` note below — so the prompt addendum constrains it
      // to read-only inspection. The structured fs tools are the path
      // a model takes to *write*, and those are scoped.
      tools: nativeFsEnabled ? NATIVE_FS_TOOLS : [],
      allowedTools,
      // `default` (not `dontAsk` or `bypassPermissions`) is the only
      // permission mode that actually invokes `canUseTool` for tools
      // outside `allowedTools` AND honors its allow/deny. Other modes
      // either auto-approve everything (`bypassPermissions`,
      // `acceptEdits`-with-allow) or silently deny without consulting
      // the hook (`dontAsk`-without-allowedTools-entry). Because we
      // omit native fs tools from `allowedTools` (see the comment
      // above), the hook fires on every `Read` / `Write` / `Edit` and
      // can scope them to the workspace.
      //
      // Scope of the hook: it gates the typed fs tools (`Read`,
      // `Write`, `Edit`, `MultiEdit`, `NotebookEdit`, `NotebookRead`)
      // because their `file_path` arg is structured and trivial to
      // validate. `Bash` / `Glob` / `Grep` fall through the hook and
      // are auto-allowed — parsing arbitrary shell for write side
      // effects (`>`, `tee`, `cp`, `mv`, …) is its own footgun, and
      // read-only inspection (`ls`, `find`, `cat`, `boxel status`)
      // needs the broader fs. The prompt addendum is the contract for
      // Bash; the hook is the structural guard for the typed tools.
      permissionMode: 'default',
      ...(workspaceDir
        ? { canUseTool: buildWorkspaceScopedCanUseTool(workspaceDir) }
        : {}),
      maxTurns: MAX_TOOL_USE_TURNS,
      // Anchor native fs tools to the factory workspace so relative
      // paths emitted by the model (e.g. `sticky-note.gts`) resolve
      // inside the mirror of the target realm, not the user's home
      // directory. Bash also inherits this cwd, which keeps simple
      // relative-path commands (`cat sticky-note.gts`) inside the
      // workspace by default.
      ...(workspaceDir ? { cwd: workspaceDir } : {}),
      // Isolate from the host user's Claude Code settings — we want
      // deterministic agent behavior regardless of whose machine this
      // runs on.
      settingSources: [],
      // Context forking (v2): resume a primed session, branching to a new
      // session id so every fork inherits the primed conversation as a
      // shared (provider-cached) prefix without mutating the original.
      ...(context.resumeSession
        ? {
            resume: context.resumeSession.sessionId,
            forkSession: context.resumeSession.fork !== false,
          }
        : {}),
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
          message.type === 'system' &&
          (message as { subtype?: string }).subtype === 'init'
        ) {
          let initSessionId = (message as { session_id?: string }).session_id;
          if (initSessionId) {
            sessionId = initSessionId;
          }
          if (!this.modelLogged) {
            let modelName = (message as { model?: string }).model;
            if (modelName) {
              log.info(`Agent backend: claude (model=${modelName})`);
              this.modelLogged = true;
            }
          }
        }
        // Capture token/cost usage from the terminal result message so the
        // orchestrator's turn telemetry can report what the turn cost.
        if (message.type === 'result') {
          let r = message as {
            total_cost_usd?: number;
            usage?: {
              input_tokens?: number;
              output_tokens?: number;
              cache_read_input_tokens?: number;
            };
          };
          usage = {
            inputTokens: r.usage?.input_tokens,
            outputTokens: r.usage?.output_tokens,
            cacheReadTokens: r.usage?.cache_read_input_tokens,
            costUsd: r.total_cost_usd,
          };
        }
        // Coarse activity heartbeat (v3 RunMonitor): every complete
        // assistant message resets the stall clock. Silence between
        // messages = the model is generating.
        if (context.onActivity && message.type === 'assistant') {
          try {
            context.onActivity(
              summarizeAssistantMessage(
                message as { message: { content?: unknown } },
              ).slice(0, 120),
            );
          } catch {
            // Monitoring must never break the run.
          }
        }
        // Stream native Write/Edit sightings to the live-blog hook as
        // they land (MCP factory tools stream via buildSdkToolsFromFactoryTools).
        if (context.onToolCall && message.type === 'assistant') {
          try {
            let content = (message as { message?: { content?: unknown } })
              .message?.content;
            if (Array.isArray(content)) {
              for (let block of content) {
                let b = block as {
                  type?: string;
                  name?: string;
                  input?: Record<string, unknown>;
                };
                if (
                  b?.type === 'tool_use' &&
                  (b.name === 'Write' || b.name === 'Edit')
                ) {
                  context.onToolCall({ tool: b.name, args: b.input ?? {} });
                }
              }
            }
          } catch {
            // Live-blog streaming must never break the run.
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
      return { status: 'done', toolCalls: toolCallLog, sessionId, usage };
    }
    if (captured?.kind === 'clarification') {
      return {
        status: 'blocked',
        toolCalls: toolCallLog,
        sessionId,
        usage,
        message: captured.message,
      };
    }

    // Stream ended without an explicit signal. If the agent called
    // at least one tool, treat as done; otherwise needs_iteration so
    // the orchestrator feeds validation failures back.
    return {
      status: toolCallLog.length > 0 ? 'done' : 'needs_iteration',
      toolCalls: toolCallLog,
      sessionId,
      usage,
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
      targetRealm: context.targetRealm,
      catalogRealm: deriveCatalogRealmUrl(context.targetRealm),
      darkfactoryModuleUrl: requireDarkfactoryModuleUrl(context),
      enableBoxelUiDiscovery: context.enableBoxelUiDiscovery === true,
      skills,
    });

    // Two tool surfaces are visible to the model on the Claude backend:
    //   1. Native Claude Code tools (Read / Write / Edit / Bash / Glob /
    //      Grep) — anchored to the factory workspace via the SDK query's
    //      `cwd`. The model works on the local mirror of the target realm
    //      directly; `boxel sync` pushes between iterations.
    //   2. Factory tools exposed via an in-process MCP server, prefixed
    //      with `mcp__<server>__`. Used for realm-runtime operations
    //      (`get_card_schema`, the five validators) and for control
    //      signals (`signal_done`, `request_clarification`).
    //
    // The shared prompt template / skills reference factory operations by
    // their plain names (e.g. `signal_done`). Append a short rename map
    // so the model translates plain names into MCP-prefixed calls.
    // Build the authoritative list of MCP tool names so the addendum can
    // both rename them and serve as the closed catalog. Adding entries
    // that look related but are not actually registered invites the model
    // to invent siblings, so we keep the list to exactly the tools the
    // SDK MCP server exposes.
    let mcpRows = tools
      .map((t) => `- \`${t.name}\` → \`mcp__${MCP_SERVER_NAME}__${t.name}\``)
      .join('\n');

    let toolNamingNote = [
      '',
      '# Tools (Claude Code backend)',
      '',
      'You have two tool surfaces. Pick the right one for the file you are',
      'about to touch.',
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
      'Use native tools for **every workspace file**, including:',
      '',
      '- Card definitions: `*.gts` files',
      '- Card tests: `*.test.gts` files',
      '- Card instances under `<CardType>/<id>.json`',
      '- **Tracker-schema cards** — `Projects/*.json`, `Issues/*.json`,',
      '  `Knowledge Articles/*.json`, `Spec/*.json`. These are also workspace',
      '  JSON files. Hand-write the JSON:API document with the right',
      '  `meta.adoptsFrom` (see the bootstrap and operations skills for the',
      '  full shapes and the Issue invariants you must enforce yourself).',
      '- Inspection: `Read`, `Glob`, `Grep`, and read-only `Bash` (`ls`, `find`, `cat`, `boxel status`, `boxel history`)',
      '',
      'Stay inside the workspace directory.',
      '',
      '- **`Read` / `Write` / `Edit` / `MultiEdit` / `NotebookEdit` /',
      '  `NotebookRead` are structurally enforced** to resolve inside the',
      '  workspace — absolute paths or `..`-traversal that escape are',
      '  rejected with a deny message before they reach the filesystem.',
      '  Use realm-relative paths only.',
      '- **`Bash` is NOT enforced.** The shell runs with the workspace as',
      '  its cwd, but you can still write outside via redirection (`>`,',
      '  `tee`), copy/move (`cp`, `mv`), or absolute paths inside commands.',
      '  Treat `Bash` as **read-only inspection** only — `ls`, `find`,',
      '  `cat`, `grep`, read-only `boxel` CLI commands. If you need to',
      '  write a file, use `Write` or `Edit` so the workspace guard fires.',
      '',
      '## Realm validators + control signals — use factory MCP tools',
      '',
      `These are exposed through an in-process MCP server named`,
      `\`${MCP_SERVER_NAME}\` and prefixed with \`mcp__${MCP_SERVER_NAME}__\`.`,
      'Use them by their plain names in your reasoning, but invoke them by',
      'their prefixed names.',
      '',
      'The complete factory tool catalog is below. **Do not call any tool',
      'whose plain name is not in this list.** Realm reads go through',
      '`Bash` + `boxel search` / `boxel read-transpiled`; realm writes',
      'happen by editing workspace files and letting the orchestrator sync.',
      '',
      mcpRows,
      '',
    ].join('\n');

    return base + toolNamingNote;
  }

  private buildUserPrompt(context: AgentContext): string {
    let issueType = (context.issue as Record<string, unknown>).issueType;
    if (context.primeTurn === true) {
      return this.promptLoader.load('prime', {
        project: context.project,
        knowledge: context.knowledge,
      });
    }
    if (context.acceptanceTurn) {
      return this.promptLoader.load('acceptance-walkthrough', {
        issue: context.issue,
        darkfactoryModuleUrl: requireDarkfactoryModuleUrl(context),
        renderSummary: context.acceptanceTurn.renderSummary,
        screenshots: context.acceptanceTurn.screenshots,
        failedCaptures:
          context.acceptanceTurn.failedCaptures.length > 0
            ? context.acceptanceTurn.failedCaptures
            : undefined,
      });
    }
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
 * Build a `canUseTool` hook that confines native fs operations to the
 * factory workspace.
 *
 * The Claude SDK's built-in `Read` / `Write` / `Edit` / `MultiEdit` /
 * `NotebookEdit` / `NotebookRead` tools all take an absolute or
 * relative `file_path`. Relative paths resolve against the SDK's `cwd`
 * (which we already set to `workspaceDir`); absolute paths bypass cwd
 * entirely. In the wild, the model has produced absolute paths it
 * invented from the realm slug — `/Users/jurgen/code/boxel/...` — that
 * landed real bytes outside the workspace and broke the loop.
 *
 * This hook normalizes `file_path` and rejects anything that doesn't
 * resolve inside `workspaceDir`. Bash is intentionally not gated:
 * read-only inspection (`ls`, `find`, `cat`, `boxel status`) needs the
 * full filesystem, and parsing arbitrary shell for write side-effects
 * is its own footgun. Trust the prompt for Bash; enforce structurally
 * for the typed fs tools.
 */
const PATH_SCOPED_TOOLS = new Set([
  'Read',
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
  'NotebookRead',
]);

export function buildWorkspaceScopedCanUseTool(
  workspaceDir: string,
): CanUseTool {
  // Canonicalize the workspace path once so the comparison below works
  // regardless of which symlink-equivalent form the SDK reports.
  // On macOS, factory workspaces typically live under `/var/folders/...`,
  // which is a symlink to `/private/var/folders/...`. The SDK resolves
  // paths to their canonical form, so absolute paths flowing into the
  // hook may use either form. Both must be treated as inside.
  let workspaceCanonical = canonicalizeExistingAncestor(resolve(workspaceDir));
  return async (toolName, input) => {
    if (!PATH_SCOPED_TOOLS.has(toolName)) {
      return { behavior: 'allow', updatedInput: input };
    }
    let raw = (input as { file_path?: unknown }).file_path;
    if (typeof raw !== 'string' || raw.trim() === '') {
      // No file_path to validate — let the SDK surface its own
      // validation error instead of inventing one here.
      return { behavior: 'allow', updatedInput: input };
    }
    let absolute = isAbsolute(raw) ? raw : resolve(workspaceCanonical, raw);
    let canonical = canonicalizeExistingAncestor(resolve(absolute));
    let rel = relative(workspaceCanonical, canonical);
    let escapesWorkspace =
      rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel);
    if (escapesWorkspace) {
      return {
        behavior: 'deny',
        message:
          `Refusing ${toolName} on "${raw}": path resolves outside the ` +
          `factory workspace (${workspaceCanonical}). Use realm-relative ` +
          `paths only — your working directory is the workspace.`,
      };
    }
    return { behavior: 'allow', updatedInput: input };
  };
}

/**
 * Canonicalize a path through symlinks even when the leaf doesn't exist
 * yet — typical for `Write` creating a fresh file. Walks up to the
 * deepest existing ancestor, runs `realpathSync` on it, then re-appends
 * the missing segments. Falls back to the input on unexpected errors so
 * the hook never throws (which would crash the SDK turn).
 *
 * Why we need this: on macOS the typical factory workspace is rooted at
 * `/var/folders/...`, which `node:fs` reports back as
 * `/private/var/folders/...`. Without canonicalization, `node:path
 * .relative('/var/folders/W', '/private/var/folders/W/foo.gts')`
 * returns `../../private/var/folders/W/foo.gts` — i.e. "escapes" — and
 * we'd deny a path that's actually inside the workspace.
 */
function canonicalizeExistingAncestor(absolutePath: string): string {
  let current = absolutePath;
  let suffix: string[] = [];
  // The loop terminates when either realpathSync resolves (every path
  // inside an existing dir hits this) or `dirname()` stops shrinking
  // at the filesystem root. eslint can't see that.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      let real = realpathSync(current);
      return suffix.length === 0 ? real : resolve(real, ...suffix.reverse());
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        return absolutePath;
      }
      let parent = dirname(current);
      if (parent === current) {
        // Reached filesystem root without finding any existing ancestor.
        return absolutePath;
      }
      suffix.push(basename(current));
      current = parent;
    }
  }
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
      let label = isError
        ? `tool_result(${name}, ERROR)`
        : `tool_result(${name})`;
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
