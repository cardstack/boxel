import { module, test } from 'qunit';

import type { BoxelCLIClient } from '@cardstack/boxel-cli/api';

import type { SchedulableIssue } from '../src/factory-agent';

import {
  IssueScheduler,
  RealmIssueStore,
  type IssueStore,
} from '../src/issue-scheduler';

// ---------------------------------------------------------------------------
// MockIssueStore
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
    if (!issue) {
      throw new Error(`Issue "${issueId}" not found in mock store`);
    }
    return { ...issue };
  }

  async updateIssue(): Promise<void> {
    // no-op for scheduler tests
  }

  async addComment(): Promise<void> {
    // no-op for scheduler tests
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

// ---------------------------------------------------------------------------
// pickNextIssue
// ---------------------------------------------------------------------------

module('issue-scheduler > pickNextIssue', function () {
  test('returns in_progress over ready (resume semantics)', async function (assert) {
    let store = new MockIssueStore([
      makeIssue({ id: 'a', status: 'backlog', priority: 'high', order: 1 }),
      makeIssue({
        id: 'b',
        status: 'in_progress',
        priority: 'medium',
        order: 2,
      }),
    ]);

    let scheduler = new IssueScheduler(store);
    await scheduler.loadIssues();

    let picked = scheduler.pickNextIssue();
    assert.strictEqual(
      picked?.id,
      'b',
      'in_progress issue picked over higher-priority ready issue',
    );
  });

  test('returns high priority over medium', async function (assert) {
    let store = new MockIssueStore([
      makeIssue({ id: 'a', status: 'backlog', priority: 'medium', order: 1 }),
      makeIssue({ id: 'b', status: 'backlog', priority: 'high', order: 2 }),
    ]);

    let scheduler = new IssueScheduler(store);
    await scheduler.loadIssues();

    let picked = scheduler.pickNextIssue();
    assert.strictEqual(picked?.id, 'b', 'high priority picked first');
  });

  test('returns high over medium over low', async function (assert) {
    let store = new MockIssueStore([
      makeIssue({ id: 'low', status: 'backlog', priority: 'low', order: 1 }),
      makeIssue({ id: 'high', status: 'backlog', priority: 'high', order: 2 }),
      makeIssue({ id: 'med', status: 'backlog', priority: 'medium', order: 3 }),
    ]);

    let scheduler = new IssueScheduler(store);
    await scheduler.loadIssues();

    let picked = scheduler.pickNextIssue();
    assert.strictEqual(picked?.id, 'high', 'high priority first');
  });

  test('returns lower order for same priority', async function (assert) {
    let store = new MockIssueStore([
      makeIssue({ id: 'a', status: 'backlog', priority: 'medium', order: 5 }),
      makeIssue({ id: 'b', status: 'backlog', priority: 'medium', order: 2 }),
      makeIssue({ id: 'c', status: 'backlog', priority: 'medium', order: 8 }),
    ]);

    let scheduler = new IssueScheduler(store);
    await scheduler.loadIssues();

    let picked = scheduler.pickNextIssue();
    assert.strictEqual(picked?.id, 'b', 'lowest order picked first');
  });

  test('excludes issues blocked by non-done issues', async function (assert) {
    let store = new MockIssueStore([
      makeIssue({
        id: 'a',
        status: 'backlog',
        priority: 'high',
        order: 1,
        blockedBy: ['b'],
      }),
      makeIssue({
        id: 'b',
        status: 'in_progress',
        priority: 'medium',
        order: 2,
      }),
    ]);

    let scheduler = new IssueScheduler(store);
    await scheduler.loadIssues();

    let picked = scheduler.pickNextIssue();
    assert.strictEqual(
      picked?.id,
      'b',
      'blocked issue skipped, in_progress issue picked',
    );
  });

  test('includes issues whose blockers are done (unblocked)', async function (assert) {
    let store = new MockIssueStore([
      makeIssue({
        id: 'a',
        status: 'backlog',
        priority: 'high',
        order: 1,
        blockedBy: ['b'],
      }),
      makeIssue({ id: 'b', status: 'done', priority: 'medium', order: 2 }),
    ]);

    let scheduler = new IssueScheduler(store);
    await scheduler.loadIssues();

    let picked = scheduler.pickNextIssue();
    assert.strictEqual(
      picked?.id,
      'a',
      'issue with done blocker is now eligible',
    );
  });

  test('returns undefined when all issues are done', async function (assert) {
    let store = new MockIssueStore([
      makeIssue({ id: 'a', status: 'done' }),
      makeIssue({ id: 'b', status: 'done' }),
    ]);

    let scheduler = new IssueScheduler(store);
    await scheduler.loadIssues();

    let picked = scheduler.pickNextIssue();
    assert.strictEqual(picked, undefined, 'no issue to pick');
  });

  test('returns undefined when all eligible issues are blocked', async function (assert) {
    let store = new MockIssueStore([
      makeIssue({ id: 'a', status: 'backlog', blockedBy: ['b'] }),
      makeIssue({ id: 'b', status: 'blocked' }),
    ]);

    let scheduler = new IssueScheduler(store);
    await scheduler.loadIssues();

    let picked = scheduler.pickNextIssue();
    assert.strictEqual(picked, undefined, 'no unblocked issue to pick');
  });

  test('returns undefined when no issues exist (empty project)', async function (assert) {
    let store = new MockIssueStore([]);

    let scheduler = new IssueScheduler(store);
    await scheduler.loadIssues();

    let picked = scheduler.pickNextIssue();
    assert.strictEqual(picked, undefined, 'no issues to pick');
  });

  test('combined sort: in_progress > priority > order', async function (assert) {
    let store = new MockIssueStore([
      makeIssue({ id: 'low-1', status: 'backlog', priority: 'low', order: 1 }),
      makeIssue({
        id: 'high-5',
        status: 'backlog',
        priority: 'high',
        order: 5,
      }),
      makeIssue({
        id: 'med-3',
        status: 'backlog',
        priority: 'medium',
        order: 3,
      }),
      makeIssue({
        id: 'high-2',
        status: 'backlog',
        priority: 'high',
        order: 2,
      }),
      makeIssue({
        id: 'ip-med-10',
        status: 'in_progress',
        priority: 'medium',
        order: 10,
      }),
    ]);

    let scheduler = new IssueScheduler(store);
    await scheduler.loadIssues();

    // First pick: in_progress
    let first = scheduler.pickNextIssue();
    assert.strictEqual(
      first?.id,
      'ip-med-10',
      'in_progress picked first regardless of priority/order',
    );
  });
});

// ---------------------------------------------------------------------------
// hasUnblockedIssues
// ---------------------------------------------------------------------------

module('issue-scheduler > hasUnblockedIssues', function () {
  test('returns true when unblocked ready issues exist', async function (assert) {
    let store = new MockIssueStore([makeIssue({ id: 'a', status: 'backlog' })]);

    let scheduler = new IssueScheduler(store);
    await scheduler.loadIssues();

    assert.true(scheduler.hasUnblockedIssues());
  });

  test('returns true when in_progress issues exist', async function (assert) {
    let store = new MockIssueStore([
      makeIssue({ id: 'a', status: 'in_progress' }),
    ]);

    let scheduler = new IssueScheduler(store);
    await scheduler.loadIssues();

    assert.true(scheduler.hasUnblockedIssues());
  });

  test('returns false when all issues are done', async function (assert) {
    let store = new MockIssueStore([
      makeIssue({ id: 'a', status: 'done' }),
      makeIssue({ id: 'b', status: 'done' }),
    ]);

    let scheduler = new IssueScheduler(store);
    await scheduler.loadIssues();

    assert.false(scheduler.hasUnblockedIssues());
  });

  test('returns false when all ready issues are blocked', async function (assert) {
    let store = new MockIssueStore([
      makeIssue({ id: 'a', status: 'backlog', blockedBy: ['b'] }),
      makeIssue({ id: 'b', status: 'blocked' }),
    ]);

    let scheduler = new IssueScheduler(store);
    await scheduler.loadIssues();

    assert.false(scheduler.hasUnblockedIssues());
  });

  test('returns false when no issues exist', async function (assert) {
    let store = new MockIssueStore([]);

    let scheduler = new IssueScheduler(store);
    await scheduler.loadIssues();

    assert.false(scheduler.hasUnblockedIssues());
  });
});

// ---------------------------------------------------------------------------
// refreshIssueState
// ---------------------------------------------------------------------------

module('issue-scheduler > refreshIssueState', function () {
  test('delegates to store and updates internal list', async function (assert) {
    let store = new MockIssueStore([
      makeIssue({ id: 'a', status: 'in_progress' }),
      makeIssue({ id: 'b', status: 'backlog' }),
    ]);

    let scheduler = new IssueScheduler(store);
    await scheduler.loadIssues();

    // Simulate the agent marking issue 'a' as done in the realm
    store.issues[0].status = 'done';

    let original = scheduler.pickNextIssue();
    assert.strictEqual(
      original?.id,
      'a',
      'before refresh, a is still in_progress internally',
    );

    let refreshed = await scheduler.refreshIssueState(
      makeIssue({ id: 'a', status: 'in_progress' }),
    );

    assert.strictEqual(
      refreshed.status,
      'done',
      'refreshed issue has updated status',
    );

    // pickNextIssue should now skip 'a' (done) and pick 'b'
    let next = scheduler.pickNextIssue();
    assert.strictEqual(
      next?.id,
      'b',
      'after refresh, scheduler sees updated state',
    );
  });

  test('refreshed issue state affects dependency resolution', async function (assert) {
    let store = new MockIssueStore([
      makeIssue({ id: 'a', status: 'in_progress' }),
      makeIssue({ id: 'b', status: 'backlog', blockedBy: ['a'] }),
    ]);

    let scheduler = new IssueScheduler(store);
    await scheduler.loadIssues();

    // b is blocked by a
    let picked = scheduler.pickNextIssue();
    assert.strictEqual(picked?.id, 'a');

    // Simulate a completing
    store.issues[0].status = 'done';
    await scheduler.refreshIssueState(
      makeIssue({ id: 'a', status: 'in_progress' }),
    );

    // Now b should be unblocked
    let next = scheduler.pickNextIssue();
    assert.strictEqual(next?.id, 'b', 'b is now unblocked after a completed');
  });
});

// ---------------------------------------------------------------------------
// RealmIssueStore.listIssues — regression for blockedBy id resolution
// ---------------------------------------------------------------------------

module('issue-scheduler > RealmIssueStore blockedBy resolution', function () {
  // Regression for the production bug observed in factory:go where a
  // blocked issue ("kanban-board") was never picked even after its
  // blocker ("kanban-card") had been marked `done`. The realm's
  // search index returns each card's `id` as a full URL
  // (`http://.../Issues/kanban-card`), but `blockedBy.X.links.self`
  // is a relative path (`../Issues/kanban-card`). The mapping
  // function used to reduce the relative link to its last two path
  // segments (`Issues/kanban-card`), so the loop's `getUnblockedIssues`
  // statusMap (keyed by full URL `issue.id`) never had a hit and
  // every blocked issue stayed blocked forever. Fix resolves the
  // relative link against the parent card's URL so the resulting key
  // matches `issue.id`.
  test('resolves relative blockedBy links against the parent card url', async function (assert) {
    let realmUrl = 'http://localhost:4201/user/my-test-realm/';
    let darkfactoryModuleUrl =
      'http://localhost:4201/software-factory/darkfactory';
    let kanbanCardId = `${realmUrl}Issues/kanban-card`;
    let kanbanBoardId = `${realmUrl}Issues/kanban-board`;

    let mockClient = {
      async search() {
        return {
          ok: true,
          data: [
            {
              id: kanbanCardId,
              attributes: {
                status: 'done',
                priority: 'high',
                order: 1,
                summary: 'Implement Kanban Card card',
                issueType: 'feature',
              },
              relationships: {},
            },
            {
              id: kanbanBoardId,
              attributes: {
                status: 'backlog',
                priority: 'medium',
                order: 2,
                summary: 'Implement Kanban Board card',
                issueType: 'feature',
              },
              relationships: {
                'blockedBy.0': {
                  links: { self: '../Issues/kanban-card' },
                },
              },
            },
          ],
        };
      },
    } as unknown as BoxelCLIClient;

    let store = new RealmIssueStore({
      realmUrl,
      darkfactoryModuleUrl,
      client: mockClient,
      workspaceDir: '/tmp/scheduler-blockedby-resolution-fixture',
    });

    let scheduler = new IssueScheduler(store);
    await scheduler.loadIssues();

    // The mapping must produce a `blockedBy` entry whose key matches
    // the blocker's `id` exactly. If it doesn't, `getUnblockedIssues`
    // can't see that the blocker is `done` and `kanban-board` will
    // be filtered out as still-blocked.
    let picked = scheduler.pickNextIssue();
    assert.strictEqual(
      picked?.id,
      kanbanBoardId,
      'kanban-board should be picked once kanban-card is done — got: ' +
        (picked === undefined
          ? 'undefined (treated as still blocked)'
          : (picked?.id ?? 'unknown')),
    );
  });
});

// ---------------------------------------------------------------------------
// RealmIssueStore.listIssues — match Issue cards from either re-export module
// ---------------------------------------------------------------------------

module('issue-scheduler > RealmIssueStore issue-type filter', function () {
  // The `Issue` class is defined in `issue-tracker` and re-exported by
  // `darkfactory`. Factory-written issues adopt darkfactory#Issue; an issue a
  // human adds via the IssueTracker board adopts issue-tracker#Issue. A type
  // filter is module-URL-specific, so listIssues must match BOTH — otherwise
  // UI-added issues are invisible to the loop (observed in factory:go: a
  // backlog issue added in the host UI was never picked).
  test('listIssues matches both darkfactory#Issue and issue-tracker#Issue', async function (assert) {
    let realmUrl = 'http://localhost:4201/user/my-test-realm/';
    let darkfactoryModuleUrl =
      'http://localhost:4201/software-factory/darkfactory';
    let captured: { filter?: { any?: { type?: { module?: string } }[] } } = {};

    let mockClient = {
      async search(_realm: string, query: typeof captured) {
        captured = query;
        return { ok: true, data: [] };
      },
    } as unknown as BoxelCLIClient;

    let store = new RealmIssueStore({
      realmUrl,
      darkfactoryModuleUrl,
      client: mockClient,
      workspaceDir: '/tmp/scheduler-issue-type-filter-fixture',
    });

    await store.listIssues();

    let modules = (captured.filter?.any ?? []).map((c) => c.type?.module);
    assert.ok(
      modules.includes(darkfactoryModuleUrl),
      'matches factory-written darkfactory#Issue cards',
    );
    assert.ok(
      modules.includes('http://localhost:4201/software-factory/issue-tracker'),
      'matches UI-added issue-tracker#Issue cards',
    );
  });
});
