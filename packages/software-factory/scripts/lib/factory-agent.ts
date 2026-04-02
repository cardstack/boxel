/**
 * Declarative factory agent (old model) + barrel re-exports.
 *
 * This file contains the OpenRouterFactoryAgent (declarative plan() model),
 * validation functions, and MockFactoryAgent. It also re-exports all types
 * from factory-agent-types.ts and the tool-use agent from
 * factory-agent-tool-use.ts so that existing imports continue to work.
 */

import { SupportedMimeType } from '@cardstack/runtime-common/supported-mime-type';

import { createBoxelRealmFetch } from '../../src/realm-auth';

import {
  OPENROUTER_CHAT_URL,
  VALID_ACTION_TYPES,
  VALID_REALMS,
  FILE_ACTION_TYPES,
  type AgentActionType,
  type ActionRealm,
  type AgentAction,
  type AgentContext,
  type ChatMessage,
  type FactoryAgent,
  type FactoryAgentConfig,
} from './factory-agent-types';
import {
  assembleImplementPrompt,
  assembleIteratePrompt,
  assembleSystemPrompt,
  buildOneShotMessages,
  FilePromptLoader,
  type PromptLoader,
} from './factory-prompt-loader';

// ---------------------------------------------------------------------------
// Re-exports — keep existing import paths working
// ---------------------------------------------------------------------------

export * from './factory-agent-types';
export { ToolUseFactoryAgent, MockLoopAgent } from './factory-agent-tool-use';

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

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
// OpenRouterFactoryAgent (declarative plan() model)
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
      userPrompt = assembleIteratePrompt({
        context,
        previousActions: previousActions ?? [],
        iteration: iteration ?? 1,
        loader: this.promptLoader,
      });
    } else {
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
// MockFactoryAgent (declarative plan() model)
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
