/**
 * ClaudeCodeFactoryAgent — LoopAgent backed by the Claude Agent SDK.
 *
 * Runs the agent against the Claude Agent SDK's `query()` with the
 * `claude_code` tool preset. The agent operates entirely through the
 * SDK's built-in tools (Read / Write / Edit / Glob / Grep / Bash) and
 * the boxel CLI for any realm-server interaction. There is no
 * in-process MCP server.
 *
 * Why no MCP server: empirically, combining `createSdkMcpServer` with
 * any non-empty `tools` whitelist (or with the preset and disallowing
 * `ToolSearch`) breaks the SDK MCP bridge — agent calls to
 * `mcp__factory__*` get stub responses but our handlers never run, and
 * `signal_done` therefore can't fire the abort. CS-10883 sidesteps the
 * issue by retiring the wrapper tools entirely: the agent uses the
 * SDK's native filesystem tools against the local workspace (which the
 * outer loop syncs to the realm), and `boxel` CLI commands for
 * federated search and any other realm-server work.
 *
 * Done signaling: the agent ends its turn naturally. The loop's
 * `toolCallLog.length > 0 ? 'done' : 'needs_iteration'` heuristic
 * marks the issue done; validation runs after every turn and feeds
 * any failures back into the next iteration's prompt.
 *
 * Relationship to OpenRouterFactoryAgent:
 *   - Same prompt assembly (FilePromptLoader + assemble*Prompt helpers)
 *   - Different transport entirely. OpenRouter still uses the
 *     FactoryTool[] catalog passed into `run()`; this agent ignores
 *     it and operates via native SDK tools + Bash.
 */

import {
  query as defaultQuery,
  type Options,
  type Query,
  type SDKMessage,
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
import type { FactoryTool, ToolCallEntry } from '../factory-tool-builder';
import { logger } from '../logger';

const MAX_TOOL_USE_TURNS = 50;

let log = logger('factory-agent-claude-code');

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
    _tools: FactoryTool[],
  ): Promise<AgentRunResult> {
    let systemPrompt = this.buildSystemPrompt(context);
    let userPrompt = this.buildUserPrompt(context);

    let toolCallLog: ToolCallEntry[] = [];
    let abortController = new AbortController();

    // Tool surface the agent gets:
    //   - `claude_code` preset enables every built-in (Read, Write,
    //     Edit, Glob, Grep, Bash, ...). Bash gives the agent access to
    //     `npx boxel sync / search / pull / ...` for realm-server work.
    //   - `disallowedTools` removes the dangerous / out-of-scope ones
    //     (network, subagent spawning, notebook editing, etc.) so the
    //     factory keeps a tight tool surface.
    //   - `allowedTools` lists the same set so they auto-approve under
    //     `bypassPermissions` without any prompts.
    let allowedTools = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'];

    let options: Options = {
      systemPrompt,
      tools: { type: 'preset', preset: 'claude_code' },
      allowedTools,
      disallowedTools: [
        'WebFetch',
        'WebSearch',
        'NotebookEdit',
        'TodoWrite',
        'Task',
        'KillShell',
      ],
      // Confine the agent's filesystem access to the workspace dir.
      // Without this, native Read/Write/Edit would resolve relative
      // paths against `process.cwd()` (the software-factory package
      // root), which would silently miss the realm files entirely.
      ...(context.workspaceDir ? { cwd: context.workspaceDir } : {}),
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      maxTurns: MAX_TOOL_USE_TURNS,
      // Isolate from the host user's Claude Code settings — keeps their
      // MCP server config (Linear, etc.) out of the factory's tool list.
      settingSources: [],
      abortController,
      debug: this.config.debug === true,
    };

    let q = this.queryFn({ prompt: userPrompt, options });

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
      // Track every tool_use block in assistant messages so the loop's
      // "did the agent do anything?" heuristic sees the work.
      if (message.type === 'assistant') {
        let content = (message as { message?: { content?: unknown } }).message
          ?.content;
        if (Array.isArray(content)) {
          for (let block of content) {
            if (
              block &&
              typeof block === 'object' &&
              (block as { type?: string }).type === 'tool_use'
            ) {
              let name = (block as { name?: string }).name ?? '';
              if (name) {
                toolCallLog.push({
                  tool: name,
                  args:
                    ((block as { input?: Record<string, unknown> }).input as
                      | Record<string, unknown>
                      | undefined) ?? {},
                  result: undefined,
                  durationMs: 0,
                });
              }
            }
          }
        }
      }
    }

    // Stream ended naturally. If the agent did real work, treat as
    // done — the loop runs validation next and feeds any failures
    // back into the next iteration. If there were no tool calls at
    // all, the agent stalled; ask the loop to iterate.
    return {
      status: toolCallLog.length > 0 ? 'done' : 'needs_iteration',
      toolCalls: toolCallLog,
    };
  }

  private buildSystemPrompt(context: AgentContext): string {
    let skills = context.skills.map((s: ResolvedSkill) => ({
      name: s.name,
      content: s.content,
      references: s.references ?? [],
    }));

    return this.promptLoader.load('system', {
      targetRealmUrl: context.targetRealmUrl,
      workspaceDir: context.workspaceDir ?? '',
      skills,
    });
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
