/**
 * Smoke test for the Phase 2 issue-driven execution loop.
 *
 * No servers, no API keys — exercises runIssueLoop() with mock
 * collaborators to verify the two-level loop works end-to-end.
 *
 * Usage:
 *   pnpm smoke:issue-loop
 */

// This should be first
import '../../src/setup-logger';

import { logger } from '../../src/logger';

import type {
  AgentContext,
  SchedulableIssue,
  IssueData,
  ValidationResults,
} from '../../src/factory-agent';

import type {
  FactoryTool,
  ToolCallEntry,
} from '../../src/factory-tool-builder';

import type { AgentRunResult, LoopAgent } from '../../src/factory-agent';
import type { IssueStore } from '../../src/issue-scheduler';

import {
  runIssueLoop,
  NoOpValidator,
  ValidationPipeline,
  type IssueContextBuilderLike,
  type IssueLoopResult,
  type Validator,
} from '../../src/issue-loop';

import { NoOpStepRunner } from '../../src/validators/noop-step';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let log = logger('issue-loop-smoke');

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

class MockIssueStore implements IssueStore {
  issues: SchedulableIssue[];

  constructor(issues: SchedulableIssue[]) {
    this.issues = issues.map((i) => ({ ...i }));
  }

  async listIssues(): Promise<SchedulableIssue[]> {
    return this.issues.map((i) => ({ ...i }));
  }

  async refreshIssue(issueId: string): Promise<SchedulableIssue> {
    let issue = this.issues.find((i) => i.id === issueId);
    if (!issue) throw new Error(`Issue "${issueId}" not found`);
    return { ...issue };
  }

  async updateIssue(): Promise<void> {
    // no-op for smoke tests
  }

  async addComment(): Promise<void> {
    // no-op for smoke tests
  }
}

interface MockAgentTurn {
  toolCalls: { tool: string; args: Record<string, unknown> }[];
  updateIssue?: { id: string; status: SchedulableIssue['status'] };
}

class MockLoopAgent implements LoopAgent {
  private turns: MockAgentTurn[];
  private turnIndex = 0;
  private store: MockIssueStore;

  constructor(turns: MockAgentTurn[], store: MockIssueStore) {
    this.turns = turns;
    this.store = store;
  }

  async run(
    _context: AgentContext,
    tools: FactoryTool[],
  ): Promise<AgentRunResult> {
    if (this.turnIndex >= this.turns.length) {
      throw new Error(`MockLoopAgent exhausted at turn ${this.turnIndex + 1}`);
    }

    let turn = this.turns[this.turnIndex++];
    let toolCalls: ToolCallEntry[] = [];

    for (let call of turn.toolCalls) {
      let tool = tools.find((t) => t.name === call.tool);
      if (!tool) throw new Error(`Tool "${call.tool}" not found`);
      let start = Date.now();
      let result = await tool.execute(call.args);
      toolCalls.push({
        tool: call.tool,
        args: call.args,
        result,
        durationMs: Date.now() - start,
      });
    }

    if (turn.updateIssue) {
      let issue = this.store.issues.find((i) => i.id === turn.updateIssue!.id);
      if (issue) issue.status = turn.updateIssue.status;
    }

    return { status: 'done', toolCalls };
  }
}

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
    return results.steps
      .filter((s) => !s.passed)
      .map((s) => `${s.step}: ${s.errors.map((e) => e.message).join(', ')}`)
      .join('\n');
  }
}

class StubContextBuilder implements IssueContextBuilderLike {
  async buildForIssue(params: {
    issue: IssueData;
    targetRealm: string;
    validationResults?: ValidationResults;
    briefUrl?: string;
  }): Promise<AgentContext> {
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

const TOOLS: FactoryTool[] = [
  makeTool('write_file'),
  makeTool('read_file'),
  makeTool('signal_done'),
];

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

function printResult(result: IssueLoopResult): void {
  log.info(`  outcome:      ${result.outcome}`);
  log.info(`  outer cycles: ${result.outerCycles}`);
  log.info(`  issues:       ${result.issueResults.length}`);
  for (let ir of result.issueResults) {
    log.info(
      `    ${ir.issueId}: ${ir.exitReason} (${ir.innerIterations} iteration(s), ${ir.toolCallLog.length} tool call(s))`,
    );
  }
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

async function scenarioSingleIssue(): Promise<void> {
  log.info('--- Scenario 1: Single issue happy path ---');
  log.info('');

  let store = new MockIssueStore([
    makeIssue({
      id: 'ISS-001',
      status: 'backlog',
      priority: 'high',
      order: 1,
      summary: 'Define StickyNote card',
    }),
  ]);

  let agent = new MockLoopAgent(
    [
      {
        toolCalls: [
          { tool: 'write_file', args: { path: 'card.gts', content: 'v1' } },
        ],
        updateIssue: { id: 'ISS-001', status: 'done' },
      },
    ],
    store,
  );

  let result = await runIssueLoop({
    agent,
    contextBuilder: new StubContextBuilder(),
    tools: TOOLS,
    issueStore: store,
    createValidator: () => new MockValidator([makePassingValidation()]),
    targetRealm: 'https://example.test/target/',
    workspaceDir: '/tmp/boxel-factory-smoke',
    syncWorkspace: async () => ({ ok: true }),
  });

  printResult(result);
  check('outcome is all_issues_done', result.outcome === 'all_issues_done');
  check('1 issue completed', result.issueResults.length === 1);
  check('1 outer cycle', result.outerCycles === 1);
  check('exit reason is done', result.issueResults[0]?.exitReason === 'done');
  log.info('');
}

async function scenarioDependencyCascade(): Promise<void> {
  log.info('--- Scenario 2: Two-issue dependency cascade ---');
  log.info('');

  let store = new MockIssueStore([
    makeIssue({
      id: 'A',
      status: 'backlog',
      priority: 'high',
      order: 1,
      summary: 'Define card',
    }),
    makeIssue({
      id: 'B',
      status: 'backlog',
      priority: 'medium',
      order: 2,
      blockedBy: ['A'],
      summary: 'Write tests',
    }),
  ]);

  let agent = new MockLoopAgent(
    [
      {
        toolCalls: [
          { tool: 'write_file', args: { path: 'a.gts', content: '' } },
        ],
        updateIssue: { id: 'A', status: 'done' },
      },
      {
        toolCalls: [
          { tool: 'write_file', args: { path: 'b.gts', content: '' } },
        ],
        updateIssue: { id: 'B', status: 'done' },
      },
    ],
    store,
  );

  let result = await runIssueLoop({
    agent,
    contextBuilder: new StubContextBuilder(),
    tools: TOOLS,
    issueStore: store,
    createValidator: () => new MockValidator([makePassingValidation()]),
    targetRealm: 'https://example.test/target/',
    workspaceDir: '/tmp/boxel-factory-smoke',
    syncWorkspace: async () => ({ ok: true }),
  });

  printResult(result);
  check('outcome is all_issues_done', result.outcome === 'all_issues_done');
  check(
    'issue A completed before issue B',
    result.issueResults[0]?.issueId === 'A',
  );
  check('2 outer cycles', result.outerCycles === 2);
  log.info('');
}

async function scenarioPriorityOrdering(): Promise<void> {
  log.info('--- Scenario 3: Priority ordering ---');
  log.info('');

  let store = new MockIssueStore([
    makeIssue({
      id: 'LOW',
      status: 'backlog',
      priority: 'low',
      order: 1,
      summary: 'Low priority',
    }),
    makeIssue({
      id: 'HIGH',
      status: 'backlog',
      priority: 'high',
      order: 2,
      summary: 'High priority',
    }),
    makeIssue({
      id: 'MED',
      status: 'backlog',
      priority: 'medium',
      order: 3,
      summary: 'Medium priority',
    }),
  ]);

  let agent = new MockLoopAgent(
    [
      {
        toolCalls: [
          { tool: 'write_file', args: { path: 'h.gts', content: '' } },
        ],
        updateIssue: { id: 'HIGH', status: 'done' },
      },
      {
        toolCalls: [
          { tool: 'write_file', args: { path: 'm.gts', content: '' } },
        ],
        updateIssue: { id: 'MED', status: 'done' },
      },
      {
        toolCalls: [
          { tool: 'write_file', args: { path: 'l.gts', content: '' } },
        ],
        updateIssue: { id: 'LOW', status: 'done' },
      },
    ],
    store,
  );

  let result = await runIssueLoop({
    agent,
    contextBuilder: new StubContextBuilder(),
    tools: TOOLS,
    issueStore: store,
    createValidator: () => new MockValidator([makePassingValidation()]),
    targetRealm: 'https://example.test/target/',
    workspaceDir: '/tmp/boxel-factory-smoke',
    syncWorkspace: async () => ({ ok: true }),
  });

  printResult(result);
  check(
    'high priority issue picked first',
    result.issueResults[0]?.issueId === 'HIGH',
  );
  check(
    'medium priority issue picked second',
    result.issueResults[1]?.issueId === 'MED',
  );
  check(
    'low priority issue picked third',
    result.issueResults[2]?.issueId === 'LOW',
  );
  log.info('');
}

async function scenarioMaxIterations(): Promise<void> {
  log.info('--- Scenario 4: Max inner iterations ---');
  log.info('');

  let store = new MockIssueStore([
    makeIssue({
      id: 'ISS-1',
      status: 'backlog',
      priority: 'high',
      order: 1,
      summary: 'Fix card rendering',
    }),
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
    validations.push(makeFailingValidation());
  }

  let agent = new MockLoopAgent(turns, store);

  let result = await runIssueLoop({
    agent,
    contextBuilder: new StubContextBuilder(),
    tools: TOOLS,
    issueStore: store,
    createValidator: () => new MockValidator(validations),
    targetRealm: 'https://example.test/target/',
    workspaceDir: '/tmp/boxel-factory-smoke',
    syncWorkspace: async () => ({ ok: true }),
    maxIterationsPerIssue: 3,
  });

  printResult(result);
  check(
    'issue blocked after max iterations with failing validation',
    result.issueResults[0]?.exitReason === 'blocked',
  );
  check(
    'last validation was failed',
    result.issueResults[0]?.lastValidation?.passed === false,
  );
  log.info('');
}

async function scenarioBlockedIssue(): Promise<void> {
  log.info('--- Scenario 5: Blocked issue ---');
  log.info('');

  let store = new MockIssueStore([
    makeIssue({
      id: 'A',
      status: 'backlog',
      priority: 'high',
      order: 1,
      summary: 'Needs clarification',
    }),
  ]);

  let agent = new MockLoopAgent(
    [
      {
        toolCalls: [{ tool: 'read_file', args: { path: 'brief.md' } }],
        updateIssue: { id: 'A', status: 'blocked' },
      },
    ],
    store,
  );

  let result = await runIssueLoop({
    agent,
    contextBuilder: new StubContextBuilder(),
    tools: TOOLS,
    issueStore: store,
    createValidator: () => new MockValidator([makePassingValidation()]),
    targetRealm: 'https://example.test/target/',
    workspaceDir: '/tmp/boxel-factory-smoke',
    syncWorkspace: async () => ({ ok: true }),
  });

  printResult(result);
  check(
    'blocked issue recorded',
    result.issueResults[0]?.exitReason === 'blocked',
  );
  check(
    'outcome is no_unblocked_issues',
    result.outcome === 'no_unblocked_issues',
  );
  log.info('');
}

async function scenarioEmptyProject(): Promise<void> {
  log.info('--- Scenario 6: Empty project (no issues) ---');
  log.info('');

  let store = new MockIssueStore([]);
  let agent = new MockLoopAgent([], store);

  let result = await runIssueLoop({
    agent,
    contextBuilder: new StubContextBuilder(),
    tools: TOOLS,
    issueStore: store,
    createValidator: () => new NoOpValidator(),
    targetRealm: 'https://example.test/target/',
    workspaceDir: '/tmp/boxel-factory-smoke',
    syncWorkspace: async () => ({ ok: true }),
  });

  printResult(result);
  check('outcome is all_issues_done', result.outcome === 'all_issues_done');
  check('0 outer cycles', result.outerCycles === 0);
  check('no issue results', result.issueResults.length === 0);
  log.info('');
}

async function scenarioValidationPipeline(): Promise<void> {
  log.info('--- Scenario 7: ValidationPipeline integration ---');
  log.info('');

  let store = new MockIssueStore([
    makeIssue({
      id: 'ISS-P1',
      status: 'backlog',
      priority: 'high',
      order: 1,
      summary: 'Test pipeline integration',
    }),
  ]);

  let agent = new MockLoopAgent(
    [
      {
        toolCalls: [
          { tool: 'write_file', args: { path: 'card.gts', content: 'v1' } },
        ],
        updateIssue: { id: 'ISS-P1', status: 'done' },
      },
    ],
    store,
  );

  // Use a real ValidationPipeline with all NoOp steps (no server needed).
  // The factory creates a fresh pipeline per issue, as in production.
  let createPipeline = () =>
    new ValidationPipeline([
      new NoOpStepRunner('parse'),
      new NoOpStepRunner('lint'),
      new NoOpStepRunner('evaluate'),
      new NoOpStepRunner('instantiate'),
      new NoOpStepRunner('test'),
    ]);

  let result = await runIssueLoop({
    agent,
    contextBuilder: new StubContextBuilder(),
    tools: TOOLS,
    issueStore: store,
    createValidator: createPipeline,
    targetRealm: 'https://example.test/target/',
    workspaceDir: '/tmp/boxel-factory-smoke',
    syncWorkspace: async () => ({ ok: true }),
  });

  printResult(result);
  check('outcome is all_issues_done', result.outcome === 'all_issues_done');
  check('exit reason is done', result.issueResults[0]?.exitReason === 'done');
  check(
    'validation passed (all NoOp steps)',
    result.issueResults[0]?.lastValidation?.passed === true,
  );
  check(
    '5 validation steps reported',
    result.issueResults[0]?.lastValidation?.steps.length === 5,
  );

  // Verify formatForContext works
  let lastValidation = result.issueResults[0]?.lastValidation;
  let pipelineForFormat = createPipeline();
  let formatted = lastValidation
    ? pipelineForFormat.formatForContext(lastValidation)
    : '';
  check(
    'formatForContext reports all passed',
    formatted === 'All validation steps passed.',
  );
  log.info('');
}

async function scenarioBootstrapSeedIssue(): Promise<void> {
  log.info('--- Scenario 8: Bootstrap seed issue flow ---');
  log.info('');

  let store = new MockIssueStore([
    makeIssue({
      id: 'Issues/bootstrap-seed',
      status: 'backlog',
      priority: 'critical',
      order: 0,
      summary: 'Process brief and create project artifacts',
    }),
  ]);

  // Agent processes seed: creates Project + 2 Issues, marks seed done.
  // Then picks up implementation issue #1 and completes it.
  let agent = new MockLoopAgent(
    [
      {
        toolCalls: [
          {
            tool: 'write_file',
            args: {
              path: 'Projects/sticky-note-mvp.json',
              content: '{}',
            },
          },
          {
            tool: 'write_file',
            args: {
              path: 'Issues/sticky-note-define-card.json',
              content: '{}',
            },
          },
          {
            tool: 'write_file',
            args: {
              path: 'Issues/sticky-note-catalog-spec.json',
              content: '{}',
            },
          },
        ],
        updateIssue: { id: 'Issues/bootstrap-seed', status: 'done' },
      },
      {
        toolCalls: [
          {
            tool: 'write_file',
            args: { path: 'sticky-note.gts', content: '' },
          },
        ],
        updateIssue: {
          id: 'Issues/sticky-note-define-card',
          status: 'done',
        },
      },
      {
        toolCalls: [
          {
            tool: 'write_file',
            args: { path: 'Spec/sticky-note.json', content: '{}' },
          },
        ],
        updateIssue: {
          id: 'Issues/sticky-note-catalog-spec',
          status: 'done',
        },
      },
    ],
    store,
  );

  // Simulate agent creating new issues during the seed turn
  let originalList = store.listIssues.bind(store);
  let listCalls = 0;
  store.listIssues = async () => {
    listCalls++;
    if (
      listCalls > 1 &&
      !store.issues.find((i) => i.id === 'Issues/sticky-note-define-card')
    ) {
      store.issues.push(
        makeIssue({
          id: 'Issues/sticky-note-define-card',
          status: 'backlog',
          priority: 'high',
          order: 1,
          summary: 'Create Sticky Note card definition and tests',
        }),
      );
      store.issues.push(
        makeIssue({
          id: 'Issues/sticky-note-catalog-spec',
          status: 'backlog',
          priority: 'medium',
          order: 2,
          blockedBy: ['Issues/sticky-note-define-card'],
          summary: 'Create Sticky Note catalog spec with examples',
        }),
      );
    }
    return originalList();
  };

  let result = await runIssueLoop({
    agent,
    contextBuilder: new StubContextBuilder(),
    tools: TOOLS,
    issueStore: store,
    createValidator: () => new NoOpValidator(),
    targetRealm: 'https://example.test/target/',
    workspaceDir: '/tmp/boxel-factory-smoke',
    syncWorkspace: async () => ({ ok: true }),
    briefUrl: 'https://example.test/brief/',
  });

  printResult(result);
  check(
    'bootstrap outcome is all_issues_done',
    result.outcome === 'all_issues_done',
  );
  check('3 outer cycles (seed + 2 implementation)', result.outerCycles === 3);
  check(
    'seed issue completed first',
    result.issueResults[0]?.issueId === 'Issues/bootstrap-seed',
  );
  check(
    'seed issue exit reason is done',
    result.issueResults[0]?.exitReason === 'done',
  );
  check(
    'implementation issue #1 completed second',
    result.issueResults[1]?.issueId === 'Issues/sticky-note-define-card',
  );
  check(
    'implementation issue #2 completed third',
    result.issueResults[2]?.issueId === 'Issues/sticky-note-catalog-spec',
  );
  log.info('');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  log.info('');
  log.info('=== Issue Loop Smoke Test ===');
  log.info('');

  await scenarioSingleIssue();
  await scenarioDependencyCascade();
  await scenarioPriorityOrdering();
  await scenarioMaxIterations();
  await scenarioBlockedIssue();
  await scenarioEmptyProject();
  await scenarioValidationPipeline();
  await scenarioBootstrapSeedIssue();

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
