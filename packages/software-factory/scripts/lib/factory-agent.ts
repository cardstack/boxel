import { SupportedMimeType } from '@cardstack/runtime-common/supported-mime-type';

import { createBoxelRealmFetch } from '../../src/realm-auth';

import type { LoopAgent, AgentRunResult } from './factory-loop';
import {
  assembleImplementPrompt,
  assembleIteratePrompt,
  assembleSystemPrompt,
  buildOneShotMessages,
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
// Constants
// ---------------------------------------------------------------------------

const OPENROUTER_CHAT_URL =
  'https://openrouter.ai/api/v1/chat/completions' as const;

/**
 * Default model for the factory. Uses OpenRouter's unversioned alias so it
 * automatically routes to the latest release in the family.
 * Update this constant when a newer Claude family ships.
 */
export const FACTORY_DEFAULT_MODEL = 'anthropic/claude-sonnet-4';

const VALID_ACTION_TYPES = [
  'create_file',
  'update_file',
  'create_test',
  'update_test',
  'update_ticket',
  'create_knowledge',
  'invoke_tool',
  'request_clarification',
  'done',
] as const;

const VALID_REALMS = ['target', 'test'] as const;

// Action types that require path + content
const FILE_ACTION_TYPES: ReadonlySet<string> = new Set([
  'create_file',
  'update_file',
  'create_test',
  'update_test',
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentActionType = (typeof VALID_ACTION_TYPES)[number];
export type ActionRealm = (typeof VALID_REALMS)[number];

export interface FactoryAgentConfig {
  model: string;
  realmServerUrl: string;
  authorization?: string;
  maxSkillTokens?: number;
  /** Call OpenRouter directly with this API key instead of going through the
   *  realm server _request-forward proxy. Useful for local dev / CI. */
  openRouterApiKey?: string;
}

export interface ProjectCard {
  id: string;
  [key: string]: unknown;
}

export interface TicketCard {
  id: string;
  [key: string]: unknown;
}

export interface KnowledgeArticle {
  id: string;
  [key: string]: unknown;
}

export interface ResolvedSkill {
  name: string;
  content: string;
  references?: string[];
}

export interface ToolArg {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

export interface ToolManifest {
  name: string;
  description: string;
  category: 'script' | 'boxel-cli' | 'realm-api';
  args: ToolArg[];
  outputFormat: 'json' | 'text';
}

export interface TestFailure {
  testName: string;
  error: string;
  stackTrace?: string;
}

export interface TestResult {
  status: 'passed' | 'failed' | 'error';
  passedCount: number;
  failedCount: number;
  failures: TestFailure[];
  durationMs: number;
}

export interface ToolResult {
  tool: string;
  exitCode: number;
  output: unknown;
  durationMs: number;
}

export interface AgentContext {
  project: ProjectCard;
  ticket: TicketCard;
  knowledge: KnowledgeArticle[];
  skills: ResolvedSkill[];
  /** @deprecated Tools are now provided separately as FactoryTool[] to agent.run(). */
  tools?: ToolManifest[];
  testResults?: TestResult;
  /** @deprecated Tool results are now returned inline during the agent's turn. */
  toolResults?: ToolResult[];
  /** @deprecated Replaced by tool call summary in the iteration prompt. */
  previousActions?: AgentAction[];
  /** @deprecated Iteration tracking is now owned by the orchestrator. */
  iteration?: number;
  targetRealmUrl: string;
  testRealmUrl: string;
}

export interface AgentAction {
  type: AgentActionType;
  path?: string;
  content?: string;
  realm?: ActionRealm;
  tool?: string;
  toolArgs?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// FactoryAgent interface
// ---------------------------------------------------------------------------

export interface FactoryAgent {
  plan(context: AgentContext): Promise<AgentAction[]>;
}

// ---------------------------------------------------------------------------
// Message types (for LLM communication)
// ---------------------------------------------------------------------------

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/**
 * Resolve which model to use.
 * Priority: explicit CLI arg > FACTORY_LLM_MODEL env > FACTORY_DEFAULT_MODEL
 */
export function resolveFactoryModel(cliModel?: string): string {
  if (cliModel && cliModel.trim() !== '') {
    return cliModel.trim();
  }

  let envModel = process.env.FACTORY_LLM_MODEL;
  if (envModel && envModel.trim() !== '') {
    return envModel.trim();
  }

  return FACTORY_DEFAULT_MODEL;
}

/**
 * Validate an array of raw objects as AgentAction[].
 * Throws with a descriptive message on the first invalid action.
 */
export function validateAgentActions(raw: unknown[]): AgentAction[] {
  let validated: AgentAction[] = [];

  for (let i = 0; i < raw.length; i++) {
    let item = raw[i];

    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new AgentActionValidationError(
        `Action at index ${i} must be a non-null object`,
      );
    }

    let action = item as Record<string, unknown>;

    if (typeof action.type !== 'string' || !isValidActionType(action.type)) {
      throw new AgentActionValidationError(
        `Action at index ${i} has invalid type: ${JSON.stringify(action.type)}. ` +
          `Expected one of: ${VALID_ACTION_TYPES.join(', ')}`,
      );
    }

    let type = action.type as AgentActionType;

    // File actions require path and content
    if (FILE_ACTION_TYPES.has(type)) {
      if (typeof action.path !== 'string' || action.path.trim() === '') {
        throw new AgentActionValidationError(
          `Action at index ${i} (${type}) requires a non-empty "path"`,
        );
      }
      if (typeof action.content !== 'string') {
        throw new AgentActionValidationError(
          `Action at index ${i} (${type}) requires "content" to be a string`,
        );
      }
    }

    // invoke_tool requires tool name and valid toolArgs
    if (type === 'invoke_tool') {
      if (typeof action.tool !== 'string' || action.tool.trim() === '') {
        throw new AgentActionValidationError(
          `Action at index ${i} (invoke_tool) requires a non-empty "tool"`,
        );
      }
      if (
        action.toolArgs !== undefined &&
        (typeof action.toolArgs !== 'object' ||
          action.toolArgs === null ||
          Array.isArray(action.toolArgs))
      ) {
        throw new AgentActionValidationError(
          `Action at index ${i} (invoke_tool) has invalid "toolArgs": expected a plain object`,
        );
      }
    }

    // Validate realm if present
    if (action.realm !== undefined) {
      if (typeof action.realm !== 'string' || !isValidRealm(action.realm)) {
        throw new AgentActionValidationError(
          `Action at index ${i} has invalid realm: ${JSON.stringify(action.realm)}. ` +
            `Expected one of: ${VALID_REALMS.join(', ')}`,
        );
      }
    }

    validated.push({
      type,
      ...(action.path !== undefined ? { path: String(action.path) } : {}),
      ...(action.content !== undefined
        ? { content: String(action.content) }
        : {}),
      ...(action.realm !== undefined
        ? { realm: action.realm as ActionRealm }
        : {}),
      ...(action.tool !== undefined ? { tool: String(action.tool) } : {}),
      ...(action.toolArgs !== undefined &&
      typeof action.toolArgs === 'object' &&
      action.toolArgs !== null
        ? { toolArgs: action.toolArgs as Record<string, unknown> }
        : {}),
    });
  }

  return validated;
}

/**
 * Parse an LLM response string into AgentAction[].
 * Strips markdown code fences if present, parses JSON, and validates.
 */
export function parseActionsFromResponse(text: string): AgentAction[] {
  let stripped = stripMarkdownFences(text);

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch (_error) {
    throw new AgentResponseParseError(
      `Failed to parse response as JSON: ${stripped.slice(0, 200)}...`,
    );
  }

  if (!Array.isArray(parsed)) {
    throw new AgentResponseParseError(
      `Expected a JSON array of AgentAction objects, got ${typeof parsed}`,
    );
  }

  return validateAgentActions(parsed);
}

function stripMarkdownFences(text: string): string {
  let trimmed = text.trim();

  // Match ```json ... ``` or ``` ... ```
  let fenceMatch = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n\s*```\s*$/);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }

  return trimmed;
}

function isValidActionType(value: string): value is AgentActionType {
  return (VALID_ACTION_TYPES as readonly string[]).includes(value);
}

function isValidRealm(value: string): value is ActionRealm {
  return (VALID_REALMS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

export class AgentActionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentActionValidationError';
  }
}

export class AgentResponseParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentResponseParseError';
  }
}

// ---------------------------------------------------------------------------
// OpenRouterFactoryAgent
// ---------------------------------------------------------------------------

export class OpenRouterFactoryAgent implements FactoryAgent {
  private config: FactoryAgentConfig;
  private fetchImpl: typeof globalThis.fetch;
  private promptLoader: PromptLoader;
  /** True when calling OpenRouter directly; false when proxying via realm server. */
  readonly useDirectApi: boolean;

  constructor(config: FactoryAgentConfig, promptLoader?: PromptLoader) {
    this.config = config;
    this.promptLoader = promptLoader ?? new FilePromptLoader();

    // Env var takes precedence — lets you override the proxy path at runtime.
    // Trim and treat empty/whitespace-only values as missing so that
    // OPENROUTER_API_KEY='' in CI doesn't accidentally bypass the proxy.
    let rawApiKey =
      process.env.OPENROUTER_API_KEY ?? config.openRouterApiKey ?? undefined;
    let apiKey =
      typeof rawApiKey === 'string' ? rawApiKey.trim() || undefined : undefined;
    this.useDirectApi = apiKey !== undefined;

    if (this.useDirectApi) {
      // Direct path — plain fetch with the API key in the Authorization header.
      let directApiKey = apiKey!;
      this.fetchImpl = ((input: RequestInfo | URL, init?: RequestInit) => {
        let headers = new Headers(init?.headers);
        if (!headers.has('Authorization')) {
          headers.set('Authorization', `Bearer ${directApiKey}`);
        }
        return globalThis.fetch(input, { ...init, headers });
      }) as typeof globalThis.fetch;
    } else {
      // Proxy path — authenticated fetch through realm server _request-forward.
      // Pass authorization through as-is (callers provide the full header value
      // e.g. "Bearer <token>") to avoid double-prefixing.
      this.fetchImpl = createBoxelRealmFetch(config.realmServerUrl, {
        authorization: config.authorization?.trim() || undefined,
      });
    }
  }

  async plan(context: AgentContext): Promise<AgentAction[]> {
    let messages = this.buildMessages(
      context,
      context.previousActions,
      context.iteration,
    );
    let responseText: string;

    try {
      responseText = await this.callOpenRouter(messages);
    } catch (error) {
      throw new Error(
        `OpenRouter request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    try {
      return parseActionsFromResponse(responseText);
    } catch (firstError) {
      // Retry once with error correction prompt
      let correctionMessages: ChatMessage[] = [
        ...messages,
        { role: 'assistant', content: responseText },
        {
          role: 'user',
          content:
            `Your previous response could not be parsed as a valid JSON array of AgentAction objects.\n` +
            `Error: ${firstError instanceof Error ? firstError.message : String(firstError)}\n\n` +
            `Please respond with ONLY a valid JSON array of AgentAction objects. No markdown fences, no explanation.`,
        },
      ];

      let retryText: string;
      try {
        retryText = await this.callOpenRouter(correctionMessages);
      } catch (error) {
        throw new Error(
          `OpenRouter retry request failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      try {
        return parseActionsFromResponse(retryText);
      } catch (secondError) {
        throw new Error(
          `Failed to parse agent response after retry.\n` +
            `First error: ${firstError instanceof Error ? firstError.message : String(firstError)}\n` +
            `Retry error: ${secondError instanceof Error ? secondError.message : String(secondError)}\n` +
            `Original response: ${responseText.slice(0, 500)}\n` +
            `Retry response: ${retryText.slice(0, 500)}`,
        );
      }
    }
  }

  /**
   * Build the message array for a one-shot LLM call.
   * Uses prompt templates for consistent, model-agnostic prompt assembly.
   *
   * If the context includes testResults (i.e., this is an iteration pass),
   * the user prompt uses ticket-iterate. Otherwise it uses ticket-implement.
   * The implement prompt also includes tool results when present (e.g.,
   * after invoke_tool actions from a prior plan() call).
   */
  buildMessages(
    context: AgentContext,
    previousActions?: AgentAction[],
    iteration?: number,
  ): ChatMessage[] {
    let systemPrompt = assembleSystemPrompt({
      context,
      loader: this.promptLoader,
    });

    let userPrompt: string;

    if (context.testResults) {
      // Iteration pass — ticket-iterate template.
      // Provide sensible defaults when previousActions/iteration are not supplied.
      userPrompt = assembleIteratePrompt({
        context,
        previousActions: previousActions ?? [],
        iteration: iteration ?? 1,
        loader: this.promptLoader,
      });
    } else {
      // First pass — ticket-implement template.
      // Includes tool results when present (e.g., after invoke_tool).
      userPrompt = assembleImplementPrompt({
        context,
        loader: this.promptLoader,
      });
    }

    let [system, user] = buildOneShotMessages(systemPrompt, userPrompt);
    return [system, user];
  }

  private async callOpenRouter(messages: ChatMessage[]): Promise<string> {
    let response: Response;

    if (this.useDirectApi) {
      // Direct path — call OpenRouter API directly with the API key.
      response = await this.fetchImpl(OPENROUTER_CHAT_URL, {
        method: 'POST',
        headers: {
          Accept: SupportedMimeType.JSON,
          'Content-Type': SupportedMimeType.JSON,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages,
          stream: false,
        }),
      });
    } else {
      // Proxy path — go through realm server _request-forward.
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
          requestBody: JSON.stringify({
            model: this.config.model,
            messages,
            stream: false,
          }),
        }),
      });
    }

    if (!response.ok) {
      let errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText.slice(0, 500)}`);
    }

    let json = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };

    let content = json.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new Error(
        `Unexpected response structure: no choices[0].message.content in ${JSON.stringify(json).slice(0, 500)}`,
      );
    }

    return content;
  }
}

// ---------------------------------------------------------------------------
// MockFactoryAgent
// ---------------------------------------------------------------------------

export class MockFactoryAgent implements FactoryAgent {
  private responses: AgentAction[][];
  private callIndex = 0;

  /** All AgentContext inputs received, in order. */
  readonly receivedContexts: AgentContext[] = [];

  constructor(responses: AgentAction[][]) {
    this.responses = responses;
  }

  async plan(context: AgentContext): Promise<AgentAction[]> {
    this.receivedContexts.push(context);

    if (this.callIndex >= this.responses.length) {
      throw new Error(
        `MockFactoryAgent exhausted: called ${this.callIndex + 1} times ` +
          `but only ${this.responses.length} response(s) were configured`,
      );
    }

    let response = this.responses[this.callIndex];
    this.callIndex++;
    return response;
  }

  /** Number of times plan() has been called. */
  get callCount(): number {
    return this.callIndex;
  }
}

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
// ToolUseFactoryAgent — implements LoopAgent with native tool-use
// ---------------------------------------------------------------------------

/**
 * Factory agent that uses the LLM's native tool-use protocol.
 *
 * Instead of the old declarative model (agent returns AgentAction[] as JSON),
 * this agent sends tool definitions to the LLM via the API's tools parameter.
 * The LLM calls tools during its turn, the agent executes them via
 * FactoryTool.execute(), and returns results to the LLM. The conversation
 * continues until the LLM calls signal_done/request_clarification or stops
 * making tool calls.
 */
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
   * The user prompt reuses the ticket-implement / ticket-iterate templates
   * which are compatible with both models.
   */
  private buildMessages(context: AgentContext): ToolUseMessage[] {
    let systemPrompt = this.buildToolUseSystemPrompt(context);

    let userPrompt: string;
    if (context.testResults) {
      userPrompt = this.buildToolUseIteratePrompt(context);
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
   * Build a system prompt for the tool-use agent. Tools are provided via
   * the API's native tool definitions, not embedded in the prompt text.
   */
  private buildToolUseSystemPrompt(context: AgentContext): string {
    let parts: string[] = [
      '# Role',
      '',
      'You are a software factory agent. You implement Boxel cards and tests in',
      'target realms based on ticket descriptions and project context.',
      '',
      'You have access to tools for reading and writing files to realms, searching',
      'realm state, running tests, and signaling completion. Use these tools to',
      'inspect existing state before making changes — do not guess.',
      '',
      '# Rules',
      '',
      '- Every ticket must include at least one Playwright test file (via write_file to Tests/).',
      '- For each top-level card defined in the brief, create a Catalog Spec card',
      "  in the target realm's Spec/ folder (adoptsFrom https://cardstack.com/base/spec#Spec)",
      '  and at least one sample card instance linked via linkedExamples.',
      '- Use search_realm and read_file to inspect existing cards before creating files.',
      '- If you cannot proceed, call request_clarification with a description of what',
      '  is blocked.',
      '- When all implementation and test files have been written, call signal_done.',
      '- All file operations use the realm HTTP API. Write card definitions as .gts',
      '  files and card instances as .json files.',
      '',
      '# Realms',
      '',
      `- Target realm: ${context.targetRealmUrl}`,
      `- Test realm: ${context.testRealmUrl}`,
    ];

    // Add skills
    for (let skill of context.skills) {
      parts.push('', `# Skill: ${skill.name}`, '', skill.content);
      if (skill.references) {
        for (let ref of skill.references) {
          parts.push('', '### Reference', '', ref);
        }
      }
    }

    return parts.join('\n');
  }

  /**
   * Build the iterate prompt for the tool-use agent. Includes the ticket
   * context, a summary of previous tool calls, and the test failure details.
   */
  private buildToolUseIteratePrompt(context: AgentContext): string {
    let parts: string[] = [];

    // Project context
    let project = context.project as Record<string, unknown>;
    if (project.objective) {
      parts.push('# Project', '', String(project.objective), '');
    }

    // Ticket context
    let ticket = context.ticket as Record<string, unknown>;
    parts.push(
      '# Current Ticket',
      '',
      `ID: ${ticket.id}`,
      `Summary: ${ticket.summary ?? ''}`,
      '',
      'Description:',
      String(ticket.description ?? ''),
    );

    // Test results
    if (context.testResults) {
      parts.push(
        '',
        '# Test Results',
        '',
        'The orchestrator ran tests after your previous attempt. They failed.',
        '',
        `Status: ${context.testResults.status}`,
        `Passed: ${context.testResults.passedCount}`,
        `Failed: ${context.testResults.failedCount}`,
        `Duration: ${context.testResults.durationMs}ms`,
      );

      for (let failure of context.testResults.failures) {
        parts.push('', `## Failure: ${failure.testName}`, '', '```');
        parts.push(failure.error);
        parts.push('```');
        if (failure.stackTrace) {
          parts.push('', 'Stack trace:', '', '```');
          parts.push(failure.stackTrace);
          parts.push('```');
        }
      }
    }

    // Instructions
    parts.push(
      '',
      '# Instructions',
      '',
      'Fix the failing tests. You have the same tools available. You can:',
      '',
      '- Use read_file to inspect the current state of your implementation',
      '- Use write_file to update implementation or test files',
      '- Use search_realm to check what cards exist',
      '- If the test expectation is wrong, fix the test',
      '- If the implementation is wrong, fix the implementation',
      '',
      'When done, call signal_done.',
    );

    return parts.join('\n');
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
    let url: string;
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
      url = OPENROUTER_CHAT_URL;
      response = await this.fetchImpl(url, {
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

// ---------------------------------------------------------------------------
// MockLoopAgent — deterministic LoopAgent for testing
// ---------------------------------------------------------------------------

export class MockLoopAgent implements LoopAgent {
  private responses: AgentRunResult[];
  private callIndex = 0;

  /** All inputs received, in order. */
  readonly receivedContexts: AgentContext[] = [];
  readonly receivedTools: FactoryTool[][] = [];

  constructor(responses: AgentRunResult[]) {
    this.responses = responses;
  }

  async run(
    context: AgentContext,
    tools: FactoryTool[],
  ): Promise<AgentRunResult> {
    this.receivedContexts.push(context);
    this.receivedTools.push(tools);

    if (this.callIndex >= this.responses.length) {
      throw new Error(
        `MockLoopAgent exhausted: called ${this.callIndex + 1} times ` +
          `but only ${this.responses.length} response(s) were configured`,
      );
    }

    let response = this.responses[this.callIndex];
    this.callIndex++;
    return response;
  }

  get callCount(): number {
    return this.callIndex;
  }
}
