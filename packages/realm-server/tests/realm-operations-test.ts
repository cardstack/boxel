import { module, test } from 'qunit';
import { basename } from 'path';
import {
  checkDomainAvailability,
  fetchPublishabilityReport,
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
  });
});
