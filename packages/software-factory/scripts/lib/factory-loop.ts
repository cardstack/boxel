/**
 * Factory execution loop orchestrator.
 *
 * Runs the implement→test→iterate cycle for a single ticket. The agent
 * calls tools directly via the native tool-use protocol, and the
 * orchestrator mediates test execution and iteration decisions.
 *
 * Flow:
 * 1. Build AgentContext via ContextBuilder
 * 2. Call agent.run(context, tools) — agent calls tools during its turn
 * 3. Inspect AgentRunResult:
 *    - blocked → return clarification_needed
 *    - needs_iteration → loop back to step 1
 *    - done with no tool calls → return done
 *    - done with tool calls → run tests
 * 4. If tests pass → return tests_passed
 * 5. If tests fail → update testResults, loop back to step 1
 * 6. maxIterations guard prevents infinite loops
 */

import type {
  AgentContext,
  KnowledgeArticle,
  ProjectCard,
  TestResult,
  TicketCard,
} from './factory-agent';

import type { FactoryTool, ToolCallEntry } from './factory-tool-builder';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentRunStatus = 'done' | 'blocked' | 'needs_iteration';

export interface AgentRunResult {
  status: AgentRunStatus;
  toolCalls: ToolCallEntry[];
  /** Clarification message when status is 'blocked'. */
  message?: string;
}

/**
 * Agent interface required by the execution loop.
 * The agent receives context and tools, calls tools during its turn,
 * and returns a status signal with a log of tool calls made.
 */
export interface LoopAgent {
  run(context: AgentContext, tools: FactoryTool[]): Promise<AgentRunResult>;
}

export type LoopOutcome =
  | 'tests_passed'
  | 'done'
  | 'max_iterations'
  | 'clarification_needed';

export interface FactoryLoopResult {
  outcome: LoopOutcome;
  iterations: number;
  toolCallLog: ToolCallEntry[];
  testResults?: TestResult;
  message?: string;
}

/** Callback that runs Playwright tests against the target realm. */
export type TestRunner = () => Promise<TestResult>;

/**
 * Context builder interface — matches ContextBuilder.build() signature.
 * Defined here to avoid a circular dependency on the concrete class.
 */
export interface ContextBuilderLike {
  build(params: {
    project: ProjectCard;
    ticket: TicketCard;
    knowledge: KnowledgeArticle[];
    targetRealmUrl: string;
    testRealmUrl: string;
    testResults?: TestResult;
  }): Promise<AgentContext>;
}

export interface FactoryLoopConfig {
  agent: LoopAgent;
  contextBuilder: ContextBuilderLike;
  tools: FactoryTool[];
  testRunner: TestRunner;
  project: ProjectCard;
  ticket: TicketCard;
  knowledge: KnowledgeArticle[];
  targetRealmUrl: string;
  testRealmUrl: string;
  /** Maximum iterations before the loop gives up. Default: 5. */
  maxIterations?: number;
}

const DEFAULT_MAX_ITERATIONS = 5;

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

export async function runFactoryLoop(
  config: FactoryLoopConfig,
): Promise<FactoryLoopResult> {
  let {
    agent,
    contextBuilder,
    tools,
    testRunner,
    maxIterations = DEFAULT_MAX_ITERATIONS,
  } = config;

  let allToolCalls: ToolCallEntry[] = [];
  let testResults: TestResult | undefined;

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    // Build context — includes test results from prior iteration if any
    let context = await contextBuilder.build({
      project: config.project,
      ticket: config.ticket,
      knowledge: config.knowledge,
      targetRealmUrl: config.targetRealmUrl,
      testRealmUrl: config.testRealmUrl,
      testResults,
    });

    // Run the agent — it calls tools during its turn
    let result = await agent.run(context, tools);
    allToolCalls.push(...result.toolCalls);

    // Blocked — agent needs human clarification
    if (result.status === 'blocked') {
      return {
        outcome: 'clarification_needed',
        iterations: iteration,
        toolCallLog: allToolCalls,
        message: result.message,
      };
    }

    // Needs iteration — agent wants another turn (e.g., read-only round)
    if (result.status === 'needs_iteration') {
      continue;
    }

    // Done — agent finished its work for this turn
    if (result.toolCalls.length === 0) {
      // Bare done signal — nothing to test
      return {
        outcome: 'done',
        iterations: iteration,
        toolCallLog: allToolCalls,
      };
    }

    // Agent did work — run tests
    testResults = await testRunner();

    if (testResults.status === 'passed') {
      return {
        outcome: 'tests_passed',
        iterations: iteration,
        toolCallLog: allToolCalls,
        testResults,
      };
    }

    // Tests failed — loop continues with test results in context
  }

  return {
    outcome: 'max_iterations',
    iterations: maxIterations,
    toolCallLog: allToolCalls,
    testResults,
  };
}
