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
    let systemPrompt = this.buildSystemPrompt(context, tools);
    let userPrompt = this.buildUserPrompt(context);

    let toolCallLog: ToolCallEntry[] = [];
    let captured: CapturedSignal | undefined;
    let abortController = new AbortController();

    let sdkTools = buildSdkToolsFromFactoryTools(tools, {
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

    let allowedTools = tools.map((t) => `mcp__${MCP_SERVER_NAME}__${t.name}`);

    let options: Options = {
      systemPrompt,
      mcpServers: { [MCP_SERVER_NAME]: mcpServer },
      // Disable Claude Code's built-in tools so the model can only call
      // factory tools. This enforces the phase-2 invariant that the ralph
      // loop owns the control plane; Claude Code is the LLM backend only.
      tools: [],
      allowedTools,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      maxTurns: MAX_TOOL_USE_TURNS,
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

    // The shared prompt template references tools by their plain names
    // (`read_file`, `signal_done`, etc.) — which is what OpenRouter's
    // tool-use protocol registers. The Claude Agent SDK exposes tools via
    // an MCP server and prefixes every tool name with `mcp__<server>__`,
    // so without a bridge the model can see "write_file" in the prompt
    // but only `mcp__factory__write_file` in its tool list. Append a
    // short tool-naming note so the model can resolve the two
    // consistently. The OpenRouter path leaves the template untouched.
    let renameList = tools
      .map((t) => `- \`${t.name}\` → \`mcp__${MCP_SERVER_NAME}__${t.name}\``)
      .join('\n');
    let toolNamingNote = [
      '',
      '# Tool naming (Claude Code backend)',
      '',
      `Your tools are exposed through an MCP server named \`${MCP_SERVER_NAME}\`.`,
      `When you invoke a tool, use its MCP-prefixed name — not the plain`,
      `name used elsewhere in this prompt. Mapping:`,
      '',
      renameList,
      '',
    ].join('\n');

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
      let summary =
        message.type === 'assistant'
          ? `[assistant] ${summarizeAssistantMessage(message)}`
          : message.type === 'user'
            ? `[user/tool-result]`
            : message.type === 'result'
              ? `[result] subtype=${(message as { subtype?: string }).subtype ?? 'unknown'}`
              : `[${(message as { type: string }).type}]`;
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
