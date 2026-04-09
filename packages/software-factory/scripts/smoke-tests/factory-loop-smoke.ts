/**
 * Smoke test for the factory execution loop orchestrator.
 *
 * No servers, no API keys — exercises runFactoryLoop() with mock
 * collaborators to verify the loop state machine works end-to-end.
 *
 * Usage:
 *   pnpm smoke:loop
 *   pnpm smoke:loop --max-iterations 3
 */

// This should be first
import '../../src/setup-logger';

import { parseArgs } from 'node:util';
import { logger } from '../../src/logger';

import type {
  AgentContext,
  KnowledgeArticleData,
  ProjectData,
  TestResult,
  IssueData,
} from '../../src/factory-agent';

import type {
  FactoryTool,
  ToolCallEntry,
} from '../../src/factory-tool-builder';

import {
  runFactoryLoop,
  type AgentRunResult,
  type AgentRunStatus,
  type ContextBuilderLike,
  type FactoryLoopConfig,
  type FactoryLoopResult,
  type LoopAgent,
  type TestRunner,
} from '../../src/factory-loop';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let log = logger('factory-loop-smoke');

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    passed++;
    log.info(`  \u2713 ${label}`);
  } else {
    failed++;
    log.info(`  \u2717 ${label}${detail ? ` -- ${detail}` : ''}`);
  }
}

// ---------------------------------------------------------------------------
// Mock collaborators
// ---------------------------------------------------------------------------

interface MockToolCall {
  tool: string;
  args: Record<string, unknown>;
}

interface MockRunConfig {
  toolCalls: MockToolCall[];
  status: AgentRunStatus;
  message?: string;
}

class MockLoopAgent implements LoopAgent {
  private configs: MockRunConfig[];
  private callIndex = 0;
  readonly receivedContexts: AgentContext[] = [];

  constructor(configs: MockRunConfig[]) {
    this.configs = configs;
  }

  async run(
    context: AgentContext,
    tools: FactoryTool[],
  ): Promise<AgentRunResult> {
    this.receivedContexts.push(context);
    if (this.callIndex >= this.configs.length) {
      throw new Error(`MockLoopAgent exhausted at call ${this.callIndex + 1}`);
    }
    let config = this.configs[this.callIndex++];

    let toolCalls: ToolCallEntry[] = [];
    for (let call of config.toolCalls) {
      let tool = tools.find((t) => t.name === call.tool);
      if (!tool) {
        throw new Error(`Tool "${call.tool}" not found`);
      }
      let start = Date.now();
      let result = await tool.execute(call.args);
      toolCalls.push({
        tool: call.tool,
        args: call.args,
        result,
        durationMs: Date.now() - start,
      });
    }

    return { status: config.status, toolCalls, message: config.message };
  }

  get callCount(): number {
    return this.callIndex;
  }
}

class StubContextBuilder implements ContextBuilderLike {
  async build(params: {
    project: ProjectData;
    issue: IssueData;
    knowledge: KnowledgeArticleData[];
    targetRealmUrl: string;
    testResults?: TestResult;
  }): Promise<AgentContext> {
    return {
      project: params.project,
      issue: params.issue,
      knowledge: params.knowledge,
      skills: [],
      targetRealmUrl: params.targetRealmUrl,
      testResults: params.testResults,
    };
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROJECT: ProjectData = {
  id: 'Projects/sticky-notes',
  name: 'Sticky Notes MVP',
};

const ISSUE: IssueData = {
  id: 'Issues/define-sticky-note',
  title: 'Define StickyNote card',
  description: 'Create a .gts card definition for StickyNote.',
};

const KNOWLEDGE: KnowledgeArticleData[] = [
  { id: 'Knowledge/card-basics', title: 'Boxel Card Development Basics' },
];

function makeTool(name: string, result: unknown = { ok: true }): FactoryTool {
  return {
    name,
    description: `Mock ${name}`,
    parameters: {},
    execute: async () => result,
  };
}

const TOOLS: FactoryTool[] = [
  makeTool('write_file'),
  makeTool('read_file'),
  makeTool('search_realm'),
  makeTool('signal_done'),
  makeTool('request_clarification'),
];

function makeTestRunner(results: TestResult[]): TestRunner {
  let i = 0;
  return async () => {
    if (i >= results.length) {
      throw new Error(
        `Smoke-test testRunner exhausted: requested run #${i + 1} ` +
          `but only ${results.length} result(s) were configured.`,
      );
    }
    return results[i++];
  };
}

function makeBaseConfig(
  overrides: Partial<FactoryLoopConfig>,
): FactoryLoopConfig {
  return {
    agent: new MockLoopAgent([]),
    contextBuilder: new StubContextBuilder(),
    tools: TOOLS,
    testRunner: makeTestRunner([]),
    project: PROJECT,
    issue: ISSUE,
    knowledge: KNOWLEDGE,
    targetRealmUrl: 'https://example.test/target/',
    ...overrides,
  };
}

function printResult(result: FactoryLoopResult): void {
  log.info(`  outcome:    ${result.outcome}`);
  log.info(`  iterations: ${result.iterations}`);
  log.info(`  tool calls: ${result.toolCallLog.length}`);
  if (result.testResults) {
    log.info(
      `  tests:      ${result.testResults.passedCount} passed, ${result.testResults.failedCount} failed`,
    );
  }
  if (result.message) {
    log.info(`  message:    ${result.message}`);
  }
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

async function scenarioHappyPath(maxIterations: number): Promise<void> {
  log.info('--- Scenario 1: Happy path (implement + test pass) ---');
  log.info('');

  let agent = new MockLoopAgent([
    {
      toolCalls: [
        {
          tool: 'write_file',
          args: {
            path: 'sticky-note.gts',
            content: 'export class StickyNote {}',
          },
        },
        {
          tool: 'write_file',
          args: { path: 'StickyNote/welcome.json', content: '{ "data": {} }' },
        },
        {
          tool: 'write_file',
          args: { path: 'Spec/sticky-note.json', content: '{ "data": {} }' },
        },
        {
          tool: 'write_file',
          args: { path: 'Tests/sticky-note.spec.ts', content: 'test(...)' },
        },
      ],
      status: 'done',
    },
  ]);

  let result = await runFactoryLoop(
    makeBaseConfig({
      agent,
      maxIterations,
      testRunner: makeTestRunner([
        {
          status: 'passed',
          passedCount: 3,
          failedCount: 0,
          failures: [],
          durationMs: 5000,
        },
      ]),
    }),
  );

  printResult(result);
  check('outcome is tests_passed', result.outcome === 'tests_passed');
  check('completed in 1 iteration', result.iterations === 1);
  check('4 tool calls logged', result.toolCallLog.length === 4);
  check('tests passed', result.testResults?.status === 'passed');
  log.info('');
}

async function scenarioIterationPath(maxIterations: number): Promise<void> {
  log.info('--- Scenario 2: Iteration path (fail then fix) ---');
  log.info('');

  let agent = new MockLoopAgent([
    {
      toolCalls: [
        { tool: 'write_file', args: { path: 'card.gts', content: 'v1' } },
        {
          tool: 'write_file',
          args: { path: 'Tests/card.spec.ts', content: 'test v1' },
        },
      ],
      status: 'done',
    },
    {
      toolCalls: [
        { tool: 'write_file', args: { path: 'card.gts', content: 'v2 fixed' } },
      ],
      status: 'done',
    },
  ]);

  let result = await runFactoryLoop(
    makeBaseConfig({
      agent,
      maxIterations,
      testRunner: makeTestRunner([
        {
          status: 'failed',
          passedCount: 1,
          failedCount: 1,
          failures: [
            { testName: 'renders card', error: 'Expected element to exist' },
          ],
          durationMs: 5000,
        },
        {
          status: 'passed',
          passedCount: 3,
          failedCount: 0,
          failures: [],
          durationMs: 4000,
        },
      ]),
    }),
  );

  printResult(result);
  check('outcome is tests_passed', result.outcome === 'tests_passed');
  check('completed in 2 iterations', result.iterations === 2);
  check(
    'context threading: first call had no testResults',
    agent.receivedContexts[0].testResults === undefined,
  );
  check(
    'context threading: second call had failing testResults',
    agent.receivedContexts[1].testResults?.status === 'failed',
  );
  log.info('');
}

async function scenarioMaxIterations(maxIterations: number): Promise<void> {
  log.info(`--- Scenario 3: Max iterations (${maxIterations} failures) ---`);
  log.info('');

  let configs: MockRunConfig[] = [];
  let testResults: TestResult[] = [];
  for (let i = 0; i < maxIterations; i++) {
    configs.push({
      toolCalls: [
        {
          tool: 'write_file',
          args: { path: 'card.gts', content: `attempt ${i + 1}` },
        },
      ],
      status: 'done',
    });
    testResults.push({
      status: 'failed',
      passedCount: 0,
      failedCount: 1,
      failures: [{ testName: 'renders', error: `Fail #${i + 1}` }],
      durationMs: 3000,
    });
  }

  let result = await runFactoryLoop(
    makeBaseConfig({
      agent: new MockLoopAgent(configs),
      maxIterations,
      testRunner: makeTestRunner(testResults),
    }),
  );

  printResult(result);
  check('outcome is max_iterations', result.outcome === 'max_iterations');
  check(
    `stopped at ${maxIterations} iterations`,
    result.iterations === maxIterations,
  );
  check('last test result was failed', result.testResults?.status === 'failed');
  log.info('');
}

async function scenarioDoneSignal(): Promise<void> {
  log.info('--- Scenario 4: Bare done signal (no work) ---');
  log.info('');

  let result = await runFactoryLoop(
    makeBaseConfig({
      agent: new MockLoopAgent([{ toolCalls: [], status: 'done' }]),
    }),
  );

  printResult(result);
  check('outcome is done', result.outcome === 'done');
  check('1 iteration', result.iterations === 1);
  check('no tool calls', result.toolCallLog.length === 0);
  check('no test results', result.testResults === undefined);
  log.info('');
}

async function scenarioClarification(): Promise<void> {
  log.info('--- Scenario 5: Clarification needed (blocked) ---');
  log.info('');

  let result = await runFactoryLoop(
    makeBaseConfig({
      agent: new MockLoopAgent([
        {
          toolCalls: [{ tool: 'search_realm', args: { type: 'StickyNote' } }],
          status: 'blocked',
          message: 'Brief does not specify color scheme. Please clarify.',
        },
      ]),
    }),
  );

  printResult(result);
  check(
    'outcome is clarification_needed',
    result.outcome === 'clarification_needed',
  );
  check('message preserved', result.message?.includes('color scheme') ?? false);
  check('tool calls before block recorded', result.toolCallLog.length === 1);
  log.info('');
}

async function scenarioToolOnlyRound(): Promise<void> {
  log.info('--- Scenario 6: Tool-only round (read then write) ---');
  log.info('');

  let agent = new MockLoopAgent([
    {
      toolCalls: [
        { tool: 'search_realm', args: { type: 'StickyNote' } },
        { tool: 'read_file', args: { path: 'existing.gts' } },
      ],
      status: 'needs_iteration',
    },
    {
      toolCalls: [
        {
          tool: 'write_file',
          args: { path: 'card.gts', content: 'export ...' },
        },
        {
          tool: 'write_file',
          args: { path: 'Tests/card.spec.ts', content: 'test(...)' },
        },
      ],
      status: 'done',
    },
  ]);

  let result = await runFactoryLoop(
    makeBaseConfig({
      agent,
      testRunner: makeTestRunner([
        {
          status: 'passed',
          passedCount: 2,
          failedCount: 0,
          failures: [],
          durationMs: 3000,
        },
      ]),
    }),
  );

  printResult(result);
  check('outcome is tests_passed', result.outcome === 'tests_passed');
  check('took 2 iterations', result.iterations === 2);
  check(
    'all 4 tool calls across both rounds logged',
    result.toolCallLog.length === 4,
  );
  log.info('');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  let { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      'max-iterations': { type: 'string' },
    },
    strict: true,
    allowPositionals: true,
  });

  let maxIterations = values['max-iterations']
    ? Number(values['max-iterations'])
    : 5;

  if (!Number.isFinite(maxIterations) || maxIterations <= 0) {
    log.error(
      `Invalid --max-iterations: "${values['max-iterations']}". Must be a positive number.`,
    );
    process.exit(1);
  }

  log.info('');
  log.info('=== Factory Loop Smoke Test ===');
  log.info('');
  log.info(`maxIterations: ${maxIterations}`);
  log.info('');

  await scenarioHappyPath(maxIterations);
  await scenarioIterationPath(maxIterations);
  await scenarioMaxIterations(maxIterations);
  await scenarioDoneSignal();
  await scenarioClarification();
  await scenarioToolOnlyRound();

  log.info('===========================');
  log.info(`  ${passed} passed, ${failed} failed`);
  log.info('===========================');
  log.info('');

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  log.error(
    'Smoke test failed:',
    err instanceof Error ? err.message : String(err),
  );
  process.exit(1);
});
