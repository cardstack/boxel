/**
 * OpenRouter-backed factory agent — implements `LoopAgent` by driving a
 * remote LLM through OpenRouter's OpenAI-compatible tool-use protocol.
 *
 * Flow: this agent sends tool definitions to the LLM via the API's
 * `tools` parameter. The LLM emits `tool_calls[]`, we dispatch each
 * through `FactoryTool.execute()`, feed the result back as a `role: "tool"`
 * message, and iterate until the LLM calls `signal_done` /
 * `request_clarification` or stops making tool calls.
 */

import { SupportedMimeType } from '@cardstack/runtime-common/supported-mime-type';

const MAX_TOOL_USE_TURNS = 50;

import type { AgentContext, FactoryAgentConfig, ResolvedSkill } from './types';
import { OPENROUTER_CHAT_URL } from './types';
import type { LoopAgent, AgentRunResult } from './types';
import {
  assembleBootstrapPrompt,
  assembleImplementPrompt,
  assembleIteratePrompt,
  FilePromptLoader,
  type PromptLoader,
} from '../factory-prompt-loader';
import {
  DONE_SIGNAL,
  CLARIFICATION_SIGNAL,
  type FactoryTool,
  type ToolCallEntry,
} from '../factory-tool-builder';

// ---------------------------------------------------------------------------
// Tool-use message types (for OpenRouter/OpenAI tool-use protocol)
// ---------------------------------------------------------------------------

interface ToolUseMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_calls?: OpenRouterToolCall[];
  tool_call_id?: string;
}

interface OpenRouterToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

interface OpenRouterToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface OpenRouterChatResponse {
  choices?: {
    message?: {
      role?: string;
      content?: string | null;
      tool_calls?: OpenRouterToolCall[];
    };
    finish_reason?: string;
  }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

// ---------------------------------------------------------------------------
// OpenRouterFactoryAgent
// ---------------------------------------------------------------------------

export class OpenRouterFactoryAgent implements LoopAgent {
  private config: FactoryAgentConfig;
  private directFetchImpl: typeof globalThis.fetch | undefined;
  private promptLoader: PromptLoader;
  /** True when an OpenRouter API key is available; false means proxy path. */
  readonly useDirectApi: boolean;

  constructor(config: FactoryAgentConfig, promptLoader?: PromptLoader) {
    this.config = config;
    this.promptLoader = promptLoader ?? new FilePromptLoader();

    let rawApiKey =
      process.env.OPENROUTER_API_KEY ?? config.openRouterApiKey ?? undefined;
    let apiKey =
      typeof rawApiKey === 'string' ? rawApiKey.trim() || undefined : undefined;
    this.useDirectApi = apiKey !== undefined;

    if (this.useDirectApi) {
      let directApiKey = apiKey!;
      this.directFetchImpl = ((
        input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        let headers = new Headers(init?.headers);
        if (!headers.has('Authorization')) {
          headers.set('Authorization', `Bearer ${directApiKey}`);
        }
        return globalThis.fetch(input, { ...init, headers });
      }) as typeof globalThis.fetch;
    }
  }

  async run(
    context: AgentContext,
    tools: FactoryTool[],
  ): Promise<AgentRunResult> {
    let messages = this.buildMessages(context);
    let toolDefs = this.buildToolDefinitions(tools);
    let toolCallLog: ToolCallEntry[] = [];

    if (this.config.debug) {
      this.debugLog('=== Initial prompt ===');
      for (let msg of messages) {
        this.debugLog(
          `[${msg.role}] ${(msg.content ?? '').slice(0, 2000)}${(msg.content ?? '').length > 2000 ? '... (truncated)' : ''}`,
        );
      }
      this.debugLog(
        `=== Tools (${toolDefs.length}): ${toolDefs.map((t) => t.function.name).join(', ')} ===`,
      );
    }

    // Multi-turn tool-calling loop
    for (let turn = 0; turn < MAX_TOOL_USE_TURNS; turn++) {
      let response = await this.callOpenRouterWithTools(messages, toolDefs);
      let choice = response.choices?.[0];

      if (this.config.debug) {
        this.debugLog(`=== LLM response (turn ${turn + 1}) ===`);
        this.debugLog(JSON.stringify(choice?.message ?? {}, null, 2));
        if (choice?.finish_reason) {
          this.debugLog(`finish_reason: ${choice.finish_reason}`);
        }
        if (response.usage) {
          this.debugLog(
            `tokens: prompt=${response.usage.prompt_tokens} completion=${response.usage.completion_tokens} total=${response.usage.total_tokens}`,
          );
        }
      }

      if (!choice?.message) {
        throw new Error(
          `Unexpected OpenRouter response: no choices[0].message in ${JSON.stringify(response).slice(0, 500)}`,
        );
      }

      let assistantToolCalls = choice.message.tool_calls;

      // No tool calls — model finished its turn
      if (!assistantToolCalls || assistantToolCalls.length === 0) {
        // Model stopped without calling signal_done. If it produced tool
        // calls in a prior iteration, treat as done. Otherwise needs_iteration.
        return {
          status: toolCallLog.length > 0 ? 'done' : 'needs_iteration',
          toolCalls: toolCallLog,
          message: choice.message.content ?? undefined,
        };
      }

      // Add assistant message (with tool_calls) to conversation history
      messages.push({
        role: 'assistant',
        content: choice.message.content ?? null,
        tool_calls: assistantToolCalls,
      });

      // Execute each tool call. With `parallel_tool_calls: true` a single
      // assistant turn can carry multiple tool_calls[]; if the batch contains
      // a terminal signal (signal_done / request_clarification) alongside
      // other tools, we still execute the whole batch so the model's other
      // side effects land, then return the first terminal signal observed.
      let terminalResult: AgentRunResult | undefined;
      for (let toolCall of assistantToolCalls) {
        let toolName = toolCall.function.name;
        let tool = tools.find((t) => t.name === toolName);

        if (!tool) {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify({
              error: `Unknown tool: ${toolName}`,
            }),
          });
          continue;
        }

        let args: Record<string, unknown>;
        try {
          args = JSON.parse(toolCall.function.arguments);
        } catch {
          args = {};
        }

        if (this.config.debug) {
          this.debugLog(`>>> tool call: ${toolName}(${JSON.stringify(args)})`);
        }

        let start = Date.now();
        let result: unknown;
        try {
          result = await tool.execute(args);
        } catch (error) {
          result = {
            error: error instanceof Error ? error.message : String(error),
          };
        }
        let durationMs = Date.now() - start;

        if (this.config.debug) {
          let resultStr = JSON.stringify(result);
          this.debugLog(
            `<<< tool result: ${toolName} (${durationMs}ms) ${resultStr.slice(0, 1000)}${resultStr.length > 1000 ? '... (truncated)' : ''}`,
          );
        }

        toolCallLog.push({ tool: toolName, args, result, durationMs });

        // Check for control flow signals
        if (result && typeof result === 'object' && 'signal' in result) {
          let signal = (result as Record<string, unknown>).signal;
          if (signal === DONE_SIGNAL) {
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify({ status: 'done' }),
            });
            terminalResult ??= { status: 'done', toolCalls: toolCallLog };
            continue;
          }
          if (signal === CLARIFICATION_SIGNAL) {
            let clarificationMessage = (result as Record<string, unknown>)
              .message as string;
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify({
                status: 'blocked',
                message: clarificationMessage,
              }),
            });
            terminalResult ??= {
              status: 'blocked',
              toolCalls: toolCallLog,
              message: clarificationMessage,
            };
            continue;
          }
        }

        // Normal tool result — add to conversation
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
      }

      if (terminalResult) {
        return terminalResult;
      }
    }

    throw new Error(
      `Tool-use loop exceeded ${MAX_TOOL_USE_TURNS} turns without completing. ` +
        `The model may be stuck in a tool-calling loop.`,
    );
  }

  /**
   * Build messages for the tool-use agent.
   *
   * The system prompt is loaded from prompts/system.md via the prompt loader.
   * Tools are provided natively via the LLM API's tool definitions parameter,
   * not embedded in the prompt text.
   */
  private buildMessages(context: AgentContext): ToolUseMessage[] {
    let systemPrompt = this.buildToolUseSystemPrompt(context);

    let userPrompt: string;
    let issueType = (context.issue as Record<string, unknown>).issueType;
    if (issueType === 'bootstrap' && context.briefUrl) {
      userPrompt = assembleBootstrapPrompt({
        context,
        loader: this.promptLoader,
      });
    } else if (context.validationContext) {
      // Validation failures from prior iteration — use iterate prompt
      // so the agent receives formatted failure context for self-correction
      userPrompt = assembleIteratePrompt({
        context,
        previousActions: [],
        iteration: context.iteration ?? 1,
        loader: this.promptLoader,
      });
    } else {
      userPrompt = assembleImplementPrompt({
        context,
        loader: this.promptLoader,
      });
    }

    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];
  }

  /**
   * Build a system prompt for the tool-use agent using the
   * prompts/system.md template. Tools are provided via the API's
   * native tool definitions, not embedded in the prompt text.
   */
  private buildToolUseSystemPrompt(context: AgentContext): string {
    let skills = context.skills.map((s: ResolvedSkill) => ({
      name: s.name,
      content: s.content,
      references: s.references ?? [],
    }));

    return this.promptLoader.load('system', {
      targetRealmUrl: context.targetRealmUrl,
      skills,
    });
  }

  /**
   * Convert FactoryTool[] to OpenRouter/OpenAI tool definitions.
   */
  private buildToolDefinitions(
    tools: FactoryTool[],
  ): OpenRouterToolDefinition[] {
    return tools.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }

  /**
   * Call OpenRouter with tool definitions.
   */
  private async callOpenRouterWithTools(
    messages: ToolUseMessage[],
    tools: OpenRouterToolDefinition[],
  ): Promise<OpenRouterChatResponse> {
    let body: Record<string, unknown> = {
      model: this.config.model,
      messages,
      stream: false,
    };

    if (tools.length > 0) {
      body.tools = tools;
      // Opt in to OpenAI-compatible parallel tool calls so a single assistant
      // turn can emit multiple tool_calls[]. Without this, OpenRouter routes
      // to Anthropic serialize 1 call/turn and re-send the full context each
      // round, producing the O(n²) context blow-up observed in CS-10814.
      body.parallel_tool_calls = true;
    }

    let response: Response;

    if (this.useDirectApi) {
      response = await this.directFetchImpl!(OPENROUTER_CHAT_URL, {
        method: 'POST',
        headers: {
          Accept: SupportedMimeType.JSON,
          'Content-Type': SupportedMimeType.JSON,
        },
        body: JSON.stringify(body),
      });
    } else {
      let proxyUrl = new URL(
        '_request-forward',
        this.config.realmServerUrl,
      ).toString();

      response = await this.config.client.authedServerFetch(proxyUrl, {
        method: 'POST',
        headers: {
          Accept: SupportedMimeType.JSON,
          'Content-Type': SupportedMimeType.JSON,
        },
        body: JSON.stringify({
          url: OPENROUTER_CHAT_URL,
          method: 'POST',
          requestBody: JSON.stringify(body),
        }),
      });
    }

    if (!response.ok) {
      let errorText = await response.text();
      throw new Error(
        `OpenRouter tool-use request failed: HTTP ${response.status}: ${errorText.slice(0, 500)}`,
      );
    }

    return (await response.json()) as OpenRouterChatResponse;
  }

  private debugLog(message: string): void {
    process.stderr.write(`[factory:debug] ${message}\n`);
  }
}
