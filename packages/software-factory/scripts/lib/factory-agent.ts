import { createBoxelRealmFetch } from '../../src/realm-auth';

import {
  assembleImplementPrompt,
  assembleIteratePrompt,
  assembleSystemPrompt,
  buildOneShotMessages,
  FilePromptLoader,
  type PromptLoader,
} from './factory-prompt-loader';

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
  tools: ToolManifest[];
  testResults?: TestResult;
  toolResults?: ToolResult[];
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
    let messages = this.buildMessages(context);
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
          Accept: 'application/json',
          'Content-Type': 'application/json',
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
          Accept: 'application/json',
          'Content-Type': 'application/json',
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
