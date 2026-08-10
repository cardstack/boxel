import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import {
  checkDomainAvailability,
  fetchPublishabilityReport,
  fetchPublishProgress,
  publishRealm,
  RealmOperationError,
  unpublishRealm,
  waitForReady,
  type RealmClient,
} from '@cardstack/runtime-common';

const REALM_SERVER_URL = 'https://realms.example/';

interface RecordedCall {
  url: string;
  method: string;
  body: unknown;
}

// Builds a RealmClient whose `authedFetch` is driven by `handler` and records
// each call so tests can assert request URL/method/body. `handler` receives the
// 0-based call index so it can return a different response per poll.
function makeClient(
  handler: (
    url: string,
    init: RequestInit | undefined,
    callIndex: number,
  ) => Response | Promise<Response>,
): { client: RealmClient; calls: RecordedCall[] } {
  let calls: RecordedCall[] = [];
  let client: RealmClient = {
    realmServerURL: REALM_SERVER_URL,
    config: { spaceDomain: 'boxel.space', siteDomain: 'boxel.site' },
    authedFetch: async (url, init) => {
      let callIndex = calls.length;
      let rawBody = init?.body;
      calls.push({
        url,
        method: (init?.method ?? 'GET').toUpperCase(),
        body: typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody,
      });
      return handler(url, init, callIndex);
    },
  };
  return { client, calls };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

module(basename(import.meta.filename), function () {
  module('realm-operations', function () {
    test('publishRealm POSTs normalized URLs and maps the 202 response', async function (assert) {
      let { client, calls } = makeClient(() =>
        jsonResponse(202, {
          data: {
            type: 'published_realm',
            id: 'pub-123',
            attributes: {
              sourceRealmURL: 'https://realms.example/mike/notes/',
              publishedRealmURL: 'https://mike.boxel.space/notes/',
              lastPublishedAt: '1717000000000',
              status: 'pending',
            },
          },
        }),
      );

      // Pass URLs without trailing slashes to exercise normalization.
      let result = await publishRealm(client, {
        sourceRealmURL: 'https://realms.example/mike/notes',
        publishedRealmURL: 'https://mike.boxel.space/notes',
      });

      assert.strictEqual(calls.length, 1);
      assert.strictEqual(calls[0].url, `${REALM_SERVER_URL}_publish-realm`);
      assert.strictEqual(calls[0].method, 'POST');
      assert.deepEqual(calls[0].body, {
        sourceRealmURL: 'https://realms.example/mike/notes/',
        publishedRealmURL: 'https://mike.boxel.space/notes/',
      });

      assert.deepEqual(result, {
        sourceRealmURL: 'https://realms.example/mike/notes/',
        publishedRealmURL: 'https://mike.boxel.space/notes/',
        publishedRealmId: 'pub-123',
        lastPublishedAt: '1717000000000',
        status: 'pending',
      });
    });

    test('publishRealm throws a RealmOperationError carrying the conflict status', async function (assert) {
      let { client } = makeClient(() =>
        jsonResponse(409, { errors: ['already published'] }),
      );

      try {
        await publishRealm(client, {
          sourceRealmURL: 'https://realms.example/mike/notes/',
          publishedRealmURL: 'https://mike.boxel.space/notes/',
        });
        assert.ok(false, 'expected publishRealm to throw');
      } catch (err) {
        assert.ok(err instanceof RealmOperationError);
        assert.strictEqual((err as RealmOperationError).status, 409);
        assert.ok(
          /already published/.test((err as RealmOperationError).body ?? ''),
        );
      }
    });

    test('unpublishRealm POSTs and maps the response', async function (assert) {
      let { client, calls } = makeClient(() =>
        jsonResponse(200, {
          data: {
            type: 'unpublished_realm',
            id: 'pub-123',
            attributes: {
              sourceRealmURL: 'https://realms.example/mike/notes/',
              publishedRealmURL: 'https://mike.boxel.space/notes/',
              lastPublishedAt: '1717000000000',
            },
          },
        }),
      );

      let result = await unpublishRealm(client, {
        publishedRealmURL: 'https://mike.boxel.space/notes',
      });

      assert.strictEqual(calls[0].url, `${REALM_SERVER_URL}_unpublish-realm`);
      assert.strictEqual(calls[0].method, 'POST');
      assert.deepEqual(calls[0].body, {
        publishedRealmURL: 'https://mike.boxel.space/notes/',
      });
      assert.deepEqual(result, {
        sourceRealmURL: 'https://realms.example/mike/notes/',
        publishedRealmURL: 'https://mike.boxel.space/notes/',
        lastPublishedAt: '1717000000000',
      });
    });

    test('unpublishRealm throws a RealmOperationError with status on failure', async function (assert) {
      let { client } = makeClient(() =>
        jsonResponse(422, { errors: ['not found'] }),
      );

      try {
        await unpublishRealm(client, {
          publishedRealmURL: 'https://mike.boxel.space/notes/',
        });
        assert.ok(false, 'expected unpublishRealm to throw');
      } catch (err) {
        assert.ok(err instanceof RealmOperationError);
        assert.strictEqual((err as RealmOperationError).status, 422);
        assert.ok(/not found/.test((err as RealmOperationError).body ?? ''));
      }
    });

    test('checkDomainAvailability builds the query and returns the result', async function (assert) {
      let { client, calls } = makeClient(() =>
        jsonResponse(200, { available: true, hostname: 'mysite.boxel.site' }),
      );

      let result = await checkDomainAvailability(client, {
        subdomain: 'mysite',
      });

      let calledUrl = new URL(calls[0].url);
      assert.strictEqual(
        calledUrl.origin + calledUrl.pathname,
        `${REALM_SERVER_URL}_check-boxel-domain-availability`,
      );
      assert.strictEqual(calledUrl.searchParams.get('subdomain'), 'mysite');
      assert.strictEqual(calls[0].method, 'GET');
      assert.deepEqual(result, {
        available: true,
        hostname: 'mysite.boxel.site',
      });
    });

    test('fetchPublishabilityReport maps the report', async function (assert) {
      let { client, calls } = makeClient(() =>
        jsonResponse(200, {
          data: {
            type: 'realm-publishability',
            attributes: {
              publishable: false,
              realmURL: 'https://realms.example/mike/notes/',
              violations: [
                {
                  kind: 'error-document',
                  resource: 'https://realms.example/mike/notes/Card/1',
                  errorDocUrl: 'https://realms.example/mike/notes/Card/1.json',
                },
              ],
              warningTypes: ['has-error-card-documents'],
            },
          },
        }),
      );

      let report = await fetchPublishabilityReport(client, {
        realmURL: 'https://realms.example/mike/notes',
      });

      assert.strictEqual(
        calls[0].url,
        'https://realms.example/mike/notes/_publishability',
      );
      assert.false(report.publishable);
      assert.strictEqual(report.realmURL, 'https://realms.example/mike/notes/');
      assert.strictEqual(report.violations.length, 1);
      assert.strictEqual(report.violations[0].kind, 'error-document');
      assert.deepEqual(report.warningTypes, ['has-error-card-documents']);
    });

    test('fetchPublishabilityReport defaults violations to an empty array', async function (assert) {
      let { client } = makeClient(() =>
        jsonResponse(200, {
          data: {
            attributes: {
              publishable: true,
              realmURL: 'https://realms.example/mike/notes/',
            },
          },
        }),
      );

      let report = await fetchPublishabilityReport(client, {
        realmURL: 'https://realms.example/mike/notes/',
      });
      assert.true(report.publishable);
      assert.deepEqual(report.violations, []);
    });

    test('waitForReady resolves once readiness returns ok', async function (assert) {
      // 503 on the first poll, 200 on the second.
      let { client, calls } = makeClient((_url, _init, callIndex) =>
        callIndex === 0
          ? new Response(null, { status: 503 })
          : new Response(null),
      );

      await waitForReady(client, {
        publishedRealmURL: 'https://mike.boxel.space/notes/',
        timeoutMs: 1000,
        pollIntervalMs: 1,
      });

      assert.strictEqual(calls.length, 2);
      assert.strictEqual(
        calls[0].url,
        'https://mike.boxel.space/notes/_readiness-check',
      );
    });

    test('waitForReady throws after the timeout elapses', async function (assert) {
      let { client } = makeClient(() => new Response(null, { status: 503 }));

      try {
        await waitForReady(client, {
          publishedRealmURL: 'https://mike.boxel.space/notes/',
          timeoutMs: 20,
          pollIntervalMs: 5,
        });
        assert.ok(false, 'expected waitForReady to throw');
      } catch (err) {
        assert.ok(err instanceof Error);
        assert.ok(/Timed out after 20ms/.test((err as Error).message));
      }
    });

    test('fetchPublishProgress reads the realm server, passing the published realm as a parameter', async function (assert) {
      let { client, calls } = makeClient(() =>
        jsonResponse(200, {
          data: {
            type: 'publish-progress',
            id: 'https://mike.boxel.space/notes/',
            attributes: { phase: 'index', filesCompleted: 42, totalFiles: 270 },
          },
        }),
      );

      // Pass a URL without a trailing slash to exercise normalization.
      let progress = await fetchPublishProgress(client, {
        publishedRealmURL: 'https://mike.boxel.space/notes',
      });

      assert.deepEqual(progress, {
        phase: 'index',
        filesCompleted: 42,
        totalFiles: 270,
      });
      assert.strictEqual(
        calls[0].url,
        `${REALM_SERVER_URL}_publish-progress?published_realm_url=${encodeURIComponent(
          'https://mike.boxel.space/notes/',
        )}`,
      );
    });

    // Progress is sampled on its own timer rather than read off the readiness
    // response, because a readiness poll can be held open for seconds at a
    // time. Driving both from one client here shows the two run independently.
    test('waitForReady reports progress while polling readiness', async function (assert) {
      let readings = [
        { phase: 'index', filesCompleted: 10, totalFiles: 270 },
        { phase: 'index', filesCompleted: 10, totalFiles: 270 },
        { phase: 'render', filesCompleted: 3, totalFiles: 270 },
      ];
      let reported: unknown[] = [];
      let progressPolls = 0;
      let { client } = makeClient((url) => {
        if (url.includes('_publish-progress')) {
          let reading =
            readings[Math.min(progressPolls++, readings.length - 1)];
          return jsonResponse(200, {
            data: {
              type: 'publish-progress',
              id: 'https://mike.boxel.space/notes/',
              attributes: reading,
            },
          });
        }
        // Stay not-ready until both distinct readings have been delivered, so
        // the wait outlives the progress sequence rather than racing it —
        // sampling stops the moment readiness passes.
        return new Response(null, { status: reported.length >= 2 ? 200 : 503 });
      });

      await waitForReady(client, {
        publishedRealmURL: 'https://mike.boxel.space/notes/',
        timeoutMs: 2000,
        pollIntervalMs: 1,
        progressPollIntervalMs: 1,
        onProgress: (progress) => reported.push(progress),
      });

      assert.deepEqual(
        reported,
        [
          { phase: 'index', filesCompleted: 10, totalFiles: 270 },
          { phase: 'render', filesCompleted: 3, totalFiles: 270 },
        ],
        'reports each change once — the repeated reading is not re-reported',
      );
    });

    // The freeze this feature exists to make visible must not be one it can
    // cause. A progress request that never settles — a server that accepts the
    // connection and then goes silent — cannot be allowed to hold up a wait
    // whose readiness check has already passed.
    test('waitForReady resolves and abandons the request when a progress sample never settles', async function (assert) {
      let aborted = false;
      let { client } = makeClient((url, init) => {
        if (url.includes('_publish-progress')) {
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              aborted = true;
              reject(new Error('aborted'));
            });
          });
        }
        return new Response(null, { status: 200 });
      });

      let outcome = await Promise.race([
        waitForReady(client, {
          publishedRealmURL: 'https://mike.boxel.space/notes/',
          timeoutMs: 2000,
          pollIntervalMs: 1,
          progressPollIntervalMs: 1,
          onProgress: () => {},
        }).then(() => 'resolved'),
        new Promise((resolve) => setTimeout(() => resolve('hung'), 3000)),
      ]);

      assert.strictEqual(
        outcome,
        'resolved',
        'the readiness result is not held up by the outstanding progress read',
      );
      assert.true(aborted, 'the outstanding progress read is abandoned');
    });

    // A realm server that doesn't serve the route (or a transient failure) must
    // not turn a publish that is progressing normally into a failure.
    test('waitForReady still resolves when progress sampling fails', async function (assert) {
      let progressPolls = 0;
      let { client } = makeClient((url, _init, callIndex) => {
        if (url.includes('_publish-progress')) {
          progressPolls++;
          return new Response(null, { status: 404 });
        }
        return new Response(null, { status: callIndex === 0 ? 503 : 200 });
      });

      let reported: unknown[] = [];
      await waitForReady(client, {
        publishedRealmURL: 'https://mike.boxel.space/notes/',
        timeoutMs: 1000,
        pollIntervalMs: 5,
        progressPollIntervalMs: 1,
        onProgress: (progress) => reported.push(progress),
      });

      assert.strictEqual(reported.length, 0, 'nothing is reported');
      assert.true(progressPolls > 0, 'progress was attempted');
    });
  });
});
