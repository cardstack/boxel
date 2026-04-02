import { module, test } from 'qunit';

import type {
  AgentContext,
  KnowledgeArticle,
  ProjectCard,
  TestResult,
  TicketCard,
} from '../scripts/lib/factory-agent';

import type {
  FactoryTool,
  ToolCallEntry,
} from '../scripts/lib/factory-tool-builder';

import {
  runFactoryLoop,
  type AgentRunResult,
  type AgentRunStatus,
  type ContextBuilderLike,
  type FactoryLoopConfig,
  type LoopAgent,
  type TestRunner,
} from '../scripts/lib/factory-loop';

// ---------------------------------------------------------------------------
// Mock agent
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

/**
 * MockFactoryAgent for loop simulation tests.
 * Accepts pre-scripted tool call sequences and records all inputs.
 */
class MockFactoryAgent implements LoopAgent {
  private configs: MockRunConfig[];
  private callIndex = 0;

  readonly receivedContexts: AgentContext[] = [];
  readonly receivedTools: FactoryTool[][] = [];

  constructor(configs: MockRunConfig[]) {
    this.configs = configs;
  }

  async run(
    context: AgentContext,
    tools: FactoryTool[],
  ): Promise<AgentRunResult> {
    this.receivedContexts.push(context);
    this.receivedTools.push(tools);

    if (this.callIndex >= this.configs.length) {
      throw new Error(
        `MockFactoryAgent exhausted: called ${this.callIndex + 1} times ` +
          `but only ${this.configs.length} response(s) were configured`,
      );
    }

    let config = this.configs[this.callIndex];
    this.callIndex++;

    let toolCalls: ToolCallEntry[] = [];
    for (let call of config.toolCalls) {
      let tool = tools.find((t) => t.name === call.tool);
      if (!tool) {
        throw new Error(
          `MockFactoryAgent: tool "${call.tool}" not found in provided tools`,
        );
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

    return {
      status: config.status,
      toolCalls,
      message: config.message,
    };
  }

  get callCount(): number {
    return this.callIndex;
  }
}

// ---------------------------------------------------------------------------
// Stub context builder
// ---------------------------------------------------------------------------

class StubContextBuilder implements ContextBuilderLike {
  buildCalls: {
    project: ProjectCard;
    ticket: TicketCard;
    knowledge: KnowledgeArticle[];
    targetRealmUrl: string;
    testRealmUrl: string;
    testResults?: TestResult;
  }[] = [];

  async build(params: {
    project: ProjectCard;
    ticket: TicketCard;
    knowledge: KnowledgeArticle[];
    targetRealmUrl: string;
    testRealmUrl: string;
    testResults?: TestResult;
  }): Promise<AgentContext> {
    this.buildCalls.push(params);
    return {
      project: params.project,
      ticket: params.ticket,
      knowledge: params.knowledge,
      skills: [],
      targetRealmUrl: params.targetRealmUrl,
      testRealmUrl: params.testRealmUrl,
      testResults: params.testResults,
    };
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeProject(overrides?: Partial<ProjectCard>): ProjectCard {
  return { id: 'project-1', name: 'Sticky Notes', ...overrides };
}

function makeTicket(overrides?: Partial<TicketCard>): TicketCard {
  return { id: 'ticket-1', title: 'Implement StickyNote card', ...overrides };
}

function makeKnowledge(
  overrides?: Partial<KnowledgeArticle>,
): KnowledgeArticle {
  return { id: 'ka-1', ...overrides };
}

function makeTool(name: string, result: unknown = { ok: true }): FactoryTool {
  return {
    name,
    description: `Mock ${name}`,
    parameters: {},
    execute: async () => result,
  };
}

function makePassingTestResult(): TestResult {
  return {
    status: 'passed',
    passedCount: 3,
    failedCount: 0,
    failures: [],
    durationMs: 5000,
  };
}

function makeFailingTestResult(): TestResult {
  return {
    status: 'failed',
    passedCount: 1,
    failedCount: 1,
    failures: [
      { testName: 'renders card', error: 'Expected element to exist' },
    ],
    durationMs: 5000,
  };
}

function makeTestRunner(results: TestResult[]): TestRunner {
  let callIndex = 0;
  return async () => {
    if (callIndex >= results.length) {
      throw new Error(
        `TestRunner exhausted: called ${callIndex + 1} times ` +
          `but only ${results.length} result(s) configured`,
      );
    }
    return results[callIndex++];
  };
}

const DEFAULT_TOOLS: FactoryTool[] = [
  makeTool('write_file'),
  makeTool('read_file'),
  makeTool('search_realm'),
  makeTool('signal_done'),
  makeTool('request_clarification'),
  makeTool('run_tests'),
];

function makeLoopConfig(
  overrides: Partial<FactoryLoopConfig> = {},
): FactoryLoopConfig {
  return {
    agent: new MockFactoryAgent([]),
    contextBuilder: new StubContextBuilder(),
    tools: DEFAULT_TOOLS,
    testRunner: makeTestRunner([makePassingTestResult()]),
    project: makeProject(),
    ticket: makeTicket(),
    knowledge: [makeKnowledge()],
    targetRealmUrl: 'https://example.test/target/',
    testRealmUrl: 'https://example.test/target-test-artifacts/',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Happy path
// ---------------------------------------------------------------------------

module('factory-loop > happy path', function () {
  test('agent writes files and tests pass on first iteration', async function (assert) {
    let agent = new MockFactoryAgent([
      {
        toolCalls: [
          {
            tool: 'write_file',
            args: {
              path: 'sticky-note.gts',
              content: 'export class StickyNote {}',
              realm: 'target',
            },
          },
          {
            tool: 'write_file',
            args: {
              path: 'StickyNote/welcome-note.json',
              content: '{ "data": {} }',
              realm: 'target',
            },
          },
          {
            tool: 'write_file',
            args: {
              path: 'Spec/sticky-note.json',
              content: '{ "data": {} }',
              realm: 'target',
            },
          },
          {
            tool: 'write_file',
            args: {
              path: 'Tests/sticky-note.spec.ts',
              content: 'test(...)',
              realm: 'target',
            },
          },
        ],
        status: 'done',
      },
    ]);

    let testRunCount = 0;
    let testRunner: TestRunner = async () => {
      testRunCount++;
      return makePassingTestResult();
    };

    let result = await runFactoryLoop(makeLoopConfig({ agent, testRunner }));

    assert.strictEqual(
      result.outcome,
      'tests_passed',
      'outcome is tests_passed',
    );
    assert.strictEqual(result.iterations, 1, 'completed in 1 iteration');
    assert.strictEqual(agent.callCount, 1, 'agent called once');
    assert.strictEqual(testRunCount, 1, 'tests ran once');
    assert.strictEqual(result.testResults?.status, 'passed', 'tests passed');
    assert.strictEqual(result.toolCallLog.length, 4, '4 tool calls recorded');
  });
});

// ---------------------------------------------------------------------------
// 2. Iteration path
// ---------------------------------------------------------------------------

module('factory-loop > iteration path', function () {
  test('tests fail then pass on retry', async function (assert) {
    let agent = new MockFactoryAgent([
      {
        toolCalls: [
          {
            tool: 'write_file',
            args: { path: 'sticky-note.gts', content: 'v1' },
          },
          {
            tool: 'write_file',
            args: { path: 'Tests/sticky-note.spec.ts', content: 'test v1' },
          },
        ],
        status: 'done',
      },
      {
        toolCalls: [
          {
            tool: 'write_file',
            args: { path: 'sticky-note.gts', content: 'v2 fixed' },
          },
        ],
        status: 'done',
      },
    ]);

    let testRunCount = 0;
    let testResults = [makeFailingTestResult(), makePassingTestResult()];
    let testRunner: TestRunner = async () => testResults[testRunCount++];

    let result = await runFactoryLoop(makeLoopConfig({ agent, testRunner }));

    assert.strictEqual(result.outcome, 'tests_passed');
    assert.strictEqual(result.iterations, 2, 'completed in 2 iterations');
    assert.strictEqual(agent.callCount, 2, 'agent called twice');
    assert.strictEqual(testRunCount, 2, 'tests ran twice');
  });
});

// ---------------------------------------------------------------------------
// 3. Max iterations
// ---------------------------------------------------------------------------

module('factory-loop > max iterations', function () {
  test('stops after maxIterations when tests keep failing', async function (assert) {
    let configs: MockRunConfig[] = [];
    let testResults: TestResult[] = [];
    for (let i = 0; i < 5; i++) {
      configs.push({
        toolCalls: [
          {
            tool: 'write_file',
            args: { path: 'sticky-note.gts', content: `attempt ${i}` },
          },
        ],
        status: 'done',
      });
      testResults.push(makeFailingTestResult());
    }

    let agent = new MockFactoryAgent(configs);
    let testRunCount = 0;
    let testRunner: TestRunner = async () => testResults[testRunCount++];

    let result = await runFactoryLoop(
      makeLoopConfig({ agent, testRunner, maxIterations: 5 }),
    );

    assert.strictEqual(result.outcome, 'max_iterations');
    assert.strictEqual(result.iterations, 5);
    assert.strictEqual(agent.callCount, 5, 'agent called 5 times');
    assert.strictEqual(testRunCount, 5, 'tests ran 5 times');
    assert.strictEqual(
      result.testResults?.status,
      'failed',
      'last test result was failed',
    );
  });

  test('respects custom maxIterations value', async function (assert) {
    let configs: MockRunConfig[] = [];
    let testResults: TestResult[] = [];
    for (let i = 0; i < 3; i++) {
      configs.push({
        toolCalls: [
          { tool: 'write_file', args: { path: 'a.gts', content: `v${i}` } },
        ],
        status: 'done',
      });
      testResults.push(makeFailingTestResult());
    }

    let agent = new MockFactoryAgent(configs);
    let testRunCount = 0;
    let testRunner: TestRunner = async () => testResults[testRunCount++];

    let result = await runFactoryLoop(
      makeLoopConfig({ agent, testRunner, maxIterations: 3 }),
    );

    assert.strictEqual(result.outcome, 'max_iterations');
    assert.strictEqual(result.iterations, 3);
  });
});

// ---------------------------------------------------------------------------
// 4. Done signal
// ---------------------------------------------------------------------------

module('factory-loop > done signal', function () {
  test('bare done signal with no tool calls returns done', async function (assert) {
    let agent = new MockFactoryAgent([{ toolCalls: [], status: 'done' }]);

    let testRunCount = 0;
    let testRunner: TestRunner = async () => {
      testRunCount++;
      return makePassingTestResult();
    };

    let result = await runFactoryLoop(makeLoopConfig({ agent, testRunner }));

    assert.strictEqual(result.outcome, 'done');
    assert.strictEqual(result.iterations, 1);
    assert.strictEqual(agent.callCount, 1);
    assert.strictEqual(testRunCount, 0, 'tests were not run');
    assert.strictEqual(result.toolCallLog.length, 0, 'no tool calls');
  });
});

// ---------------------------------------------------------------------------
// 5. Clarification
// ---------------------------------------------------------------------------

module('factory-loop > clarification', function () {
  test('blocked status returns clarification_needed with message', async function (assert) {
    let agent = new MockFactoryAgent([
      {
        toolCalls: [],
        status: 'blocked',
        message: 'The brief does not specify the color scheme. Please clarify.',
      },
    ]);

    let testRunCount = 0;
    let testRunner: TestRunner = async () => {
      testRunCount++;
      return makePassingTestResult();
    };

    let result = await runFactoryLoop(makeLoopConfig({ agent, testRunner }));

    assert.strictEqual(result.outcome, 'clarification_needed');
    assert.strictEqual(result.iterations, 1);
    assert.strictEqual(
      result.message,
      'The brief does not specify the color scheme. Please clarify.',
    );
    assert.strictEqual(testRunCount, 0, 'tests were not run');
  });

  test('blocked after tool calls still returns clarification_needed', async function (assert) {
    let agent = new MockFactoryAgent([
      {
        toolCalls: [{ tool: 'search_realm', args: { type: 'StickyNote' } }],
        status: 'blocked',
        message: 'Found conflicting card definitions.',
      },
    ]);

    let result = await runFactoryLoop(makeLoopConfig({ agent }));

    assert.strictEqual(result.outcome, 'clarification_needed');
    assert.strictEqual(result.toolCallLog.length, 1, 'tool call recorded');
    assert.strictEqual(result.message, 'Found conflicting card definitions.');
  });
});

// ---------------------------------------------------------------------------
// 6. Tool-only round
// ---------------------------------------------------------------------------

module('factory-loop > tool-only round', function () {
  test('needs_iteration followed by done with work triggers tests', async function (assert) {
    let agent = new MockFactoryAgent([
      // Iteration 1: read-only round
      {
        toolCalls: [
          { tool: 'search_realm', args: { type: 'StickyNote' } },
          { tool: 'read_file', args: { path: 'existing-card.gts' } },
        ],
        status: 'needs_iteration',
      },
      // Iteration 2: write files based on what was read
      {
        toolCalls: [
          {
            tool: 'write_file',
            args: { path: 'sticky-note.gts', content: 'export class...' },
          },
          {
            tool: 'write_file',
            args: { path: 'Tests/sticky-note.spec.ts', content: 'test(...)' },
          },
        ],
        status: 'done',
      },
    ]);

    let testRunCount = 0;
    let testRunner: TestRunner = async () => {
      testRunCount++;
      return makePassingTestResult();
    };

    let result = await runFactoryLoop(makeLoopConfig({ agent, testRunner }));

    assert.strictEqual(result.outcome, 'tests_passed');
    assert.strictEqual(result.iterations, 2, 'took 2 iterations');
    assert.strictEqual(agent.callCount, 2, 'agent called twice');
    assert.strictEqual(testRunCount, 1, 'tests ran once (only after done)');
    assert.strictEqual(
      result.toolCallLog.length,
      4,
      'all 4 tool calls recorded across iterations',
    );
  });

  test('multiple needs_iteration rounds before done', async function (assert) {
    let agent = new MockFactoryAgent([
      {
        toolCalls: [{ tool: 'search_realm', args: { type: 'StickyNote' } }],
        status: 'needs_iteration',
      },
      {
        toolCalls: [{ tool: 'read_file', args: { path: 'base-card.gts' } }],
        status: 'needs_iteration',
      },
      {
        toolCalls: [
          {
            tool: 'write_file',
            args: { path: 'sticky-note.gts', content: '' },
          },
        ],
        status: 'done',
      },
    ]);

    let result = await runFactoryLoop(
      makeLoopConfig({
        agent,
        testRunner: makeTestRunner([makePassingTestResult()]),
      }),
    );

    assert.strictEqual(result.outcome, 'tests_passed');
    assert.strictEqual(result.iterations, 3);
    assert.strictEqual(agent.callCount, 3);
    assert.strictEqual(result.toolCallLog.length, 3);
  });
});

// ---------------------------------------------------------------------------
// 7. Context threading
// ---------------------------------------------------------------------------

module('factory-loop > context threading', function () {
  test('first iteration has no testResults, second has failing results', async function (assert) {
    let agent = new MockFactoryAgent([
      {
        toolCalls: [
          { tool: 'write_file', args: { path: 'card.gts', content: 'v1' } },
        ],
        status: 'done',
      },
      {
        toolCalls: [
          { tool: 'write_file', args: { path: 'card.gts', content: 'v2' } },
        ],
        status: 'done',
      },
    ]);

    let failResult = makeFailingTestResult();
    let testRunner = makeTestRunner([failResult, makePassingTestResult()]);

    let result = await runFactoryLoop(makeLoopConfig({ agent, testRunner }));

    assert.strictEqual(result.outcome, 'tests_passed');

    // First iteration: no test results in context
    assert.strictEqual(
      agent.receivedContexts[0].testResults,
      undefined,
      'first iteration has no testResults',
    );

    // Second iteration: context includes failing test results
    assert.deepEqual(
      agent.receivedContexts[1].testResults,
      failResult,
      'second iteration has failing testResults from prior run',
    );
  });

  test('context includes correct project and ticket across iterations', async function (assert) {
    let project = makeProject({ id: 'p-42' });
    let ticket = makeTicket({ id: 't-99' });
    let agent = new MockFactoryAgent([
      {
        toolCalls: [
          { tool: 'write_file', args: { path: 'a.gts', content: '' } },
        ],
        status: 'done',
      },
      {
        toolCalls: [
          { tool: 'write_file', args: { path: 'a.gts', content: '' } },
        ],
        status: 'done',
      },
    ]);

    await runFactoryLoop(
      makeLoopConfig({
        agent,
        project,
        ticket,
        testRunner: makeTestRunner([
          makeFailingTestResult(),
          makePassingTestResult(),
        ]),
      }),
    );

    assert.strictEqual(agent.receivedContexts[0].project, project);
    assert.strictEqual(agent.receivedContexts[0].ticket, ticket);
    assert.strictEqual(agent.receivedContexts[1].project, project);
    assert.strictEqual(agent.receivedContexts[1].ticket, ticket);
  });

  test('tools are passed consistently across iterations', async function (assert) {
    let agent = new MockFactoryAgent([
      {
        toolCalls: [
          { tool: 'write_file', args: { path: 'a.gts', content: '' } },
        ],
        status: 'done',
      },
      {
        toolCalls: [
          { tool: 'write_file', args: { path: 'a.gts', content: '' } },
        ],
        status: 'done',
      },
    ]);

    let tools = [makeTool('write_file'), makeTool('read_file')];

    await runFactoryLoop(
      makeLoopConfig({
        agent,
        tools,
        testRunner: makeTestRunner([
          makeFailingTestResult(),
          makePassingTestResult(),
        ]),
      }),
    );

    assert.strictEqual(
      agent.receivedTools[0],
      tools,
      'first call gets same tools array',
    );
    assert.strictEqual(
      agent.receivedTools[1],
      tools,
      'second call gets same tools array',
    );
  });

  test('context builder receives realm URLs on every iteration', async function (assert) {
    let contextBuilder = new StubContextBuilder();
    let agent = new MockFactoryAgent([
      {
        toolCalls: [
          { tool: 'write_file', args: { path: 'a.gts', content: '' } },
        ],
        status: 'done',
      },
      {
        toolCalls: [
          { tool: 'write_file', args: { path: 'a.gts', content: '' } },
        ],
        status: 'done',
      },
    ]);

    await runFactoryLoop(
      makeLoopConfig({
        agent,
        contextBuilder,
        targetRealmUrl: 'https://example.test/my-realm/',
        testRealmUrl: 'https://example.test/my-realm-test-artifacts/',
        testRunner: makeTestRunner([
          makeFailingTestResult(),
          makePassingTestResult(),
        ]),
      }),
    );

    assert.strictEqual(contextBuilder.buildCalls.length, 2);
    assert.strictEqual(
      contextBuilder.buildCalls[0].targetRealmUrl,
      'https://example.test/my-realm/',
    );
    assert.strictEqual(
      contextBuilder.buildCalls[1].targetRealmUrl,
      'https://example.test/my-realm/',
    );
    assert.strictEqual(
      contextBuilder.buildCalls[0].testRealmUrl,
      'https://example.test/my-realm-test-artifacts/',
    );
    assert.strictEqual(
      contextBuilder.buildCalls[1].testRealmUrl,
      'https://example.test/my-realm-test-artifacts/',
    );
  });
});

// ---------------------------------------------------------------------------
// 8. Orchestrator-owned sequencing
// ---------------------------------------------------------------------------

module('factory-loop > orchestrator-owned sequencing', function () {
  test('all file writes complete before test execution begins', async function (assert) {
    let operations: string[] = [];

    let writeTool: FactoryTool = {
      name: 'write_file',
      description: 'Write a file',
      parameters: {},
      execute: async () => {
        operations.push('write');
        return { ok: true };
      },
    };

    let agent = new MockFactoryAgent([
      {
        toolCalls: [
          { tool: 'write_file', args: { path: 'a.gts', content: '' } },
          { tool: 'write_file', args: { path: 'b.gts', content: '' } },
          {
            tool: 'write_file',
            args: { path: 'Tests/a.spec.ts', content: '' },
          },
        ],
        status: 'done',
      },
    ]);

    let testRunner: TestRunner = async () => {
      operations.push('test_execution');
      return makePassingTestResult();
    };

    await runFactoryLoop(
      makeLoopConfig({ agent, tools: [writeTool], testRunner }),
    );

    assert.deepEqual(
      operations,
      ['write', 'write', 'write', 'test_execution'],
      'all writes complete before test execution starts',
    );
  });
});

// ---------------------------------------------------------------------------
// 9. Catalog Spec card + sample instances
// ---------------------------------------------------------------------------

module('factory-loop > Catalog Spec card + sample instances', function () {
  test('tool call log includes Spec card and sample instance writes', async function (assert) {
    let specContent = JSON.stringify({
      data: {
        attributes: {
          ref: { module: '../sticky-note', name: 'StickyNote' },
          specType: 'card',
          readMe: '# StickyNote\n\nA simple sticky note card.',
          cardTitle: 'Sticky Note',
          cardDescription: 'A sticky note card for quick notes',
        },
        relationships: {
          linkedExamples: {
            links: { self: '../StickyNote/welcome-note' },
          },
        },
      },
    });

    let instanceContent = JSON.stringify({
      data: {
        attributes: {
          title: 'Welcome!',
          body: 'Your first sticky note',
        },
      },
    });

    let agent = new MockFactoryAgent([
      {
        toolCalls: [
          {
            tool: 'write_file',
            args: {
              path: 'sticky-note.gts',
              content: 'export class StickyNote extends CardDef {}',
              realm: 'target',
            },
          },
          {
            tool: 'write_file',
            args: {
              path: 'StickyNote/welcome-note.json',
              content: instanceContent,
              realm: 'target',
            },
          },
          {
            tool: 'write_file',
            args: {
              path: 'Spec/sticky-note.json',
              content: specContent,
              realm: 'target',
            },
          },
          {
            tool: 'write_file',
            args: {
              path: 'Tests/sticky-note.spec.ts',
              content: 'test("renders", async () => { ... })',
              realm: 'target',
            },
          },
        ],
        status: 'done',
      },
    ]);

    let result = await runFactoryLoop(
      makeLoopConfig({
        agent,
        testRunner: makeTestRunner([makePassingTestResult()]),
      }),
    );

    assert.strictEqual(result.outcome, 'tests_passed');

    // Verify Catalog Spec card was written
    let specWrite = result.toolCallLog.find(
      (c) =>
        c.tool === 'write_file' && (c.args.path as string).startsWith('Spec/'),
    );
    assert.ok(specWrite, 'Catalog Spec card was written');
    assert.ok(
      (specWrite!.args.content as string).includes('linkedExamples'),
      'Catalog Spec card includes linkedExamples relationship',
    );
    assert.ok(
      (specWrite!.args.content as string).includes('StickyNote'),
      'Catalog Spec card references the card definition',
    );

    // Verify sample instance was written
    let instanceWrite = result.toolCallLog.find(
      (c) =>
        c.tool === 'write_file' &&
        (c.args.path as string).startsWith('StickyNote/'),
    );
    assert.ok(instanceWrite, 'sample card instance was written');
    assert.ok(
      (instanceWrite!.args.content as string).includes('Welcome!'),
      'sample instance has realistic data (title)',
    );
    assert.ok(
      (instanceWrite!.args.content as string).includes(
        'Your first sticky note',
      ),
      'sample instance has realistic data (body)',
    );

    // Verify card definition was written
    let defWrite = result.toolCallLog.find(
      (c) =>
        c.tool === 'write_file' && (c.args.path as string).endsWith('.gts'),
    );
    assert.ok(defWrite, 'card definition was written');

    // Verify Playwright test file was written
    let testWrite = result.toolCallLog.find(
      (c) =>
        c.tool === 'write_file' && (c.args.path as string).startsWith('Tests/'),
    );
    assert.ok(testWrite, 'Playwright test file was written');
  });
});
