/**
 * Shared types, interfaces, and constants for the factory agent system.
 *
 * This module contains all the data types used across the declarative agent
 * (factory-agent.ts), the tool-use agent (factory-agent-tool-use.ts), and
 * their consumers (loop, context builder, prompt loader, etc.).
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const OPENROUTER_CHAT_URL =
  'https://openrouter.ai/api/v1/chat/completions' as const;

/**
 * Default OpenRouter model when `--agent openrouter` is selected without
 * a `=<model-id>` suffix. Uses the unversioned Claude Opus alias so new
 * releases route automatically. Update if a newer flagship family ships.
 */
export const FACTORY_DEFAULT_OPENROUTER_MODEL = 'anthropic/claude-opus-4';

export const FACTORY_AGENT_PROVIDERS = [
  'claude',
  'codex',
  'openrouter',
] as const;

export type FactoryAgentProvider = (typeof FACTORY_AGENT_PROVIDERS)[number];

export interface ParsedAgentFlag {
  provider: FactoryAgentProvider;
  /** Only set when provider === 'openrouter'. */
  openRouterModel?: string;
}

export const VALID_ACTION_TYPES = [
  'create_file',
  'update_file',
  'create_test',
  'update_test',
  'update_issue',
  'create_knowledge',
  'invoke_tool',
  'request_clarification',
  'done',
] as const;

export const VALID_REALMS = ['target', 'test'] as const;

// Action types that require path + content
export const FILE_ACTION_TYPES: ReadonlySet<string> = new Set([
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
  /** OpenRouter model ID (e.g., `anthropic/claude-opus-4`). */
  model: string;
  realmServerUrl: string;
  /** Boxel CLI client used to forward OpenRouter requests through the realm server. */
  client: import('@cardstack/boxel-cli/api').BoxelCLIClient;
  maxSkillTokens?: number;
  /** Call OpenRouter directly with this API key instead of going through the
   *  realm server _request-forward proxy. Useful for local dev / CI. */
  openRouterApiKey?: string;
  /** When true, log prompts sent to the LLM and responses received to stderr. */
  debug?: boolean;
}

/** Config for the Claude Code (Agent SDK) backend. */
export interface ClaudeCodeAgentConfig {
  /** When true, log SDK events to stderr. */
  debug?: boolean;
}

export interface ProjectData {
  id: string;
  [key: string]: unknown;
}

export interface IssueData {
  id: string;
  [key: string]: unknown;
}

export interface KnowledgeArticleData {
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

/** @deprecated Use ValidationResults from the validation pipeline instead. */
export interface TestResult {
  status: 'passed' | 'failed' | 'error';
  passedCount: number;
  failedCount: number;
  skippedCount?: number;
  failures: TestFailure[];
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Validation types (broader than TestResult)
// ---------------------------------------------------------------------------

/** Steps in the post-iteration validation pipeline. */
export type ValidationStep =
  | 'parse'
  | 'lint'
  | 'evaluate'
  | 'instantiate'
  | 'test';

export interface ValidationError {
  file?: string;
  message: string;
  stackTrace?: string;
}

/** Result of a single validation step. */
export interface ValidationStepResult {
  step: ValidationStep;
  passed: boolean;
  files?: string[];
  errors: ValidationError[];
  /** Step-specific structured data for context formatting (POJOs, not cards). */
  details?: Record<string, unknown>;
}

/** Aggregated results from a full validation run (all steps). */
export interface ValidationResults {
  passed: boolean;
  steps: ValidationStepResult[];
}

// ---------------------------------------------------------------------------
// Issue scheduling types
// ---------------------------------------------------------------------------

export type IssueStatus =
  | 'backlog'
  | 'in_progress'
  | 'blocked'
  | 'review'
  | 'done';
export type IssuePriority = 'critical' | 'high' | 'medium' | 'low';

/** IssueData extended with the typed fields the IssueScheduler needs. */
export interface SchedulableIssue extends IssueData {
  status: IssueStatus;
  priority: IssuePriority;
  /** IDs of issues that must be done before this one can start. */
  blockedBy: string[];
  /** Explicit ordering for tie-breaking when priorities are equal. */
  order: number;
  /** Short summary for logging. */
  summary?: string;
  /** Issue type (e.g., 'bootstrap', 'feature'). Used by context builder. */
  issueType?: string;
}

export interface ToolResult {
  tool: string;
  exitCode: number;
  output: unknown;
  durationMs: number;
}

export interface AgentContext {
  project: ProjectData;
  issue: IssueData;
  knowledge: KnowledgeArticleData[];
  skills: ResolvedSkill[];
  /** @deprecated Tools are now provided separately as FactoryTool[] to agent.run(). */
  tools?: ToolManifest[];
  /** @deprecated Use validationResults/validationContext instead. */
  testResults?: TestResult;
  /** @deprecated Tool results are now returned inline during the agent's turn. */
  toolResults?: ToolResult[];
  /** @deprecated Replaced by tool call summary in the iteration prompt. */
  previousActions?: AgentAction[];
  /** @deprecated Iteration tracking is now owned by the orchestrator. */
  iteration?: number;
  targetRealmUrl: string;
  /** Validation results from the prior inner-loop iteration (used for pass/fail checks). */
  validationResults?: ValidationResults;
  /** Pre-formatted validation context from Validator.formatForContext() — the sole mechanism for validation reaching the LLM. */
  validationContext?: string;
  /** Brief URL for bootstrap issues. */
  briefUrl?: string;
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
// FactoryAgent interface (declarative model)
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
// Loop agent types (relocated from factory-loop.ts for Phase 2)
// ---------------------------------------------------------------------------

/** Minimal tool call log entry (mirrors ToolCallEntry from factory-tool-builder). */
export interface LoopToolCallEntry {
  tool: string;
  args: Record<string, unknown>;
  result: unknown;
  durationMs: number;
}

/** Minimal tool definition (mirrors FactoryTool from factory-tool-builder). */
export interface LoopFactoryTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

export type AgentRunStatus = 'done' | 'blocked' | 'needs_iteration';

export interface AgentRunResult {
  status: AgentRunStatus;
  toolCalls: LoopToolCallEntry[];
  /** Clarification message when status is 'blocked'. */
  message?: string;
}

/**
 * Agent interface required by the execution loop.
 * The agent receives context and tools, calls tools during its turn,
 * and returns a status signal with a log of tool calls made.
 */
export interface LoopAgent {
  run(context: AgentContext, tools: LoopFactoryTool[]): Promise<AgentRunResult>;
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/**
 * Parse a `--agent` CLI flag value into a provider + optional OpenRouter model.
 *
 * Accepted shapes:
 *   - undefined / empty → { provider: 'claude' } (default)
 *   - 'claude' → { provider: 'claude' }
 *   - 'codex' → { provider: 'codex' }
 *   - 'openrouter' → { provider: 'openrouter' } (caller applies FACTORY_DEFAULT_OPENROUTER_MODEL)
 *   - 'openrouter=anthropic/claude-sonnet-4' → { provider: 'openrouter', openRouterModel: 'anthropic/claude-sonnet-4' }
 *
 * A `=<model>` suffix is only legal for `openrouter`. Anything else throws.
 */
export function parseAgentFlag(raw: string | undefined): ParsedAgentFlag {
  let trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (trimmed === '') {
    return { provider: 'claude' };
  }

  let eq = trimmed.indexOf('=');
  let providerPart = eq === -1 ? trimmed : trimmed.slice(0, eq);
  let suffixPart = eq === -1 ? '' : trimmed.slice(eq + 1).trim();

  if (!FACTORY_AGENT_PROVIDERS.includes(providerPart as FactoryAgentProvider)) {
    throw new Error(
      `Invalid --agent provider: "${providerPart}". ` +
        `Valid values: ${FACTORY_AGENT_PROVIDERS.join(', ')}.`,
    );
  }
  let provider = providerPart as FactoryAgentProvider;

  if (eq !== -1 && provider !== 'openrouter') {
    throw new Error(
      `--agent ${provider} does not accept a "=<model>" suffix. ` +
        `Only --agent openrouter=<model-id> is supported.`,
    );
  }

  if (provider === 'openrouter') {
    if (eq === -1) {
      return { provider };
    }
    if (suffixPart === '') {
      throw new Error(
        `--agent openrouter=<model-id> requires a non-empty model id after "=".`,
      );
    }
    return { provider, openRouterModel: suffixPart };
  }

  return { provider };
}

/**
 * Derive a slug from an issue ID by taking the last path segment.
 * e.g., "Issues/sticky-note-define-core" → "sticky-note-define-core"
 */
export function deriveIssueSlug(issueId: string): string {
  let parts = issueId.split('/');
  return parts[parts.length - 1];
}
