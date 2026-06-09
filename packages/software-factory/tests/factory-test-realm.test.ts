import { module, test } from 'qunit';

import { rri } from '@cardstack/runtime-common/realm-identifiers';
import { SupportedMimeType } from '@cardstack/runtime-common/supported-mime-type';

import type { TestResult } from '../src/factory-agent/index.ts';
import {
  buildTestRunCardDocument,
  completeTestRun,
  createTestRun,
  formatTestResultSummary,
  parseQunitResults,
  resolveTestRun,
  type TestRunAttributes,
} from '../src/factory-test-realm.ts';
import { createMockClient } from './helpers/mock-client.ts';
import { createTestWorkspace } from './helpers/workspace-fixture.ts';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const testRealmOptions = {
  targetRealm: 'https://realms.example.test/user/personal-tests/',
  testResultsModuleUrl:
    'https://realms.example.test/software-factory/test-results',
  realmServerUrl: 'https://realms.example.test/',
  workspaceDir: createTestWorkspace().dir,
};

// ---------------------------------------------------------------------------
// parseQunitResults — converts QUnit browser results to TestRunAttributes
// ---------------------------------------------------------------------------

module('factory-test-realm > parseQunitResults', function () {
  test('all-passing results', function (assert) {
    let results = parseQunitResults({
      tests: [
        {
          name: 'test A',
          module: 'Module1',
          status: 'passed',
          runtime: 100,
          errors: [],
        },
        {
          name: 'test B',
          module: 'Module1',
          status: 'passed',
          runtime: 200,
          errors: [],
        },
      ],
      runEnd: {
        status: 'passed',
        testCounts: { passed: 2, failed: 0, skipped: 0, todo: 0, total: 2 },
        runtime: 300,
      },
    });
    assert.strictEqual(results.status, 'passed');
    assert.strictEqual(results.passedCount, 2);
    assert.strictEqual(results.failedCount, 0);
    assert.strictEqual(results.moduleResults.length, 1);
    assert.strictEqual(results.moduleResults[0].moduleRef?.module, 'Module1');
  });

  test('mixed pass/fail results', function (assert) {
    let results = parseQunitResults({
      tests: [
        {
          name: 'passing',
          module: 'Mod',
          status: 'passed',
          runtime: 50,
          errors: [],
        },
        {
          name: 'failing',
          module: 'Mod',
          status: 'failed',
          runtime: 100,
          errors: [{ message: 'Expected true', stack: 'at test.js:5' }],
        },
      ],
      runEnd: {
        status: 'failed',
        testCounts: { passed: 1, failed: 1, skipped: 0, todo: 0, total: 2 },
        runtime: 150,
      },
    });
    assert.strictEqual(results.status, 'failed');
    assert.strictEqual(results.passedCount, 1);
    assert.strictEqual(results.failedCount, 1);
  });

  test('groups by module name', function (assert) {
    let results = parseQunitResults({
      tests: [
        {
          name: 'A',
          module: 'Alpha',
          status: 'passed',
          runtime: 10,
          errors: [],
        },
        {
          name: 'B',
          module: 'Beta',
          status: 'passed',
          runtime: 20,
          errors: [],
        },
      ],
      runEnd: {
        status: 'passed',
        testCounts: { passed: 2, failed: 0, skipped: 0, todo: 0, total: 2 },
        runtime: 30,
      },
    });
    assert.strictEqual(results.moduleResults.length, 2);
    assert.strictEqual(results.moduleResults[0].moduleRef?.module, 'Alpha');
    assert.strictEqual(results.moduleResults[1].moduleRef?.module, 'Beta');
  });

  test('null runEnd returns error', function (assert) {
    let results = parseQunitResults({ tests: [], runEnd: null });
    assert.strictEqual(results.status, 'error');
    assert.true(
      Boolean(results.errorMessage && results.errorMessage.includes('runEnd')),
    );
  });

  test('empty tests returns error', function (assert) {
    let results = parseQunitResults({
      tests: [],
      runEnd: {
        status: 'passed',
        testCounts: { passed: 0, failed: 0, skipped: 0, todo: 0, total: 0 },
        runtime: 0,
      },
    });
    assert.strictEqual(results.status, 'error');
  });

  test('extracts error message and stack trace', function (assert) {
    let results = parseQunitResults({
      tests: [
        {
          name: 'fails',
          module: 'M',
          status: 'failed',
          runtime: 10,
          errors: [
            { message: 'assertion failed', stack: 'at line 42\nat line 99' },
          ],
        },
      ],
      runEnd: {
        status: 'failed',
        testCounts: { passed: 0, failed: 1, skipped: 0, todo: 0, total: 1 },
        runtime: 10,
      },
    });
    let entry = results.moduleResults[0].results[0];
    assert.strictEqual(entry.message, 'assertion failed');
    assert.true(
      Boolean(entry.stackTrace && entry.stackTrace.includes('at line 42')),
    );
  });

  test('maps skipped QUnit tests to skipped status', function (assert) {
    let results = parseQunitResults({
      tests: [
        {
          name: 'real test',
          module: 'Mod',
          status: 'passed',
          runtime: 50,
          errors: [],
        },
        {
          name: 'skipped test',
          module: 'Mod',
          status: 'skipped',
          runtime: 0,
          errors: [],
        },
        {
          name: 'todo test',
          module: 'Mod',
          status: 'todo',
          runtime: 0,
          errors: [],
        },
      ],
      runEnd: {
        status: 'passed',
        testCounts: { passed: 1, failed: 0, skipped: 1, todo: 1, total: 3 },
        runtime: 50,
      },
    });
    assert.strictEqual(results.status, 'passed');
    assert.strictEqual(results.passedCount, 1);
    assert.strictEqual(results.failedCount, 0);
    assert.strictEqual(results.skippedCount, 2);
    let entries = results.moduleResults[0].results;
    assert.strictEqual(entries[0].status, 'passed');
    assert.strictEqual(entries[1].status, 'skipped');
    assert.strictEqual(entries[2].status, 'skipped');
  });

  test('all-skipped tests are treated as failed', function (assert) {
    let results = parseQunitResults({
      tests: [
        {
          name: 'skip A',
          module: 'Mod',
          status: 'skipped',
          runtime: 0,
          errors: [],
        },
        {
          name: 'todo B',
          module: 'Mod',
          status: 'todo',
          runtime: 0,
          errors: [],
        },
      ],
      runEnd: {
        status: 'passed',
        testCounts: { passed: 0, failed: 0, skipped: 1, todo: 1, total: 2 },
        runtime: 0,
      },
    });
    assert.strictEqual(
      results.status,
      'failed',
      'all-skipped run should be failed',
    );
    assert.strictEqual(results.passedCount, 0);
    assert.strictEqual(results.failedCount, 0);
    assert.strictEqual(results.skippedCount, 2);
  });
});

// ---------------------------------------------------------------------------
// buildTestRunCardDocument
// ---------------------------------------------------------------------------

module('factory-test-realm > buildTestRunCardDocument', function () {
  test('builds card with adoptsFrom pointing to test-results module', function (assert) {
    let doc = buildTestRunCardDocument(
      ['test A', 'test B'],
      testRealmOptions.testResultsModuleUrl,
    );

    assert.strictEqual(doc.data.type, 'card');
    let adoptsFrom = doc.data.meta.adoptsFrom as {
      module: string;
      name: string;
    };
    assert.strictEqual(
      adoptsFrom.module,
      testRealmOptions.testResultsModuleUrl,
    );
    assert.strictEqual(adoptsFrom.name, 'TestRun');
  });

  test('pre-populates moduleResults with pending entries', function (assert) {
    let doc = buildTestRunCardDocument(
      ['test A', 'test B', 'test C'],
      testRealmOptions.testResultsModuleUrl,
    );

    let moduleResults = doc.data.attributes!.moduleResults as {
      results: { testName: string; status: string }[];
    }[];
    assert.strictEqual(moduleResults.length, 1);
    let results = moduleResults[0].results;
    assert.strictEqual(results.length, 3);
    assert.strictEqual(results[0].testName, 'test A');
    assert.strictEqual(results[0].status, 'pending');
    assert.strictEqual(results[2].testName, 'test C');
    assert.strictEqual(results[2].status, 'pending');
  });

  test('sets status to running', function (assert) {
    let doc = buildTestRunCardDocument(
      ['test A'],
      testRealmOptions.testResultsModuleUrl,
    );

    assert.strictEqual(doc.data.attributes!.status, 'running');
  });

  test('includes sequenceNumber', function (assert) {
    let doc = buildTestRunCardDocument(
      ['test A'],
      testRealmOptions.testResultsModuleUrl,
      { sequenceNumber: 5 },
    );

    assert.strictEqual(doc.data.attributes!.sequenceNumber, 5);
  });

  test('includes issue relationship when issueURL is provided', function (assert) {
    let doc = buildTestRunCardDocument(
      ['test A'],
      testRealmOptions.testResultsModuleUrl,
      { issueURL: '../Issues/define-sticky-note-core' },
    );

    let relationships = doc.data.relationships as Record<
      string,
      { links: { self: string | null } }
    >;
    assert.strictEqual(
      relationships.issue.links.self,
      '../Issues/define-sticky-note-core',
    );
  });

  test('includes project relationship when projectCardUrl is provided', function (assert) {
    let doc = buildTestRunCardDocument(
      ['test A'],
      testRealmOptions.testResultsModuleUrl,
      { projectCardUrl: 'http://localhost:4201/test/Projects/hello-world' },
    );

    let relationships = doc.data.relationships as Record<
      string,
      { links: { self: string | null } }
    >;
    assert.strictEqual(
      relationships.project.links.self,
      'http://localhost:4201/test/Projects/hello-world',
    );
  });

  test('includes both project and issue relationships', function (assert) {
    let doc = buildTestRunCardDocument(
      ['test A'],
      testRealmOptions.testResultsModuleUrl,
      {
        projectCardUrl: 'http://localhost:4201/test/Projects/hello-world',
        issueURL: '../Issues/implement-feature',
      },
    );

    let relationships = doc.data.relationships as Record<
      string,
      { links: { self: string | null } }
    >;
    assert.strictEqual(
      relationships.project.links.self,
      'http://localhost:4201/test/Projects/hello-world',
    );
    assert.strictEqual(
      relationships.issue.links.self,
      '../Issues/implement-feature',
    );
  });

  test('omits relationships when no issueURL or projectCardUrl', function (assert) {
    let doc = buildTestRunCardDocument(
      ['test A'],
      testRealmOptions.testResultsModuleUrl,
    );

    assert.strictEqual(doc.data.relationships, undefined);
  });

  test('includes moduleRef in moduleResults when provided', function (assert) {
    let doc = buildTestRunCardDocument(
      ['test A'],
      testRealmOptions.testResultsModuleUrl,
      {
        moduleRef: {
          module: rri('./test-spec'),
          name: 'default',
        },
      },
    );

    let moduleResults = doc.data.attributes!.moduleResults as {
      moduleRef?: { module: string; name: string };
      results: unknown[];
    }[];
    assert.strictEqual(moduleResults.length, 1);
    assert.strictEqual(moduleResults[0].moduleRef?.module, './test-spec');
    assert.strictEqual(moduleResults[0].moduleRef?.name, 'default');
  });
});

// ---------------------------------------------------------------------------
// createTestRun
// ---------------------------------------------------------------------------

module('factory-test-realm > createTestRun', function () {
  test('writes TestRun card to workspace with running status', async function (assert) {
    let workspace = createTestWorkspace();

    let result = await createTestRun(
      'define-sticky-note',
      ['test A', 'test B'],
      {
        ...testRealmOptions,
        workspaceDir: workspace.dir,
        client: createMockClient(),
        sequenceNumber: 1,
      },
    );

    assert.true(result.created);
    assert.strictEqual(
      result.testRunId,
      'Validations/test_define-sticky-note-1',
    );

    // The card lives on local disk — the orchestrator syncs it to the
    // realm between iterations.
    let written = workspace.read('Validations/test_define-sticky-note-1.json');
    let body = JSON.parse(written);
    assert.strictEqual(body.data.meta.adoptsFrom.name, 'TestRun');
    assert.strictEqual(body.data.attributes.status, 'running');

    workspace.cleanup();
  });

  test('returns error when workspace write fails', async function (assert) {
    // Point workspaceDir at a path that can't be created (a regular file
    // blocks the directory creation inside writeCard).
    let workspace = createTestWorkspace();
    workspace.write('blocker', 'file');
    let badWorkspaceDir = `${workspace.dir}/blocker`;

    let result = await createTestRun('my-test', ['test A'], {
      ...testRealmOptions,
      workspaceDir: badWorkspaceDir,
      client: createMockClient(),
    });

    assert.false(result.created);
    assert.true(
      Boolean(result.error && result.error.length > 0),
      'surfaces fs error',
    );

    workspace.cleanup();
  });
});

// ---------------------------------------------------------------------------
// completeTestRun — now accepts TestRunAttributes
// ---------------------------------------------------------------------------

module('factory-test-realm > completeTestRun', function () {
  test('reads existing card from workspace and writes updated attributes back', async function (assert) {
    let workspace = createTestWorkspace();

    let existingCard = {
      data: {
        type: 'card',
        attributes: {
          status: 'running',
          sequenceNumber: 1,
          passedCount: 0,
          failedCount: 0,
          moduleResults: [],
        },
        meta: {
          adoptsFrom: {
            module: testRealmOptions.testResultsModuleUrl,
            name: 'TestRun',
          },
        },
      },
    };
    workspace.write(
      'Validations/test_define-sticky-note-1.json',
      JSON.stringify(existingCard, null, 2),
    );

    let attrs: TestRunAttributes = {
      status: 'passed',
      passedCount: 3,
      failedCount: 0,
      durationMs: 1500,
      moduleResults: [],
    };

    let result = await completeTestRun(
      'Validations/test_define-sticky-note-1',
      attrs,
      {
        ...testRealmOptions,
        workspaceDir: workspace.dir,
        client: createMockClient(),
      },
    );

    assert.true(result.updated);

    // The workspace file was updated with the completion attributes
    // (status flipped from running → passed, durationMs added).
    let updated = JSON.parse(
      workspace.read('Validations/test_define-sticky-note-1.json'),
    );
    assert.strictEqual(updated.data.attributes.status, 'passed');
    assert.strictEqual(updated.data.attributes.durationMs, 1500);
    assert.true(Boolean(updated.data.attributes.completedAt));

    workspace.cleanup();
  });

  test('returns error when read fails', async function (assert) {
    let mockFetch = (async () => {
      return new Response('Not Found', { status: 404 });
    }) as typeof globalThis.fetch;

    let attrs: TestRunAttributes = {
      status: 'passed',
      passedCount: 1,
      failedCount: 0,
      durationMs: 100,
      moduleResults: [],
    };

    let result = await completeTestRun('Validations/test_missing-1', attrs, {
      ...testRealmOptions,
      client: createMockClient({ fetch: mockFetch }),
    });

    assert.false(result.updated);
    assert.true(result.error?.includes('Failed to read TestRun'));
  });
});

// ---------------------------------------------------------------------------
// resolveTestRun — resume logic (mocked, fast)
// ---------------------------------------------------------------------------

module('factory-test-realm > resolveTestRun', function () {
  function buildMockSearchFetch(
    testRuns: {
      id: string;
      status: string;
      sequenceNumber: number;
      moduleResults?: {
        results?: { testName: string; status: string }[];
      }[];
    }[],
  ) {
    return (async (url: string | URL | Request, init?: RequestInit) => {
      let urlStr = String(url);
      let method = init?.method ?? 'GET';

      // Search endpoint (used by findResumableTestRun and getNextSequenceNumber)
      if (urlStr.includes('_search') && method === 'QUERY') {
        return new Response(
          JSON.stringify({
            data: testRuns.map((tr) => ({
              id: `https://realms.example.test/user/personal/${tr.id}`,
              type: 'card',
              attributes: {
                status: tr.status,
                sequenceNumber: tr.sequenceNumber,
                moduleResults: tr.moduleResults ?? [],
              },
            })),
          }),
          {
            status: 200,
            headers: { 'Content-Type': SupportedMimeType.CardJson },
          },
        );
      }

      // Write endpoint (for createTestRun)
      if (method === 'POST') {
        return new Response('{}', { status: 200 });
      }

      return new Response('Not found', { status: 404 });
    }) as typeof globalThis.fetch;
  }

  test('creates new TestRun when no existing runs', async function (assert) {
    let handle = await resolveTestRun({
      ...testRealmOptions,
      targetRealm: 'https://realms.example.test/user/personal/',
      slug: 'my-issue',
      testNames: ['test A'],
      realmServerUrl: 'https://realms.example.test/',
      hostAppUrl: 'https://realms.example.test/',
      client: createMockClient({ fetch: buildMockSearchFetch([]) }),
    });

    assert.strictEqual(handle.status, 'running');
    assert.strictEqual(handle.testRunId, 'Validations/test_my-issue-1');
  });

  test('creates new TestRun when most recent is completed', async function (assert) {
    let handle = await resolveTestRun({
      ...testRealmOptions,
      targetRealm: 'https://realms.example.test/user/personal/',
      slug: 'my-issue',
      testNames: ['test A'],
      realmServerUrl: 'https://realms.example.test/',
      hostAppUrl: 'https://realms.example.test/',
      client: createMockClient({
        fetch: buildMockSearchFetch([
          {
            id: 'Validations/test_my-issue-2',
            status: 'passed',
            sequenceNumber: 2,
          },
        ]),
      }),
    });

    assert.strictEqual(handle.status, 'running');
    assert.strictEqual(handle.testRunId, 'Validations/test_my-issue-3');
  });

  test('resumes most recent running TestRun by default', async function (assert) {
    let handle = await resolveTestRun({
      ...testRealmOptions,
      targetRealm: 'https://realms.example.test/user/personal/',
      slug: 'my-issue',
      testNames: ['test A', 'test B'],
      realmServerUrl: 'https://realms.example.test/',
      hostAppUrl: 'https://realms.example.test/',
      client: createMockClient({
        fetch: buildMockSearchFetch([
          {
            id: 'Validations/test_my-issue-2',
            status: 'running',
            sequenceNumber: 2,
            moduleResults: [
              {
                results: [
                  { testName: 'test A', status: 'passed' },
                  { testName: 'test B', status: 'pending' },
                ],
              },
            ],
          },
        ]),
      }),
    });

    assert.strictEqual(handle.status, 'running');
    assert.strictEqual(handle.testRunId, 'Validations/test_my-issue-2');
  });

  test('ignores partial TestRun with forceNew: true', async function (assert) {
    let handle = await resolveTestRun({
      ...testRealmOptions,
      targetRealm: 'https://realms.example.test/user/personal/',
      slug: 'my-issue',
      testNames: ['test A'],
      forceNew: true,
      realmServerUrl: 'https://realms.example.test/',
      hostAppUrl: 'https://realms.example.test/',
      client: createMockClient({
        fetch: buildMockSearchFetch([
          {
            id: 'Validations/test_my-issue-2',
            status: 'running',
            sequenceNumber: 2,
          },
        ]),
      }),
    });

    assert.strictEqual(handle.status, 'running');
    // forceNew creates a new run with incremented sequence
    assert.strictEqual(handle.testRunId, 'Validations/test_my-issue-3');
  });

  test('does NOT resume older partial TestRun when newer completed exists', async function (assert) {
    // The mock returns the most recent first (sorted by sequenceNumber desc).
    // The most recent (seq 3) is completed, so we create a new one.
    let handle = await resolveTestRun({
      ...testRealmOptions,
      targetRealm: 'https://realms.example.test/user/personal/',
      slug: 'my-issue',
      testNames: ['test A'],
      realmServerUrl: 'https://realms.example.test/',
      hostAppUrl: 'https://realms.example.test/',
      client: createMockClient({
        fetch: buildMockSearchFetch([
          {
            id: 'Validations/test_my-issue-3',
            status: 'passed',
            sequenceNumber: 3,
          },
        ]),
      }),
    });

    assert.strictEqual(handle.status, 'running');
    assert.strictEqual(handle.testRunId, 'Validations/test_my-issue-4');
  });

  test('sequence numbers increment correctly', async function (assert) {
    let handle = await resolveTestRun({
      ...testRealmOptions,
      targetRealm: 'https://realms.example.test/user/personal/',
      slug: 'my-issue',
      testNames: ['test A'],
      realmServerUrl: 'https://realms.example.test/',
      hostAppUrl: 'https://realms.example.test/',
      client: createMockClient({
        fetch: buildMockSearchFetch([
          {
            id: 'Validations/test_my-issue-7',
            status: 'failed',
            sequenceNumber: 7,
          },
        ]),
      }),
    });

    assert.strictEqual(handle.testRunId, 'Validations/test_my-issue-8');
  });

  test('consecutive forceNew calls create separate TestRuns with incrementing sequences', async function (assert) {
    // Simulates what happens during the factory loop: each iteration should
    // create a new TestRun, not overwrite the previous one. This is a
    // regression test for the bug where iterations shared a single TestRun.
    let handle1 = await resolveTestRun({
      ...testRealmOptions,
      targetRealm: 'https://realms.example.test/user/personal/',
      slug: 'my-issue',
      testNames: ['test A'],
      forceNew: true,
      realmServerUrl: 'https://realms.example.test/',
      hostAppUrl: 'https://realms.example.test/',
      client: createMockClient({ fetch: buildMockSearchFetch([]) }),
    });

    assert.strictEqual(handle1.testRunId, 'Validations/test_my-issue-1');
    assert.false(handle1.resumed, 'first run is not resumed');

    // Second call with forceNew — should get sequence 2, not resume sequence 1
    let handle2 = await resolveTestRun({
      ...testRealmOptions,
      targetRealm: 'https://realms.example.test/user/personal/',
      slug: 'my-issue',
      testNames: ['test A'],
      forceNew: true,
      realmServerUrl: 'https://realms.example.test/',
      hostAppUrl: 'https://realms.example.test/',
      client: createMockClient({
        fetch: buildMockSearchFetch([
          {
            id: 'Validations/test_my-issue-1',
            status: 'running',
            sequenceNumber: 1,
          },
        ]),
      }),
    });

    assert.strictEqual(handle2.testRunId, 'Validations/test_my-issue-2');
    assert.false(handle2.resumed, 'second run is not resumed');
    assert.notStrictEqual(
      handle1.testRunId,
      handle2.testRunId,
      'each iteration gets its own TestRun',
    );
  });

  test('lastSequenceNumber prevents reuse when realm index is stale', async function (assert) {
    // Simulates the real-world bug: the realm search index hasn't indexed
    // the TestRun created in the previous iteration, so the search returns
    // stale data. Without lastSequenceNumber, getNextSequenceNumber would
    // return 1 again and overwrite the first TestRun.
    let handle1 = await resolveTestRun({
      ...testRealmOptions,
      targetRealm: 'https://realms.example.test/user/personal/',
      slug: 'my-issue',
      testNames: ['test A'],
      forceNew: true,
      realmServerUrl: 'https://realms.example.test/',
      hostAppUrl: 'https://realms.example.test/',
      client: createMockClient({ fetch: buildMockSearchFetch([]) }),
    });

    assert.strictEqual(handle1.testRunId, 'Validations/test_my-issue-1');

    // Second call — search index is STALE (still returns empty), but
    // lastSequenceNumber=1 prevents reusing sequence 1.
    let handle2 = await resolveTestRun({
      ...testRealmOptions,
      targetRealm: 'https://realms.example.test/user/personal/',
      slug: 'my-issue',
      testNames: ['test A'],
      forceNew: true,
      lastSequenceNumber: 1,
      realmServerUrl: 'https://realms.example.test/',
      hostAppUrl: 'https://realms.example.test/',
      client: createMockClient({ fetch: buildMockSearchFetch([]) }),
    });

    assert.strictEqual(
      handle2.testRunId,
      'Validations/test_my-issue-2',
      'uses lastSequenceNumber as floor even when index returns nothing',
    );

    // Third call — index still stale, lastSequenceNumber=2
    let handle3 = await resolveTestRun({
      ...testRealmOptions,
      targetRealm: 'https://realms.example.test/user/personal/',
      slug: 'my-issue',
      testNames: ['test A'],
      forceNew: true,
      lastSequenceNumber: 2,
      realmServerUrl: 'https://realms.example.test/',
      hostAppUrl: 'https://realms.example.test/',
      client: createMockClient({ fetch: buildMockSearchFetch([]) }),
    });

    assert.strictEqual(
      handle3.testRunId,
      'Validations/test_my-issue-3',
      'continues incrementing from lastSequenceNumber floor',
    );
  });
});

// ---------------------------------------------------------------------------
// formatTestResultSummary
// ---------------------------------------------------------------------------

module('factory-test-realm > formatTestResultSummary', function () {
  test('formats passing result', function (assert) {
    let result: TestResult = {
      status: 'passed',
      passedCount: 5,
      failedCount: 0,
      failures: [],
      durationMs: 2000,
    };

    let summary = formatTestResultSummary(result);

    assert.true(summary.includes('Status: passed'));
    assert.true(summary.includes('Passed: 5, Failed: 0'));
    assert.true(summary.includes('Duration: 2000ms'));
    assert.false(summary.includes('Failures:'));
  });

  test('formats failing result with failure details', function (assert) {
    let result: TestResult = {
      status: 'failed',
      passedCount: 2,
      failedCount: 1,
      failures: [
        {
          testName: 'renders card',
          error: 'Element not found',
          stackTrace: 'at Object.<anonymous> (test.ts:10)',
        },
      ],
      durationMs: 3000,
    };

    let summary = formatTestResultSummary(result);

    assert.true(summary.includes('Status: failed'));
    assert.true(summary.includes('Passed: 2, Failed: 1'));
    assert.true(summary.includes('Failures:'));
    assert.true(summary.includes('renders card'));
    assert.true(summary.includes('Element not found'));
    assert.true(summary.includes('Object.<anonymous>'));
  });

  test('truncates long stack traces', function (assert) {
    let longStack = 'at '.padEnd(600, 'x');
    let result: TestResult = {
      status: 'failed',
      passedCount: 0,
      failedCount: 1,
      failures: [{ testName: 'test', error: 'err', stackTrace: longStack }],
      durationMs: 100,
    };

    let summary = formatTestResultSummary(result);
    assert.true(summary.length < longStack.length);
  });

  test('includes skipped count when present', function (assert) {
    let result: TestResult = {
      status: 'passed',
      passedCount: 3,
      failedCount: 0,
      skippedCount: 2,
      failures: [],
      durationMs: 1000,
    };

    let summary = formatTestResultSummary(result);
    assert.true(summary.includes('Skipped: 2'));
  });

  test('omits skipped count when zero', function (assert) {
    let result: TestResult = {
      status: 'passed',
      passedCount: 5,
      failedCount: 0,
      skippedCount: 0,
      failures: [],
      durationMs: 2000,
    };

    let summary = formatTestResultSummary(result);
    assert.false(summary.includes('Skipped'));
  });
});
