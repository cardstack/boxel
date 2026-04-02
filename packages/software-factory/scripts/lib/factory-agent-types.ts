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
 * Default model for the factory. Uses OpenRouter's unversioned alias so it
 * automatically routes to the latest release in the family.
 * Update this constant when a newer Claude family ships.
 */
export const FACTORY_DEFAULT_MODEL = 'anthropic/claude-sonnet-4';

export const VALID_ACTION_TYPES = [
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
