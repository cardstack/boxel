import QUnit from 'qunit';
const { module, test } = QUnit;

import type { SchedulableIssue } from '../src/factory-agent/index.ts';
import type { IssueStore } from '../src/issue-scheduler.ts';
import { retryBlockedIssues } from '../src/factory-issue-loop-wiring.ts';

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

  constructor(issues: SchedulableIssue[]) {
    this.issues = issues.map((i) => ({ ...i }));
  }

  async listIssues(): Promise<SchedulableIssue[]> {
    return this.issues.map((i) => ({ ...i }));
  }

  async refreshIssue(issueId: string): Promise<SchedulableIssue> {
    let issue = this.issues.find((i) => i.id === issueId);
    if (!issue) {
      throw new Error(`Issue "${issueId}" not found`);
    }
    return { ...issue };
  }

  async updateIssue(
    issueId: string,
    updates: { status?: string; priority?: string },
  ): Promise<void> {
    this.updateCalls.push({ issueId, updates });
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
}

// ---------------------------------------------------------------------------
// Helpers
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
// Tests
// ---------------------------------------------------------------------------

module('retryBlockedIssues', function () {
  test('resets a blocked issue with no blockedBy dependencies', async function (assert) {
    let store = new MockIssueStore([
      makeIssue({ id: 'ISS-1', status: 'blocked', blockedBy: [] }),
    ]);

    await retryBlockedIssues(store);

    assert.strictEqual(store.updateCalls.length, 1);
    assert.strictEqual(store.updateCalls[0].issueId, 'ISS-1');
    assert.strictEqual(store.updateCalls[0].updates.status, 'backlog');
    assert.strictEqual(store.updateCalls[0].updates.priority, 'critical');
    assert.strictEqual(store.commentCalls.length, 1);
    assert.strictEqual(store.commentCalls[0].issueId, 'ISS-1');
    assert.true(store.commentCalls[0].comment.body.includes('Retry'));
  });

  test('skips blocked issue with unresolved blocker', async function (assert) {
    let store = new MockIssueStore([
      makeIssue({ id: 'A', status: 'in_progress' }),
      makeIssue({ id: 'B', status: 'blocked', blockedBy: ['A'] }),
    ]);

    await retryBlockedIssues(store);

    assert.strictEqual(store.updateCalls.length, 0, 'no updates made');
    assert.strictEqual(store.commentCalls.length, 0, 'no comments added');
  });

  test('resets blocked issue whose blockers are all done', async function (assert) {
    let store = new MockIssueStore([
      makeIssue({ id: 'A', status: 'done' }),
      makeIssue({ id: 'B', status: 'blocked', blockedBy: ['A'] }),
    ]);

    await retryBlockedIssues(store);

    assert.strictEqual(store.updateCalls.length, 1);
    assert.strictEqual(store.updateCalls[0].issueId, 'B');
    assert.strictEqual(store.updateCalls[0].updates.status, 'backlog');
    assert.strictEqual(store.updateCalls[0].updates.priority, 'critical');
  });

  test('skips non-blocked issues', async function (assert) {
    let store = new MockIssueStore([
      makeIssue({ id: 'A', status: 'backlog' }),
      makeIssue({ id: 'B', status: 'done' }),
      makeIssue({ id: 'C', status: 'in_progress' }),
    ]);

    await retryBlockedIssues(store);

    assert.strictEqual(store.updateCalls.length, 0);
    assert.strictEqual(store.commentCalls.length, 0);
  });

  test('handles mix: resets eligible, skips dependency-blocked', async function (assert) {
    let store = new MockIssueStore([
      makeIssue({ id: 'A', status: 'in_progress' }),
      makeIssue({
        id: 'B',
        status: 'blocked',
        blockedBy: ['A'],
      }),
      makeIssue({
        id: 'C',
        status: 'blocked',
        blockedBy: [],
      }),
    ]);

    await retryBlockedIssues(store);

    assert.strictEqual(store.updateCalls.length, 1);
    assert.strictEqual(store.updateCalls[0].issueId, 'C');
  });

  test('no-op when no issues exist', async function (assert) {
    let store = new MockIssueStore([]);

    await retryBlockedIssues(store);

    assert.strictEqual(store.updateCalls.length, 0);
    assert.strictEqual(store.commentCalls.length, 0);
  });
});
