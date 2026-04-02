/**
 * Tool-use factory agent — implements LoopAgent with native tool-use protocol.
 *
 * Instead of the old declarative model (agent returns AgentAction[] as JSON),
 * this agent sends tool definitions to the LLM via the API's tools parameter.
 * The LLM calls tools during its turn, the agent executes them via
 * FactoryTool.execute(), and returns results to the LLM. The conversation
 * continues until the LLM calls signal_done/request_clarification or stops
 * making tool calls.
 */

import { SupportedMimeType } from '@cardstack/runtime-common/supported-mime-type';

import { createBoxelRealmFetch } from '../../src/realm-auth';

import type {
  AgentContext,
  FactoryAgentConfig,
  ResolvedSkill,
} from './factory-agent-types';
import { OPENROUTER_CHAT_URL } from './factory-agent-types';
import type { LoopAgent, AgentRunResult } from './factory-loop';
import {
  assembleImplementPrompt,
  assembleIteratePrompt,
  FilePromptLoader,
  type PromptLoader,
} from './factory-prompt-loader';
import {
  DONE_SIGNAL,
  CLARIFICATION_SIGNAL,
  type FactoryTool,
  type ToolCallEntry,
} from './factory-tool-builder';

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
// ToolUseFactoryAgent
// ---------------------------------------------------------------------------

export class ToolUseFactoryAgent implements LoopAgent {
  private config: FactoryAgentConfig;
  private fetchImpl: typeof globalThis.fetch;
  private promptLoader: PromptLoader;
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
      this.fetchImpl = ((input: RequestInfo | URL, init?: RequestInit) => {
        let headers = new Headers(init?.headers);
        if (!headers.has('Authorization')) {
          headers.set('Authorization', `Bearer ${directApiKey}`);
        }
        return globalThis.fetch(input, { ...init, headers });
      }) as typeof globalThis.fetch;
    } else {
      this.fetchImpl = createBoxelRealmFetch(config.realmServerUrl, {
        authorization: config.authorization?.trim() || undefined,
      });
    }
  }

  async run(
    context: AgentContext,
    tools: FactoryTool[],
  ): Promise<AgentRunResult> {
    let messages = this.buildMessages(context);
    let toolDefs = this.buildToolDefinitions(tools);
    let toolCallLog: ToolCallEntry[] = [];

    // Multi-turn tool-calling loop
    // eslint-disable-next-line no-constant-condition
    while (true) {
      let response = await this.callOpenRouterWithTools(messages, toolDefs);
      let choice = response.choices?.[0];

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

      // Execute each tool call
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

        toolCallLog.push({ tool: toolName, args, result, durationMs });

        // Check for control flow signals
        if (result && typeof result === 'object' && 'signal' in result) {
          let signal = (result as Record<string, unknown>).signal;
          if (signal === DONE_SIGNAL) {
            // Add tool result to messages so conversation is well-formed
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify({ status: 'done' }),
            });
            return { status: 'done', toolCalls: toolCallLog };
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
            return {
              status: 'blocked',
              toolCalls: toolCallLog,
              message: clarificationMessage,
            };
          }
        }

        // Normal tool result — add to conversation
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
      }
    }
  }

  /**
   * Build messages for the tool-use agent.
   *
   * The system prompt is constructed directly (not from the template) because
   * the template-based system.md uses the old declarative action model. With
   * native tool-use, tools are provided via the API parameter, and the agent
   * calls tools directly rather than outputting a JSON action array.
   *
   * The user prompt reuses the ticket-implement template which is compatible
   * with both models.
   */
  private buildMessages(context: AgentContext): ToolUseMessage[] {
    let systemPrompt = this.buildToolUseSystemPrompt(context);

    let userPrompt: string;
    if (context.testResults) {
      userPrompt = assembleIteratePrompt({
        context,
        previousActions: context.previousActions ?? [],
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
      testRealmUrl: context.testRealmUrl,
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
    }

    let response: Response;

    if (this.useDirectApi) {
      response = await this.fetchImpl(OPENROUTER_CHAT_URL, {
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

      response = await this.fetchImpl(proxyUrl, {
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
}
