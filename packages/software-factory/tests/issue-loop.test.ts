import QUnit from 'qunit';
const { module, test } = QUnit;

import type {
  AgentContext,
  SchedulableIssue,
  IssueData,
  ValidationResults,
} from '../src/factory-agent/index.ts';

import type {
  FactoryTool,
  ToolCallEntry,
} from '../src/factory-tool-builder.ts';
import type { AgentRunResult, LoopAgent } from '../src/factory-agent/index.ts';
import type { IssueStore } from '../src/issue-scheduler.ts';

import {
  runIssueLoop,
  NoOpValidator,
  type IssueContextBuilderLike,
  type IssueLoopConfig,
  type Validator,
} from '../src/issue-loop.ts';

// ---------------------------------------------------------------------------
// MockIssueStore
// ---------------------------------------------------------------------------

class MockIssueStore implements IssueStore {
  issues: SchedulableIssue[];
  updateCalls: { issueId: string; updates: Record<string, unknown> }[] = [];
  commentCalls: {
    issueId: string;
    comment: { body: string; author: string };
  }[] = [];
  projectStatusCalls: string[] = [];

  constructor(issues: SchedulableIssue[]) {
    this.issues = issues.map((i) => ({ ...i }));
  }

  async listIssues(): Promise<SchedulableIssue[]> {
    return this.issues.map((i) => ({ ...i }));
  }

  async refreshIssue(issueId: string): Promise<SchedulableIssue> {
    let issue = this.issues.find((i) => i.id === issueId);
    if (!issue) {
      throw new Error(`Issue "${issueId}" not found in mock store`);
    }
    return { ...issue };
  }

  async updateIssue(
    issueId: string,
    updates: { status?: string },
  ): Promise<void> {
    this.updateCalls.push({ issueId, updates });
    // Apply status change so refreshIssue reflects it
    let issue = this.issues.find((i) => i.id === issueId);
    if (issue && updates.status) {
      issue.status = updates.status as SchedulableIssue['status'];
    }
  }

  async addComment(
    issueId: string,
    comment: { body: string; author: string },
  ): Promise<void> {
    this.commentCalls.push({ issueId, comment });
  }

  async updateProjectStatus(projectStatus: string): Promise<void> {
    this.projectStatusCalls.push(projectStatus);
  }
}

// ---------------------------------------------------------------------------
// MockLoopAgent
// ---------------------------------------------------------------------------

interface MockAgentTurn {
  toolCalls: { tool: string; args: Record<string, unknown> }[];
  /** Side effect: update issue status in the mock store after this turn. */
  updateIssue?: { id: string; status: SchedulableIssue['status'] };
}

class MockLoopAgent implements LoopAgent {
  private turns: MockAgentTurn[];
  private turnIndex = 0;
  private store: MockIssueStore;
  readonly receivedContexts: AgentContext[] = [];

  constructor(turns: MockAgentTurn[], store: MockIssueStore) {
    this.turns = turns;
    this.store = store;
  }

  async run(
    context: AgentContext,
    tools: FactoryTool[],
  ): Promise<AgentRunResult> {
    this.receivedContexts.push(context);

    if (this.turnIndex >= this.turns.length) {
      throw new Error(`MockLoopAgent exhausted at turn ${this.turnIndex + 1}`);
    }

    let turn = this.turns[this.turnIndex++];

    let toolCalls: ToolCallEntry[] = [];
    for (let call of turn.toolCalls) {
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

    // Apply side effect: update issue status in mock store
    if (turn.updateIssue) {
      let issue = this.store.issues.find((i) => i.id === turn.updateIssue!.id);
      if (issue) {
        issue.status = turn.updateIssue.status;
      }
    }

    return { status: 'done', toolCalls };
  }

  get callCount(): number {
    return this.turnIndex;
  }
}

// ---------------------------------------------------------------------------
// StubIssueContextBuilder
// ---------------------------------------------------------------------------

class StubIssueContextBuilder implements IssueContextBuilderLike {
  buildCalls: {
    issue: IssueData;
    targetRealm: string;
    validationResults?: ValidationResults;
    briefUrl?: string;
  }[] = [];

  async buildForIssue(params: {
    issue: IssueData;
    targetRealm: string;
    validationResults?: ValidationResults;
    briefUrl?: string;
  }): Promise<AgentContext> {
    this.buildCalls.push(params);
    return {
      project: { id: 'project-1' },
      issue: params.issue,
      knowledge: [],
      skills: [],
      targetRealm: params.targetRealm,
      validationResults: params.validationResults,
      briefUrl: params.briefUrl,
    };
  }
}

// ---------------------------------------------------------------------------
// MockValidator
// ---------------------------------------------------------------------------

class MockValidator implements Validator {
  private results: ValidationResults[];
  private callIndex = 0;

  constructor(results: ValidationResults[]) {
    this.results = results;
  }

  async validate(): Promise<ValidationResults> {
    if (this.callIndex >= this.results.length) {
      throw new Error(`MockValidator exhausted at call ${this.callIndex + 1}`);
    }
    return this.results[this.callIndex++];
  }

  formatForContext(results: ValidationResults): string {
    if (results.passed) {
      return 'All validation steps passed.';
    }
    let lines = results.steps
      .filter((s) => !s.passed)
      .map((s) => `${s.step}: ${s.errors.map((e) => e.message).join(', ')}`);
    return lines.join('\n');
  }

  get callCount(): number {
    return this.callIndex;
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeIssue(
  overrides: Partial<SchedulableIssue> & { id: string },
): SchedulableIssue {
  return {
    status: 'backlog',
    priority: 'medium',
    blockedBy: [],
    order: 0,
    summary: `Issue ${overrides.id}`,
    ...overrides,
  };
}

function makeTool(name: string, result: unknown = { ok: true }): FactoryTool {
  return {
    name,
    description: `Mock ${name}`,
    parameters: {},
    execute: async () => result,
  };
}

function makePassingValidation(): ValidationResults {
  return {
    passed: true,
    steps: [
      { step: 'parse', passed: true, errors: [] },
      { step: 'lint', passed: true, errors: [] },
      { step: 'evaluate', passed: true, errors: [] },
      { step: 'instantiate', passed: true, errors: [] },
      { step: 'test', passed: true, errors: [] },
    ],
  };
}

function makeFailingValidation(): ValidationResults {
  return {
    passed: false,
    steps: [
      { step: 'parse', passed: true, errors: [] },
      { step: 'lint', passed: false, errors: [{ message: 'lint error' }] },
      { step: 'evaluate', passed: true, errors: [] },
      { step: 'instantiate', passed: true, errors: [] },
      { step: 'test', passed: false, errors: [{ message: 'test failure' }] },
    ],
  };
}

const DEFAULT_TOOLS: FactoryTool[] = [
  makeTool('write_file'),
  makeTool('read_file'),
  makeTool('signal_done'),
];

function makeLoopConfig(
  overrides: Partial<IssueLoopConfig> & {
    issueStore: MockIssueStore;
    agent: LoopAgent;
  },
): IssueLoopConfig {
  return {
    contextBuilder: new StubIssueContextBuilder(),
    tools: DEFAULT_TOOLS,
    createValidator: () => new MockValidator([makePassingValidation()]),
    targetRealm: 'https://example.test/target/',
    // Unit tests don't exercise disk — a dummy path is fine because the
    // loop itself never reads or writes the workspace; it only invokes the
    // injected sync callback.
    workspaceDir: '/tmp/boxel-factory-test-unit',
    syncWorkspace: async () => ({ ok: true }),
    maxIterationsPerIssue: 5,
    maxOuterCycles: 50,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Happy path
// ---------------------------------------------------------------------------

module('issue-loop > happy path', function () {
  test('single issue completes in one iteration', async function (assert) {
    let store = new MockIssueStore([
      makeIssue({ id: 'iss-1', status: 'backlog', priority: 'high', order: 1 }),
    ]);

    let agent = new MockLoopAgent(
      [
        {
          toolCalls: [
            { tool: 'write_file', args: { path: 'card.gts', content: 'v1' } },
          ],
          updateIssue: { id: 'iss-1', status: 'done' },
        },
      ],
      store,
    );

    let result = await runIssueLoop(
      makeLoopConfig({
        agent,
        issueStore: store,
        createValidator: () => new MockValidator([makePassingValidation()]),
      }),
    );

    assert.strictEqual(result.outcome, 'all_issues_done');
    assert.strictEqual(result.outerCycles, 1);
    assert.strictEqual(result.issueResults.length, 1);
    assert.strictEqual(result.issueResults[0].exitReason, 'done');
    assert.strictEqual(result.issueResults[0].innerIterations, 1);
    assert.strictEqual(result.issueResults[0].toolCallLog.length, 1);
  });
});

// ---------------------------------------------------------------------------
// 1b. Timing attribution
// ---------------------------------------------------------------------------

module('issue-loop > timing attribution', function () {
  test('tool-triggered syncs count as sync time, not agent time', async function (assert) {
    let syncCounter = 0;
    // A realm-touching `run_*` tool syncs the workspace before it runs. Model
    // that as a 500ms bump to the shared sync stopwatch during the agent turn.
    let toolThatSyncs: FactoryTool = {
      name: 'run_tests',
      description: 'Mock run_tests that syncs first',
      parameters: {},
      execute: async () => {
        syncCounter += 500;
        return { ok: true };
      },
    };

    let store = new MockIssueStore([
      makeIssue({ id: 'iss-1', status: 'backlog', priority: 'high', order: 1 }),
    ]);
    let agent = new MockLoopAgent(
      [
        {
          toolCalls: [{ tool: 'run_tests', args: {} }],
          updateIssue: { id: 'iss-1', status: 'done' },
        },
      ],
      store,
    );

    let result = await runIssueLoop(
      makeLoopConfig({
        agent,
        issueStore: store,
        tools: [toolThatSyncs],
        createValidator: () => new MockValidator([makePassingValidation()]),
        // Loop-owned syncs also advance the shared stopwatch.
        syncWorkspace: async () => {
          syncCounter += 10;
          return { ok: true };
        },
        getSyncElapsedMs: () => syncCounter,
      }),
    );

    let timing = result.issueResults[0].timing;
    assert.ok(timing, 'issue carries timing attribution');
    // The 500ms tool-triggered sync is attributed to sync...
    assert.ok(
      timing!.syncMs >= 500,
      `syncMs (${timing!.syncMs}) includes the tool-triggered sync`,
    );
    // ...and subtracted from the agent's wall clock, so the near-zero mock
    // turn leaves nothing once the 500ms tool sync is removed.
    assert.strictEqual(
      timing!.agentMs,
      0,
      'tool-sync time is not double-counted as agent time',
    );
  });
});

// ---------------------------------------------------------------------------
// 2. Multiple issues with dependency
// ---------------------------------------------------------------------------

module('issue-loop > multiple issues', function () {
  test('first done unblocks second', async function (assert) {
    let store = new MockIssueStore([
      makeIssue({ id: 'a', status: 'backlog', priority: 'high', order: 1 }),
      makeIssue({
        id: 'b',
        status: 'backlog',
        priority: 'medium',
        order: 2,
        blockedBy: ['a'],
      }),
    ]);

    let agent = new MockLoopAgent(
      [
        {
          toolCalls: [
            { tool: 'write_file', args: { path: 'a.gts', content: '' } },
          ],
          updateIssue: { id: 'a', status: 'done' },
        },
        {
          toolCalls: [
            { tool: 'write_file', args: { path: 'b.gts', content: '' } },
          ],
          updateIssue: { id: 'b', status: 'done' },
        },
      ],
      store,
    );

    let result = await runIssueLoop(
      makeLoopConfig({
        agent,
        issueStore: store,
        createValidator: () => new MockValidator([makePassingValidation()]),
      }),
    );

    assert.strictEqual(result.outcome, 'all_issues_done');
    assert.strictEqual(result.outerCycles, 2);
    assert.strictEqual(result.issueResults[0].issueId, 'a');
    assert.strictEqual(result.issueResults[0].exitReason, 'done');
    assert.strictEqual(result.issueResults[1].issueId, 'b');
    assert.strictEqual(result.issueResults[1].exitReason, 'done');
  });
});

// ---------------------------------------------------------------------------
// 3. Validation failure then fix
// ---------------------------------------------------------------------------

module('issue-loop > validation failure', function () {
  test('inner loop self-corrects after validation failure', async function (assert) {
    let store = new MockIssueStore([
      makeIssue({ id: 'iss-1', status: 'backlog', priority: 'high', order: 1 }),
    ]);

    let agent = new MockLoopAgent(
      [
        // Iteration 1: write code, validation will fail
        {
          toolCalls: [
            { tool: 'write_file', args: { path: 'card.gts', content: 'v1' } },
          ],
        },
        // Iteration 2: fix code, validation will pass
        {
          toolCalls: [
            {
              tool: 'write_file',
              args: { path: 'card.gts', content: 'v2 fixed' },
            },
          ],
          updateIssue: { id: 'iss-1', status: 'done' },
        },
      ],
      store,
    );

    let contextBuilder = new StubIssueContextBuilder();

    let result = await runIssueLoop(
      makeLoopConfig({
        agent,
        issueStore: store,
        contextBuilder,
        createValidator: () =>
          new MockValidator([makeFailingValidation(), makePassingValidation()]),
      }),
    );

    assert.strictEqual(result.outcome, 'all_issues_done');
    assert.strictEqual(result.issueResults[0].innerIterations, 2);
    assert.strictEqual(result.issueResults[0].exitReason, 'done');

    // Verify validation results were threaded into context
    assert.strictEqual(
      contextBuilder.buildCalls[0].validationResults,
      undefined,
      'first iteration has no prior validation',
    );
    assert.false(
      contextBuilder.buildCalls[1].validationResults?.passed,
      'second iteration gets failing validation from first',
    );
  });
});

// ---------------------------------------------------------------------------
// 4. Blocked issue
// ---------------------------------------------------------------------------

module('issue-loop > blocked issue', function () {
  test('blocked issue exits inner loop, outer loop continues', async function (assert) {
    let store = new MockIssueStore([
      makeIssue({ id: 'a', status: 'backlog', priority: 'high', order: 1 }),
      makeIssue({ id: 'b', status: 'backlog', priority: 'medium', order: 2 }),
    ]);

    let agent = new MockLoopAgent(
      [
        // Issue a: agent marks as blocked
        {
          toolCalls: [{ tool: 'read_file', args: { path: 'brief.md' } }],
          updateIssue: { id: 'a', status: 'blocked' },
        },
        // Issue b: agent completes
        {
          toolCalls: [
            { tool: 'write_file', args: { path: 'b.gts', content: '' } },
          ],
          updateIssue: { id: 'b', status: 'done' },
        },
      ],
      store,
    );

    let result = await runIssueLoop(
      makeLoopConfig({
        agent,
        issueStore: store,
        createValidator: () => new MockValidator([makePassingValidation()]),
      }),
    );

    assert.strictEqual(result.outcome, 'no_unblocked_issues');
    assert.strictEqual(result.outerCycles, 2);
    assert.strictEqual(result.issueResults[0].issueId, 'a');
    assert.strictEqual(result.issueResults[0].exitReason, 'blocked');
    assert.strictEqual(result.issueResults[1].issueId, 'b');
    assert.strictEqual(result.issueResults[1].exitReason, 'done');
  });
});

// ---------------------------------------------------------------------------
// 5. Max inner iterations
// ---------------------------------------------------------------------------

module('issue-loop > max inner iterations', function () {
  test('blocks issue when max iterations reached with failing validation', async function (assert) {
    let store = new MockIssueStore([
      makeIssue({ id: 'iss-1', status: 'backlog', priority: 'high', order: 1 }),
    ]);

    let turns: MockAgentTurn[] = [];
    let validations: ValidationResults[] = [];

    for (let i = 0; i < 3; i++) {
      turns.push({
        toolCalls: [
          {
            tool: 'write_file',
            args: { path: 'card.gts', content: `attempt ${i}` },
          },
        ],
        // Agent never marks done — issue stays in_progress
      });
      validations.push(makeFailingValidation());
    }

    let agent = new MockLoopAgent(turns, store);

    let result = await runIssueLoop(
      makeLoopConfig({
        agent,
        issueStore: store,
        createValidator: () => new MockValidator(validations),
        maxIterationsPerIssue: 3,
      }),
    );

    // When max iterations is hit with failing validation, issue is blocked
    assert.strictEqual(result.issueResults[0].exitReason, 'blocked');
    assert.strictEqual(result.issueResults[0].innerIterations, 3);
    assert.false(
      result.issueResults[0].lastValidation?.passed,
      'last validation was a failure',
    );
  });

  test('max iterations with passing validation keeps max_iterations exit reason', async function (assert) {
    let store = new MockIssueStore([
      makeIssue({ id: 'iss-1', status: 'backlog', priority: 'high', order: 1 }),
    ]);

    let turns: MockAgentTurn[] = [];
    let validations: ValidationResults[] = [];

    for (let i = 0; i < 3; i++) {
      turns.push({
        toolCalls: [
          {
            tool: 'write_file',
            args: { path: 'card.gts', content: `attempt ${i}` },
          },
        ],
      });
      validations.push(makePassingValidation());
    }

    let agent = new MockLoopAgent(turns, store);

    let result = await runIssueLoop(
      makeLoopConfig({
        agent,
        issueStore: store,
        createValidator: () => new MockValidator(validations),
        maxIterationsPerIssue: 3,
      }),
    );

    // When validation passes but issue not done, exit reason stays max_iterations
    assert.strictEqual(result.issueResults[0].exitReason, 'max_iterations');
    assert.strictEqual(result.issueResults[0].innerIterations, 3);
  });

  test('updateIssue called when blocking due to max iterations + failing validation', async function (assert) {
    let store = new MockIssueStore([
      makeIssue({ id: 'iss-1', status: 'backlog', priority: 'high', order: 1 }),
    ]);

    let turns: MockAgentTurn[] = [];
    let validations: ValidationResults[] = [];

    for (let i = 0; i < 2; i++) {
      turns.push({
        toolCalls: [
          { tool: 'write_file', args: { path: 'card.gts', content: `v${i}` } },
        ],
      });
      validations.push(makeFailingValidation());
    }

    let agent = new MockLoopAgent(turns, store);

    await runIssueLoop(
      makeLoopConfig({
        agent,
        issueStore: store,
        createValidator: () => new MockValidator(validations),
        maxIterationsPerIssue: 2,
      }),
    );

    // First call sets in_progress, second call blocks
    let blockCall = store.updateCalls.find(
      (c) => c.updates.status === 'blocked',
    );
    assert.ok(blockCall, 'updateIssue called with status: blocked');
    assert.strictEqual(blockCall!.issueId, 'iss-1');

    // Failure context is now added as a comment, not overwriting description
    let commentCall = store.commentCalls.find((c) => c.issueId === 'iss-1');
    assert.ok(commentCall, 'addComment was called');
    assert.ok(
      commentCall!.comment.body.includes('max iteration limit'),
      'comment body includes reason',
    );
    assert.strictEqual(
      commentCall!.comment.author,
      'orchestrator',
      'comment author is orchestrator',
    );
  });
});

// ---------------------------------------------------------------------------
// 6. No unblocked issues
// ---------------------------------------------------------------------------

module('issue-loop > no unblocked issues', function () {
  test('outer loop exits immediately when all issues are blocked', async function (assert) {
    let store = new MockIssueStore([
      makeIssue({ id: 'a', status: 'backlog', blockedBy: ['b'] }),
      makeIssue({ id: 'b', status: 'blocked' }),
    ]);

    let agent = new MockLoopAgent([], store);

    let result = await runIssueLoop(
      makeLoopConfig({ agent, issueStore: store }),
    );

    assert.strictEqual(result.outcome, 'no_unblocked_issues');
    assert.strictEqual(result.outerCycles, 0);
    assert.strictEqual(result.issueResults.length, 0);
    assert.strictEqual(agent.callCount, 0, 'agent was never called');
  });
});

// ---------------------------------------------------------------------------
// 7. Empty project (no issues)
// ---------------------------------------------------------------------------

module('issue-loop > empty project', function () {
  test('loop exits immediately with no issues', async function (assert) {
    let store = new MockIssueStore([]);
    let agent = new MockLoopAgent([], store);

    let result = await runIssueLoop(
      makeLoopConfig({ agent, issueStore: store }),
    );

    assert.strictEqual(result.outcome, 'all_issues_done');
    assert.strictEqual(result.outerCycles, 0);
    assert.strictEqual(result.issueResults.length, 0);
    assert.strictEqual(agent.callCount, 0, 'agent was never called');
  });
});

// ---------------------------------------------------------------------------
// 8. NoOpValidator (bootstrap)
// ---------------------------------------------------------------------------

module('issue-loop > NoOpValidator', function () {
  test('bootstrap issue with NoOpValidator completes', async function (assert) {
    let store = new MockIssueStore([
      makeIssue({
        id: 'seed',
        status: 'backlog',
        priority: 'high',
        order: 1,
        summary: 'Process brief and create project artifacts',
      }),
    ]);

    let agent = new MockLoopAgent(
      [
        {
          toolCalls: [
            {
              tool: 'write_file',
              args: { path: 'Project/sticky-notes.json', content: '{}' },
            },
          ],
          updateIssue: { id: 'seed', status: 'done' },
        },
      ],
      store,
    );

    let result = await runIssueLoop(
      makeLoopConfig({
        agent,
        issueStore: store,
        createValidator: () => new NoOpValidator(),
        briefUrl: 'https://example.test/brief/',
      }),
    );

    assert.strictEqual(result.outcome, 'all_issues_done');
    assert.strictEqual(result.issueResults[0].exitReason, 'done');
    assert.true(
      result.issueResults[0].lastValidation?.passed,
      'NoOpValidator returns passed',
    );
  });
});

// ---------------------------------------------------------------------------
// 8b. onBootstrapComplete hook
// ---------------------------------------------------------------------------

module('issue-loop > onBootstrapComplete hook', function () {
  function bootstrapSeedStore(): MockIssueStore {
    return new MockIssueStore([
      makeIssue({
        id: 'seed',
        status: 'backlog',
        priority: 'high',
        order: 1,
        issueType: 'bootstrap',
        summary: 'Process brief and create project artifacts',
      }),
    ]);
  }

  function boardWritingAgent(store: MockIssueStore): MockLoopAgent {
    return new MockLoopAgent(
      [
        {
          toolCalls: [
            {
              tool: 'write_file',
              args: { path: 'Boards/board.json', content: '{}' },
            },
          ],
          updateIssue: { id: 'seed', status: 'done' },
        },
      ],
      store,
    );
  }

  test('fires once after the bootstrap issue completes', async function (assert) {
    let store = bootstrapSeedStore();
    let agent = boardWritingAgent(store);

    let hookCalls = 0;
    let result = await runIssueLoop(
      makeLoopConfig({
        agent,
        issueStore: store,
        createValidator: () => new NoOpValidator(),
        onBootstrapComplete: async () => {
          hookCalls++;
        },
      }),
    );

    assert.strictEqual(result.issueResults[0].exitReason, 'done');
    assert.strictEqual(
      hookCalls,
      1,
      'hook fires exactly once, after the bootstrap issue',
    );
  });

  test('does not fire for a non-bootstrap issue', async function (assert) {
    let store = new MockIssueStore([
      makeIssue({
        id: 'iss-1',
        status: 'backlog',
        priority: 'high',
        order: 1,
        issueType: 'feature',
      }),
    ]);
    let agent = new MockLoopAgent(
      [
        {
          toolCalls: [
            { tool: 'write_file', args: { path: 'card.gts', content: 'v1' } },
          ],
          updateIssue: { id: 'iss-1', status: 'done' },
        },
      ],
      store,
    );

    let hookCalls = 0;
    await runIssueLoop(
      makeLoopConfig({
        agent,
        issueStore: store,
        onBootstrapComplete: async () => {
          hookCalls++;
        },
      }),
    );

    assert.strictEqual(hookCalls, 0, 'hook only fires for the bootstrap issue');
  });

  test('a throwing hook is swallowed and does not abort the loop', async function (assert) {
    let store = bootstrapSeedStore();
    let agent = boardWritingAgent(store);

    let result = await runIssueLoop(
      makeLoopConfig({
        agent,
        issueStore: store,
        createValidator: () => new NoOpValidator(),
        onBootstrapComplete: async () => {
          throw new Error('link failed');
        },
      }),
    );

    assert.strictEqual(
      result.outcome,
      'all_issues_done',
      'loop still completes even though the hook threw',
    );
    assert.strictEqual(result.issueResults[0].exitReason, 'done');
  });
});

// ---------------------------------------------------------------------------
// 9. Context threading
// ---------------------------------------------------------------------------

module('issue-loop > context threading', function () {
  test('validationResults from prior iteration passed to context', async function (assert) {
    let store = new MockIssueStore([
      makeIssue({ id: 'iss-1', status: 'backlog', priority: 'high', order: 1 }),
    ]);

    let failValidation = makeFailingValidation();

    let agent = new MockLoopAgent(
      [
        {
          toolCalls: [
            { tool: 'write_file', args: { path: 'a.gts', content: 'v1' } },
          ],
        },
        {
          toolCalls: [
            { tool: 'write_file', args: { path: 'a.gts', content: 'v2' } },
          ],
          updateIssue: { id: 'iss-1', status: 'done' },
        },
      ],
      store,
    );

    let contextBuilder = new StubIssueContextBuilder();

    await runIssueLoop(
      makeLoopConfig({
        agent,
        issueStore: store,
        contextBuilder,
        createValidator: () =>
          new MockValidator([failValidation, makePassingValidation()]),
      }),
    );

    assert.strictEqual(
      contextBuilder.buildCalls[0].validationResults,
      undefined,
      'first iteration has no validation results',
    );
    assert.deepEqual(
      contextBuilder.buildCalls[1].validationResults,
      failValidation,
      'second iteration receives failing validation from first',
    );
  });
});

// ---------------------------------------------------------------------------
// 10. Brief URL threading
// ---------------------------------------------------------------------------

module('issue-loop > brief URL threading', function () {
  test('briefUrl is passed through to buildForIssue', async function (assert) {
    let store = new MockIssueStore([
      makeIssue({ id: 'seed', status: 'backlog', priority: 'high', order: 1 }),
    ]);

    let agent = new MockLoopAgent(
      [
        {
          toolCalls: [
            { tool: 'write_file', args: { path: 'p.json', content: '{}' } },
          ],
          updateIssue: { id: 'seed', status: 'done' },
        },
      ],
      store,
    );

    let contextBuilder = new StubIssueContextBuilder();

    await runIssueLoop(
      makeLoopConfig({
        agent,
        issueStore: store,
        contextBuilder,
        createValidator: () => new MockValidator([makePassingValidation()]),
        briefUrl: 'https://example.test/brief/',
      }),
    );

    assert.strictEqual(
      contextBuilder.buildCalls[0].briefUrl,
      'https://example.test/brief/',
      'briefUrl is passed to buildForIssue',
    );
  });
});

// ---------------------------------------------------------------------------
// 11. New issues created mid-loop
// ---------------------------------------------------------------------------

module('issue-loop > new issues mid-loop', function () {
  test('agent creates new issues that are picked up by outer loop', async function (assert) {
    let store = new MockIssueStore([
      makeIssue({ id: 'seed', status: 'backlog', priority: 'high', order: 1 }),
    ]);

    let agent = new MockLoopAgent(
      [
        // Seed issue: agent creates it and marks done,
        // and adds a new issue to the store (simulating tool side-effect)
        {
          toolCalls: [
            {
              tool: 'write_file',
              args: { path: 'project.json', content: '{}' },
            },
          ],
          updateIssue: { id: 'seed', status: 'done' },
        },
        // New issue: agent works on it
        {
          toolCalls: [
            { tool: 'write_file', args: { path: 'card.gts', content: '' } },
          ],
          updateIssue: { id: 'new-1', status: 'done' },
        },
      ],
      store,
    );

    // After the seed issue completes and loadIssues() is called,
    // the store should include the new issue
    let originalListIssues = store.listIssues.bind(store);
    let listCalls = 0;
    store.listIssues = async () => {
      listCalls++;
      if (listCalls > 1) {
        // After first reload, simulate the agent having created a new issue
        if (!store.issues.find((i) => i.id === 'new-1')) {
          store.issues.push(
            makeIssue({
              id: 'new-1',
              status: 'backlog',
              priority: 'medium',
              order: 2,
            }),
          );
        }
      }
      return originalListIssues();
    };

    let result = await runIssueLoop(
      makeLoopConfig({
        agent,
        issueStore: store,
        createValidator: () => new MockValidator([makePassingValidation()]),
      }),
    );

    assert.strictEqual(result.outcome, 'all_issues_done');
    assert.strictEqual(result.outerCycles, 2);
    assert.strictEqual(result.issueResults[0].issueId, 'seed');
    assert.strictEqual(result.issueResults[1].issueId, 'new-1');
  });
});

// ---------------------------------------------------------------------------
// 12. createValidator receives issue ID
// ---------------------------------------------------------------------------

module('issue-loop > createValidator receives issue ID', function () {
  test('createValidator is called with the current issue ID', async function (assert) {
    let store = new MockIssueStore([
      makeIssue({
        id: 'Issues/sticky-note-define-core',
        status: 'backlog',
        priority: 'high',
        order: 1,
      }),
      makeIssue({
        id: 'Issues/sticky-note-catalog-spec',
        status: 'backlog',
        priority: 'medium',
        order: 2,
      }),
    ]);

    let agent = new MockLoopAgent(
      [
        {
          toolCalls: [
            { tool: 'write_file', args: { path: 'a.gts', content: '' } },
          ],
          updateIssue: {
            id: 'Issues/sticky-note-define-core',
            status: 'done',
          },
        },
        {
          toolCalls: [
            { tool: 'write_file', args: { path: 'b.gts', content: '' } },
          ],
          updateIssue: {
            id: 'Issues/sticky-note-catalog-spec',
            status: 'done',
          },
        },
      ],
      store,
    );

    let receivedIssueIds: string[] = [];

    let result = await runIssueLoop(
      makeLoopConfig({
        agent,
        issueStore: store,
        createValidator: (issueId: string) => {
          receivedIssueIds.push(issueId);
          return new MockValidator([makePassingValidation()]);
        },
      }),
    );

    assert.strictEqual(result.outcome, 'all_issues_done');
    assert.deepEqual(
      receivedIssueIds,
      ['Issues/sticky-note-define-core', 'Issues/sticky-note-catalog-spec'],
      'createValidator received the correct issue IDs in order',
    );
  });
});

// ---------------------------------------------------------------------------
// 13. Auto-mark done when agent calls signal_done + validation passes
// ---------------------------------------------------------------------------

module('issue-loop > auto-mark done on signal_done', function () {
  test('auto-marks issue done when agent calls signal_done and validation passes', async function (assert) {
    let store = new MockIssueStore([
      makeIssue({ id: 'iss-1', status: 'backlog', priority: 'high', order: 1 }),
    ]);

    // Agent calls signal_done but does NOT update issue status
    let agent = new MockLoopAgent(
      [
        {
          toolCalls: [
            { tool: 'write_file', args: { path: 'card.gts', content: 'v1' } },
            { tool: 'signal_done', args: {} },
          ],
        },
      ],
      store,
    );

    let result = await runIssueLoop(
      makeLoopConfig({
        agent,
        issueStore: store,
        createValidator: () => new MockValidator([makePassingValidation()]),
      }),
    );

    assert.strictEqual(result.outcome, 'all_issues_done');
    assert.strictEqual(result.issueResults[0].exitReason, 'done');
    assert.strictEqual(result.issueResults[0].innerIterations, 1);

    // Verify the loop auto-marked the issue as done
    let doneUpdate = store.updateCalls.find(
      (c) => c.issueId === 'iss-1' && c.updates.status === 'done',
    );
    assert.ok(doneUpdate, 'loop called updateIssue with status: done');
  });
});

// ---------------------------------------------------------------------------
// 14. signal_done + validation fails → continues iterating (no done status)
// ---------------------------------------------------------------------------

module('issue-loop > signal_done with failing validation', function () {
  test('does not mark done when agent signals done but validation fails', async function (assert) {
    let store = new MockIssueStore([
      makeIssue({ id: 'iss-1', status: 'backlog', priority: 'high', order: 1 }),
    ]);

    let agent = new MockLoopAgent(
      [
        // Iteration 1: agent signals done but validation fails
        {
          toolCalls: [
            { tool: 'write_file', args: { path: 'card.gts', content: 'v1' } },
            { tool: 'signal_done', args: {} },
          ],
        },
        // Iteration 2: agent fixes code and signals done, validation passes
        {
          toolCalls: [
            {
              tool: 'write_file',
              args: { path: 'card.gts', content: 'v2 fixed' },
            },
            { tool: 'signal_done', args: {} },
          ],
        },
      ],
      store,
    );

    let result = await runIssueLoop(
      makeLoopConfig({
        agent,
        issueStore: store,
        createValidator: () =>
          new MockValidator([makeFailingValidation(), makePassingValidation()]),
      }),
    );

    assert.strictEqual(result.outcome, 'all_issues_done');
    assert.strictEqual(result.issueResults[0].exitReason, 'done');
    assert.strictEqual(
      result.issueResults[0].innerIterations,
      2,
      'took 2 iterations because validation failed on first',
    );

    // Only one done call — from the second iteration when validation passed
    let doneCalls = store.updateCalls.filter(
      (c) => c.updates.status === 'done',
    );
    assert.strictEqual(
      doneCalls.length,
      1,
      'only marked done once (after validation passed)',
    );
  });
});

// ---------------------------------------------------------------------------
// 15. Issue set to in_progress on pickup
// ---------------------------------------------------------------------------

module('issue-loop > in_progress on pickup', function () {
  test('sets issue to in_progress when picked up from backlog', async function (assert) {
    let store = new MockIssueStore([
      makeIssue({ id: 'iss-1', status: 'backlog', priority: 'high', order: 1 }),
    ]);

    let agent = new MockLoopAgent(
      [
        {
          toolCalls: [
            { tool: 'write_file', args: { path: 'card.gts', content: 'v1' } },
          ],
          updateIssue: { id: 'iss-1', status: 'done' },
        },
      ],
      store,
    );

    await runIssueLoop(
      makeLoopConfig({
        agent,
        issueStore: store,
        createValidator: () => new MockValidator([makePassingValidation()]),
      }),
    );

    let firstUpdate = store.updateCalls[0];
    assert.strictEqual(
      firstUpdate.updates.status,
      'in_progress',
      'first updateIssue call sets in_progress',
    );
    assert.strictEqual(firstUpdate.issueId, 'iss-1');
  });
});

// ---------------------------------------------------------------------------
// 16. Project marked completed when all issues done
// ---------------------------------------------------------------------------

module('issue-loop > project completion', function () {
  test('project status set to completed when all issues done', async function (assert) {
    let store = new MockIssueStore([
      makeIssue({ id: 'iss-1', status: 'backlog', priority: 'high', order: 1 }),
    ]);

    let agent = new MockLoopAgent(
      [
        {
          toolCalls: [
            { tool: 'write_file', args: { path: 'card.gts', content: 'v1' } },
            { tool: 'signal_done', args: {} },
          ],
        },
      ],
      store,
    );

    let result = await runIssueLoop(
      makeLoopConfig({
        agent,
        issueStore: store,
        createValidator: () => new MockValidator([makePassingValidation()]),
      }),
    );

    assert.strictEqual(result.outcome, 'all_issues_done');
    assert.deepEqual(
      store.projectStatusCalls,
      ['completed'],
      'project status set to completed',
    );
  });

  test('project status NOT set when some issues blocked', async function (assert) {
    let store = new MockIssueStore([
      makeIssue({ id: 'iss-1', status: 'backlog', priority: 'high', order: 1 }),
    ]);

    let agent = new MockLoopAgent(
      [
        {
          toolCalls: [{ tool: 'read_file', args: { path: 'brief.md' } }],
          updateIssue: { id: 'iss-1', status: 'blocked' },
        },
      ],
      store,
    );

    let result = await runIssueLoop(
      makeLoopConfig({
        agent,
        issueStore: store,
        createValidator: () => new MockValidator([makePassingValidation()]),
      }),
    );

    assert.strictEqual(result.outcome, 'no_unblocked_issues');
    assert.deepEqual(
      store.projectStatusCalls,
      [],
      'project status NOT updated when issues blocked',
    );
  });
});
