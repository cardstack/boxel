import { module, test } from 'qunit';

import type { TestResult } from '../scripts/lib/factory-agent';
import {
  buildTestRunCardDocument,
  completeTestRun,
  createTestRun,
  formatTestResultSummary,
  parseRunRealmTestsOutput,
  parseToolResultOutput,
  resolveTestRun,
  type RunRealmTestsOutput,
  type TestRunAttributes,
} from '../scripts/lib/factory-test-realm';
import { pullRealmFiles } from '../scripts/lib/realm-operations';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const testRealmOptions = {
  testRealmUrl: 'https://realms.example.test/user/personal-tests/',
  testResultsModuleUrl:
    'https://realms.example.test/software-factory/test-results',
};

// ---------------------------------------------------------------------------
// parseRunRealmTestsOutput — returns TestRunAttributes directly
// ---------------------------------------------------------------------------

module('factory-test-realm > parseRunRealmTestsOutput', function () {
  test('parses all-passing output into TestRunAttributes', function (assert) {
    let output: RunRealmTestsOutput = {
      expected: 3,
      unexpected: 0,
      skipped: 0,
      failures: [],
    };

    let attrs = parseRunRealmTestsOutput(output, 1500);

    assert.strictEqual(attrs.status, 'passed');
    assert.strictEqual(attrs.passedCount, 3);
    assert.strictEqual(attrs.failedCount, 0);
    assert.strictEqual(attrs.results.length, 0);
    assert.strictEqual(attrs.durationMs, 1500);
  });

  test('parses output with failures', function (assert) {
    let output: RunRealmTestsOutput = {
      expected: 2,
      unexpected: 1,
      failures: [
        {
          title: 'sticky-note > renders fitted view',
          outcome: 'unexpected',
          error: 'Expected element to be visible',
        },
      ],
    };

    let attrs = parseRunRealmTestsOutput(output, 3200);

    assert.strictEqual(attrs.status, 'failed');
    assert.strictEqual(attrs.passedCount, 2);
    assert.strictEqual(attrs.failedCount, 1);
    assert.strictEqual(attrs.results.length, 1);
    assert.strictEqual(
      attrs.results[0].testName,
      'sticky-note > renders fitted view',
    );
    assert.strictEqual(attrs.results[0].status, 'failed');
    assert.strictEqual(
      attrs.results[0].message,
      'Expected element to be visible',
    );
    assert.strictEqual(attrs.results[0].stackTrace, undefined);
  });

  test('splits error message from stack trace', function (assert) {
    let output: RunRealmTestsOutput = {
      expected: 0,
      unexpected: 1,
      failures: [
        {
          title: 'test > fails',
          outcome: 'unexpected',
          error:
            'Expect received to be true\n    at Object.<anonymous> (/tests/my.spec.ts:10:5)\n    at processTicksAndRejections',
        },
      ],
    };

    let attrs = parseRunRealmTestsOutput(output, 800);

    assert.strictEqual(attrs.results[0].message, 'Expect received to be true');
    assert.true(attrs.results[0].stackTrace?.includes('Object.<anonymous>'));
  });

  test('returns error status for empty output', function (assert) {
    let attrs = parseRunRealmTestsOutput({}, 0);

    assert.strictEqual(attrs.status, 'error');
    assert.strictEqual(attrs.passedCount, 0);
    assert.strictEqual(attrs.failedCount, 0);
  });

  test('returns failed when unexpected > 0 even with no failure details', function (assert) {
    let attrs = parseRunRealmTestsOutput(
      { expected: 1, unexpected: 2, failures: [] },
      500,
    );

    assert.strictEqual(attrs.status, 'failed');
    assert.strictEqual(attrs.failedCount, 2);
  });

  test('handles multiple failures', function (assert) {
    let output: RunRealmTestsOutput = {
      expected: 1,
      unexpected: 3,
      failures: [
        { title: 'test A', outcome: 'unexpected', error: 'error A' },
        { title: 'test B', outcome: 'unexpected', error: 'error B' },
        { title: 'test C', outcome: 'unexpected', error: 'error C' },
      ],
    };

    let attrs = parseRunRealmTestsOutput(output, 2000);

    assert.strictEqual(attrs.results.length, 3);
    assert.strictEqual(attrs.results[0].testName, 'test A');
    assert.strictEqual(attrs.results[2].testName, 'test C');
  });

  test('truncates stack traces to 500 chars', function (assert) {
    let longError = 'Error\n    at ' + 'x'.repeat(700);
    let output: RunRealmTestsOutput = {
      expected: 0,
      unexpected: 1,
      failures: [{ title: 'test', outcome: 'unexpected', error: longError }],
    };

    let attrs = parseRunRealmTestsOutput(output, 100);
    assert.true((attrs.results[0].stackTrace?.length ?? 0) <= 500);
  });

  test('parses Playwright JSON report with passing tests into results', function (assert) {
    let report = {
      stats: { expected: 2, unexpected: 0 },
      suites: [
        {
          specs: [
            {
              title: 'hello card renders greeting',
              ok: true,
              tests: [{ results: [{ status: 'passed', duration: 1200 }] }],
            },
            {
              title: 'hello card shows title',
              ok: true,
              tests: [{ results: [{ status: 'passed', duration: 800 }] }],
            },
          ],
        },
      ],
    } as unknown as RunRealmTestsOutput;

    let attrs = parseRunRealmTestsOutput(report, 2500);

    assert.strictEqual(attrs.status, 'passed');
    assert.strictEqual(attrs.results.length, 2);
    assert.strictEqual(
      attrs.results[0].testName,
      'hello card renders greeting',
    );
    assert.strictEqual(attrs.results[0].status, 'passed');
    assert.strictEqual(attrs.results[0].durationMs, 1200);
    assert.strictEqual(attrs.results[1].testName, 'hello card shows title');
    assert.strictEqual(attrs.results[1].status, 'passed');
    assert.strictEqual(attrs.passedCount, 2);
    assert.strictEqual(attrs.failedCount, 0);
  });

  test('parses Playwright JSON report with mixed pass/fail results', function (assert) {
    let report = {
      stats: { expected: 1, unexpected: 1 },
      suites: [
        {
          specs: [
            {
              title: 'passes',
              ok: true,
              tests: [{ results: [{ status: 'passed', duration: 500 }] }],
            },
            {
              title: 'fails',
              ok: false,
              tests: [
                {
                  results: [
                    {
                      status: 'failed',
                      duration: 300,
                      errors: [{ message: 'Expected true to be false' }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    } as unknown as RunRealmTestsOutput;

    let attrs = parseRunRealmTestsOutput(report, 1000);

    assert.strictEqual(attrs.status, 'failed');
    assert.strictEqual(attrs.results.length, 2);
    assert.strictEqual(attrs.results[0].status, 'passed');
    assert.strictEqual(attrs.results[1].status, 'failed');
    assert.strictEqual(attrs.results[1].message, 'Expected true to be false');
    assert.strictEqual(attrs.passedCount, 1);
    assert.strictEqual(attrs.failedCount, 1);
  });

  test('parses Playwright JSON report with nested suites', function (assert) {
    let report = {
      stats: { expected: 1, unexpected: 0 },
      suites: [
        {
          suites: [
            {
              specs: [
                {
                  title: 'nested test',
                  ok: true,
                  tests: [{ results: [{ status: 'passed', duration: 100 }] }],
                },
              ],
            },
          ],
        },
      ],
    } as unknown as RunRealmTestsOutput;

    let attrs = parseRunRealmTestsOutput(report, 200);

    assert.strictEqual(attrs.results.length, 1);
    assert.strictEqual(attrs.results[0].testName, 'nested test');
    assert.strictEqual(attrs.results[0].status, 'passed');
  });
});

// ---------------------------------------------------------------------------
// parseToolResultOutput — returns TestRunAttributes
// ---------------------------------------------------------------------------

module('factory-test-realm > parseToolResultOutput', function () {
  test('handles normal run-realm-tests JSON output', function (assert) {
    let output = { expected: 5, unexpected: 0, failures: [] };
    let attrs = parseToolResultOutput(output, 4000);

    assert.strictEqual(attrs.status, 'passed');
    assert.strictEqual(attrs.passedCount, 5);
  });

  test('handles tool error output with errorMessage', function (assert) {
    let output = { error: 'HTTP 500', body: 'Internal server error' };
    let attrs = parseToolResultOutput(output, 100);

    assert.strictEqual(attrs.status, 'error');
    assert.true(attrs.errorMessage?.includes('HTTP 500'));
    assert.strictEqual(attrs.results[0].status, 'error');
  });

  test('handles unparseable raw output', function (assert) {
    let attrs = parseToolResultOutput({ raw: 'some garbage stdout' }, 200);

    assert.strictEqual(attrs.status, 'error');
    assert.true(attrs.errorMessage?.includes('Unparseable'));
  });

  test('handles unexpected output type', function (assert) {
    let attrs = parseToolResultOutput('just a string', 100);

    assert.strictEqual(attrs.status, 'error');
    assert.true(attrs.errorMessage?.includes('Unexpected'));
  });

  test('handles null output', function (assert) {
    let attrs = parseToolResultOutput(null, 100);
    assert.strictEqual(attrs.status, 'error');
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

  test('pre-populates results as pending', function (assert) {
    let doc = buildTestRunCardDocument(
      ['test A', 'test B', 'test C'],
      testRealmOptions.testResultsModuleUrl,
    );

    let results = doc.data.attributes!.results as {
      testName: string;
      status: string;
    }[];
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

  test('includes ticket relationship when ticketURL is provided', function (assert) {
    let doc = buildTestRunCardDocument(
      ['test A'],
      testRealmOptions.testResultsModuleUrl,
      { ticketURL: '../Ticket/define-sticky-note-core' },
    );

    let relationships = doc.data.relationships as Record<
      string,
      { links: { self: string | null } }
    >;
    assert.strictEqual(
      relationships.ticket.links.self,
      '../Ticket/define-sticky-note-core',
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

  test('includes both project and ticket relationships', function (assert) {
    let doc = buildTestRunCardDocument(
      ['test A'],
      testRealmOptions.testResultsModuleUrl,
      {
        projectCardUrl: 'http://localhost:4201/test/Projects/hello-world',
        ticketURL: '../Ticket/implement-feature',
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
      relationships.ticket.links.self,
      '../Ticket/implement-feature',
    );
  });

  test('omits relationships when no ticketURL or projectCardUrl', function (assert) {
    let doc = buildTestRunCardDocument(
      ['test A'],
      testRealmOptions.testResultsModuleUrl,
    );

    assert.strictEqual(doc.data.relationships, undefined);
  });

  test('includes specRef when provided', function (assert) {
    let doc = buildTestRunCardDocument(
      ['test A'],
      testRealmOptions.testResultsModuleUrl,
      { specRef: { module: './test-spec', name: 'default' } },
    );

    let specRef = doc.data.attributes!.specRef as {
      module: string;
      name: string;
    };
    assert.strictEqual(specRef.module, './test-spec');
    assert.strictEqual(specRef.name, 'default');
  });
});

// ---------------------------------------------------------------------------
// createTestRun
// ---------------------------------------------------------------------------

module('factory-test-realm > createTestRun', function () {
  test('POSTs card document to test realm', async function (assert) {
    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;

    let mockFetch = (async (
      url: string | URL | Request,
      init?: RequestInit,
    ) => {
      capturedUrl = String(url);
      capturedInit = init;
      return new Response('{}', { status: 200 });
    }) as typeof globalThis.fetch;

    let result = await createTestRun(
      'define-sticky-note',
      ['test A', 'test B'],
      {
        ...testRealmOptions,
        authorization: 'Bearer test-token',
        fetch: mockFetch,
        sequenceNumber: 1,
      },
    );

    assert.true(result.created);
    assert.strictEqual(result.testRunId, 'Test Runs/define-sticky-note-1');
    assert.strictEqual(
      capturedUrl,
      'https://realms.example.test/user/personal-tests/Test%20Runs/define-sticky-note-1.json',
    );
    assert.strictEqual(capturedInit?.method, 'POST');

    let headers = capturedInit?.headers as Record<string, string>;
    assert.strictEqual(headers['Content-Type'], 'application/vnd.card+source');
    assert.strictEqual(headers['Authorization'], 'Bearer test-token');

    let body = JSON.parse(capturedInit?.body as string);
    assert.strictEqual(body.data.meta.adoptsFrom.name, 'TestRun');
    assert.strictEqual(body.data.attributes.status, 'running');
  });

  test('returns error on HTTP failure', async function (assert) {
    let mockFetch = (async () => {
      return new Response('Forbidden', { status: 403 });
    }) as typeof globalThis.fetch;

    let result = await createTestRun('my-test', ['test A'], {
      ...testRealmOptions,
      fetch: mockFetch,
    });

    assert.false(result.created);
    assert.true(result.error?.includes('403'));
  });

  test('returns error on network failure', async function (assert) {
    let mockFetch = (async () => {
      throw new Error('Network unreachable');
    }) as typeof globalThis.fetch;

    let result = await createTestRun('my-test', ['test A'], {
      ...testRealmOptions,
      fetch: mockFetch,
    });

    assert.false(result.created);
    assert.strictEqual(result.error, 'Network unreachable');
  });
});

// ---------------------------------------------------------------------------
// completeTestRun — now accepts TestRunAttributes
// ---------------------------------------------------------------------------

module('factory-test-realm > completeTestRun', function () {
  test('reads existing card and updates with TestRunAttributes', async function (assert) {
    let calls: { url: string; method: string }[] = [];

    let existingCard = {
      data: {
        type: 'card',
        attributes: {
          status: 'running',
          sequenceNumber: 1,
          passedCount: 0,
          failedCount: 0,
          results: [],
        },
        meta: {
          adoptsFrom: {
            module: testRealmOptions.testResultsModuleUrl,
            name: 'TestRun',
          },
        },
      },
    };

    let mockFetch = (async (
      url: string | URL | Request,
      init?: RequestInit,
    ) => {
      let urlStr = String(url);
      let method = init?.method ?? 'GET';
      calls.push({ url: urlStr, method });

      if (method === 'GET') {
        return new Response(JSON.stringify(existingCard), {
          status: 200,
          headers: { 'Content-Type': 'application/vnd.card+source' },
        });
      }
      return new Response('{}', { status: 200 });
    }) as typeof globalThis.fetch;

    let attrs: TestRunAttributes = {
      status: 'passed',
      passedCount: 3,
      failedCount: 0,
      durationMs: 1500,
      results: [],
    };

    let result = await completeTestRun(
      'Test Runs/define-sticky-note-1',
      attrs,
      { ...testRealmOptions, fetch: mockFetch },
    );

    assert.true(result.updated);
    assert.strictEqual(calls.length, 2);
    assert.strictEqual(calls[0].method, 'GET');
    assert.strictEqual(calls[1].method, 'POST');
    assert.true(calls[1].url.includes('Test%20Runs/define-sticky-note-1.json'));
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
      results: [],
    };

    let result = await completeTestRun('Test Runs/missing-1', attrs, {
      ...testRealmOptions,
      fetch: mockFetch,
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
      results?: { testName: string; status: string }[];
    }[],
  ) {
    return (async (url: string | URL | Request, init?: RequestInit) => {
      let urlStr = String(url);
      let method = init?.method ?? 'GET';

      // Search endpoint
      if (urlStr.includes('_search') && method === 'QUERY') {
        return new Response(
          JSON.stringify({
            data: testRuns.map((tr) => ({
              id: `https://realms.example.test/user/personal/${tr.id}`,
              type: 'card',
              attributes: {
                status: tr.status,
                sequenceNumber: tr.sequenceNumber,
                results: tr.results ?? [],
              },
            })),
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/vnd.card+json' },
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
      targetRealmUrl: 'https://realms.example.test/user/personal/',
      slug: 'my-ticket',
      specPaths: ['TestSpec/my-ticket.spec.ts'],
      testNames: ['test A'],
      fetch: buildMockSearchFetch([]),
    });

    assert.strictEqual(handle.status, 'running');
    assert.strictEqual(handle.testRunId, 'Test Runs/my-ticket-1');
  });

  test('creates new TestRun when most recent is completed', async function (assert) {
    let handle = await resolveTestRun({
      ...testRealmOptions,
      targetRealmUrl: 'https://realms.example.test/user/personal/',
      slug: 'my-ticket',
      specPaths: ['TestSpec/my-ticket.spec.ts'],
      testNames: ['test A'],
      fetch: buildMockSearchFetch([
        { id: 'Test Runs/my-ticket-2', status: 'passed', sequenceNumber: 2 },
      ]),
    });

    assert.strictEqual(handle.status, 'running');
    assert.strictEqual(handle.testRunId, 'Test Runs/my-ticket-3');
  });

  test('resumes most recent running TestRun by default', async function (assert) {
    let handle = await resolveTestRun({
      ...testRealmOptions,
      targetRealmUrl: 'https://realms.example.test/user/personal/',
      slug: 'my-ticket',
      specPaths: ['TestSpec/my-ticket.spec.ts'],
      testNames: ['test A', 'test B'],
      fetch: buildMockSearchFetch([
        {
          id: 'Test Runs/my-ticket-2',
          status: 'running',
          sequenceNumber: 2,
          results: [
            { testName: 'test A', status: 'passed' },
            { testName: 'test B', status: 'pending' },
          ],
        },
      ]),
    });

    assert.strictEqual(handle.status, 'running');
    assert.strictEqual(handle.testRunId, 'Test Runs/my-ticket-2');
  });

  test('ignores partial TestRun with forceNew: true', async function (assert) {
    let handle = await resolveTestRun({
      ...testRealmOptions,
      targetRealmUrl: 'https://realms.example.test/user/personal/',
      slug: 'my-ticket',
      specPaths: ['TestSpec/my-ticket.spec.ts'],
      testNames: ['test A'],
      forceNew: true,
      fetch: buildMockSearchFetch([
        { id: 'Test Runs/my-ticket-2', status: 'running', sequenceNumber: 2 },
      ]),
    });

    assert.strictEqual(handle.status, 'running');
    // forceNew creates a new run with incremented sequence
    assert.strictEqual(handle.testRunId, 'Test Runs/my-ticket-3');
  });

  test('does NOT resume older partial TestRun when newer completed exists', async function (assert) {
    // The mock returns the most recent first (sorted by sequenceNumber desc).
    // The most recent (seq 3) is completed, so we create a new one.
    let handle = await resolveTestRun({
      ...testRealmOptions,
      targetRealmUrl: 'https://realms.example.test/user/personal/',
      slug: 'my-ticket',
      specPaths: ['TestSpec/my-ticket.spec.ts'],
      testNames: ['test A'],
      fetch: buildMockSearchFetch([
        { id: 'Test Runs/my-ticket-3', status: 'passed', sequenceNumber: 3 },
      ]),
    });

    assert.strictEqual(handle.status, 'running');
    assert.strictEqual(handle.testRunId, 'Test Runs/my-ticket-4');
  });

  test('sequence numbers increment correctly', async function (assert) {
    let handle = await resolveTestRun({
      ...testRealmOptions,
      targetRealmUrl: 'https://realms.example.test/user/personal/',
      slug: 'my-ticket',
      specPaths: ['TestSpec/my-ticket.spec.ts'],
      testNames: ['test A'],
      fetch: buildMockSearchFetch([
        { id: 'Test Runs/my-ticket-7', status: 'failed', sequenceNumber: 7 },
      ]),
    });

    assert.strictEqual(handle.testRunId, 'Test Runs/my-ticket-8');
  });
});

// ---------------------------------------------------------------------------
// pullRealmFiles
// ---------------------------------------------------------------------------

module('factory-test-realm > pullRealmFiles', function () {
  test('downloads files listed by _mtimes', async function (assert) {
    let realmUrl = 'https://realms.example.test/user/personal/';
    let capturedUrls: string[] = [];

    let mockFetch = (async (url: string | URL | Request) => {
      let urlStr = String(url);
      capturedUrls.push(urlStr);

      if (urlStr.includes('_mtimes')) {
        return new Response(
          JSON.stringify({
            [`${realmUrl}hello.gts`]: 1000,
            [`${realmUrl}HelloCard/sample.json`]: 2000,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      // File downloads
      return new Response('file-content', { status: 200 });
    }) as typeof globalThis.fetch;

    let tmpDir = `/tmp/sf-test-pull-${Date.now()}`;
    let result = await pullRealmFiles(realmUrl, tmpDir, { fetch: mockFetch });

    assert.strictEqual(result.error, undefined);
    assert.strictEqual(result.files.length, 2);
    assert.true(result.files.includes('hello.gts'));
    assert.true(result.files.includes('HelloCard/sample.json'));

    // Should have fetched _mtimes + 2 files = 3 requests
    assert.strictEqual(capturedUrls.length, 3);
    assert.true(capturedUrls[0].includes('_mtimes'));
  });

  test('passes authorization header', async function (assert) {
    let capturedHeaders: Record<string, string>[] = [];

    let mockFetch = (async (
      _url: string | URL | Request,
      init?: RequestInit,
    ) => {
      capturedHeaders.push((init?.headers as Record<string, string>) ?? {});
      // Return empty mtimes so no file downloads happen
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof globalThis.fetch;

    await pullRealmFiles('https://example.test/realm/', '/tmp/unused', {
      fetch: mockFetch,
      authorization: 'Bearer my-token',
    });

    assert.strictEqual(capturedHeaders[0]['Authorization'], 'Bearer my-token');
  });

  test('returns error on _mtimes HTTP failure', async function (assert) {
    let mockFetch = (async () => {
      return new Response('Forbidden', { status: 403 });
    }) as typeof globalThis.fetch;

    let result = await pullRealmFiles(
      'https://example.test/realm/',
      '/tmp/unused',
      { fetch: mockFetch },
    );

    assert.strictEqual(result.files.length, 0);
    assert.true(result.error?.includes('403'));
  });

  test('returns error on network failure', async function (assert) {
    let mockFetch = (async () => {
      throw new Error('ECONNREFUSED');
    }) as typeof globalThis.fetch;

    let result = await pullRealmFiles(
      'https://example.test/realm/',
      '/tmp/unused',
      { fetch: mockFetch },
    );

    assert.strictEqual(result.files.length, 0);
    assert.true(result.error?.includes('ECONNREFUSED'));
  });

  test('skips files outside the realm URL', async function (assert) {
    let realmUrl = 'https://realms.example.test/user/personal/';

    let mockFetch = (async (url: string | URL | Request) => {
      let urlStr = String(url);
      if (urlStr.includes('_mtimes')) {
        return new Response(
          JSON.stringify({
            [`${realmUrl}hello.gts`]: 1000,
            ['https://other.test/evil.gts']: 2000, // outside realm
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('content', { status: 200 });
    }) as typeof globalThis.fetch;

    let result = await pullRealmFiles(
      realmUrl,
      `/tmp/sf-test-pull-${Date.now()}`,
      {
        fetch: mockFetch,
      },
    );

    assert.strictEqual(result.files.length, 1);
    assert.strictEqual(result.files[0], 'hello.gts');
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
});
