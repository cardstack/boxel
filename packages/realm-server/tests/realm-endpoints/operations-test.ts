import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename, join } from 'path';
import fsExtra from 'fs-extra';
const { existsSync, readFileSync } = fsExtra;
import type { Test, SuperTest } from 'supertest';
import type { DirResult } from 'tmp';
import type { PgAdapter } from '@cardstack/postgres';

import {
  BOXEL_OPERATIONS_EXT,
  rri,
  SupportedMimeType,
} from '@cardstack/runtime-common';
import type {
  DBAdapter,
  LooseSingleCardDocument,
  Realm,
} from '@cardstack/runtime-common';
import { APP_BOXEL_REALM_EVENT_TYPE } from '@cardstack/runtime-common/matrix-constants';
import type {
  IncrementalIndexEventContent,
  RealmEventContent,
} from '@cardstack/base/matrix-event';
import type { RealmHttpServer as Server } from '../../server.ts';
import {
  createJWT,
  setupMatrixRoom,
  setupPermissionedRealmCached,
  waitUntil,
  withRealmPath,
  type RealmRequest,
} from '../helpers/index.ts';

// ============================================================================
// The `_operations` endpoint.
//
// What is under test is the transport: how a batch is read off the wire, which
// behavior each entry's name resolves to for its target, what comes back
// positionally, and what the realm is left holding. The operation core's own
// behavior — what a transform program does to a document, how a create mints a
// URL — is covered where that behavior lives; the assertions here are about
// what reaching it through this endpoint means, which includes the cases where
// it is never reached at all.
//
// Two realms, because the endpoint's permission is derived from the HTTP
// method and nothing else: one anyone may read and write, where the batches
// run, and one anyone may only read, where a write is refused before a body is
// ever parsed.
// ============================================================================

const testRealm = new URL('http://127.0.0.1:4472/test/');
const testRealmHref = testRealm.href;
const readOnlyRealm = new URL('http://127.0.0.1:4473/test/');

const OPERATIONS = SupportedMimeType.BoxelOperations;
const PERSON = { module: rri(`${testRealmHref}person`), name: 'Person' };
const EXTERNAL_REPORT = {
  module: rri(`${testRealmHref}report`),
  name: 'ExternalReport',
};

function envelope(...operations: unknown[]) {
  return JSON.stringify({ 'boxel:operations': operations });
}

function invoke(
  name: string,
  rest: { href?: string; data?: unknown } = {},
): Record<string, unknown> {
  return { op: 'invoke', 'boxel:name': name, ...rest };
}

function parallel(...operations: unknown[]): Record<string, unknown> {
  return { op: 'parallel', 'boxel:operations': operations };
}

function serial(...operations: unknown[]): Record<string, unknown> {
  return { op: 'serial', 'boxel:operations': operations };
}

function person(lid: string, firstName: string, friend?: string) {
  return {
    lid,
    type: 'card',
    attributes: { firstName },
    ...(friend
      ? { relationships: { friend: { data: { lid: friend, type: 'card' } } } }
      : {}),
    meta: { adoptsFrom: PERSON },
  };
}

function reportFile(): LooseSingleCardDocument {
  return {
    data: {
      type: 'card',
      attributes: {
        headline: 'Quarterly Review',
        status: 'open',
        comments: [],
      },
      relationships: { owner: { links: { self: './reviewer' } } },
      meta: { adoptsFrom: EXTERNAL_REPORT },
    },
  };
}

function makeFileSystem(): Record<string, string | LooseSingleCardDocument> {
  return {
    'person.gts': `
      import { contains, field, linksTo, CardDef, Component } from "@cardstack/base/card-api";
      import StringField from "@cardstack/base/string";

      export class Person extends CardDef {
        @field firstName = contains(StringField);
        @field friend = linksTo(() => Person, { searchable: true });
        static isolated = class Isolated extends Component<typeof this> {
          <template><h1><@fields.firstName /></h1></template>
        }
        static embedded = class Embedded extends Component<typeof this> {
          <template><h1><@fields.firstName /></h1></template>
        }
        static fitted = class Fitted extends Component<typeof this> {
          <template><h1><@fields.firstName /></h1></template>
        }
      }
    `,
    // The declarations reach the endpoint the way an author's do: the module is
    // indexed, the prerender host lowers its `@operation`s into the type's
    // definition-cache entry, and dispatch reads them back out of it.
    'report.gts': `
      import { contains, containsMany, field, linksTo, CardDef, FieldDef, Component } from "@cardstack/base/card-api";
      import StringField from "@cardstack/base/string";
      import { operation, params, actor, bxl } from "@cardstack/base/operations";
      import { Person } from "./person";

      export class ReportComment extends FieldDef {
        @field body = contains(StringField);
        @field postedBy = contains(StringField);
      }

      export class ExternalReport extends CardDef {
        @field headline = contains(StringField);
        @field status = contains(StringField);
        @field comments = containsMany(ReportComment);
        @field owner = linksTo(() => Person, { searchable: true });

        @operation static escalate = {
          base: 'transform',
          set: { status: 'escalated' },
        };

        @operation static addComment = {
          base: 'transform',
          params: { body: StringField },
          append: {
            to: 'comments',
            value: { body: params('body'), postedBy: actor() },
          },
        };

        @operation static restate = {
          base: 'transform',
          params: { headline: StringField },
          input: bxl\`{headline: params("headline")}\`,
          set: { headline: params('headline') },
        };

        @operation static openOnly = {
          base: 'transform',
          transformations: bxl\`
            assert(.status == "open"; "Report is not open");
            .status = "escalated";
          \`,
        };

        @operation static knownReviewers = {
          base: 'query',
          query: { filter: { on: Person, eq: { firstName: 'Reviewer' } } },
        };

        static isolated = class Isolated extends Component<typeof this> {
          <template><h1><@fields.headline /></h1></template>
        }
        static embedded = class Embedded extends Component<typeof this> {
          <template><h1><@fields.headline /></h1></template>
        }
        static fitted = class Fitted extends Component<typeof this> {
          <template><h1><@fields.headline /></h1></template>
        }
      }
    `,
    'event-log.gts': `
      import { contains, containsMany, field, CardDef, FieldDef, Component } from "@cardstack/base/card-api";
      import StringField from "@cardstack/base/string";

      export class LogEvent extends FieldDef {
        @field label = contains(StringField);
      }

      export class EventLog extends CardDef {
        @field title = contains(StringField);
        @field events = containsMany(LogEvent);
        static isolated = class Isolated extends Component<typeof this> {
          <template><h1><@fields.title /></h1></template>
        }
        static embedded = class Embedded extends Component<typeof this> {
          <template><h1><@fields.title /></h1></template>
        }
        static fitted = class Fitted extends Component<typeof this> {
          <template><h1><@fields.title /></h1></template>
        }
      }
    `,
    'deploys.json': {
      data: {
        type: 'card',
        attributes: { title: 'Deploys', events: [] },
        meta: {
          adoptsFrom: {
            module: rri(`${testRealmHref}event-log`),
            name: 'EventLog',
          },
        },
      },
    },
    'reviewer.json': {
      data: {
        type: 'card',
        attributes: { firstName: 'Reviewer' },
        meta: { adoptsFrom: PERSON },
      },
    },
    // One report per test that changes one, so the tests in this file do not
    // have to be ordered against each other.
    ...Object.fromEntries(
      [
        'report-named',
        'report-mixed',
        'report-rollback',
        'report-kept',
        'report-anonymous',
        'report-identified',
        'report-deleted',
        'report-relative',
        'report-uncached',
        'report-canonical',
        'report-query',
        'report-unserved',
        'report-position',
        // One per group test, for the same reason.
        'report-parallel-1',
        'report-parallel-2',
        'report-parallel-3',
        'report-abandoned-1',
        'report-abandoned-2',
        'report-conflict',
        'report-nested-1',
        'report-nested-2',
        'report-nested-3',
        'report-shape',
        'report-tree-write',
      ].map((name) => [`${name}.json`, reportFile()]),
    ),
    // The one report that is not open, so an operation asserting that it is
    // refuses the batch it sits in.
    'report-closed.json': {
      data: {
        type: 'card',
        attributes: {
          headline: 'Quarterly Review',
          status: 'closed',
          comments: [],
        },
        relationships: { owner: { links: { self: './reviewer' } } },
        meta: { adoptsFrom: EXTERNAL_REPORT },
      },
    },
    'notes.md': '# Notes\n',
    'positions.log': 'boot\n',
    'group.log': 'boot\n',
    // A stored file the registered-extension table does not name, so its URL
    // classifies as a card and the executor is what tells the two apart.
    'telemetry.log': 'boot\n',
  };
}

module(`realm-endpoints/${basename(import.meta.filename)}`, function () {
  module('a realm anyone may read and write', function (hooks) {
    let realm: Realm;
    let testDbAdapter: DBAdapter;
    let request: RealmRequest;
    let serverRequest: SuperTest<Test>;
    let testRealmHttpServer: Server;
    let dir: DirResult;

    setupPermissionedRealmCached(hooks, {
      mode: 'before',
      realmURL: testRealm,
      permissions: {
        '*': ['read', 'write'],
        '@node-test_realm:localhost': ['read', 'write', 'realm-owner'],
      },
      subscribeToRealmEvents: true,
      fileSystem: makeFileSystem(),
      onRealmSetup(args) {
        realm = args.testRealm;
        testDbAdapter = args.dbAdapter;
        request = withRealmPath(args.request, testRealm);
        serverRequest = args.request;
        testRealmHttpServer = args.testRealmHttpServer;
        dir = args.dir;
      },
    });

    let { getMessagesSince } = setupMatrixRoom(hooks, () => ({
      testRealm: realm,
      testRealmHttpServer,
      request,
      serverRequest,
      dir,
      dbAdapter: testDbAdapter as PgAdapter,
    }));

    function realmFile(localPath: string): string {
      return join(dir.name, 'realm_server_1', 'test', localPath);
    }

    function storedCard(localPath: string): LooseSingleCardDocument {
      return JSON.parse(readFileSync(realmFile(localPath), 'utf8'));
    }

    async function indexJobIds(): Promise<number[]> {
      let rows = (await testDbAdapter.execute(
        `select id from jobs where job_type = 'incremental-index'
         and concurrency_group = $1 order by id`,
        { bind: [`indexing:${realm.url}`] },
      )) as { id: number | string }[];
      return rows.map((row) => Number(row.id));
    }

    async function incrementalIndexEventsSince(
      since: number,
    ): Promise<IncrementalIndexEventContent[]> {
      let messages = await getMessagesSince(since);
      return messages
        .filter((message) => message.type === APP_BOXEL_REALM_EVENT_TYPE)
        .map((message) => message.content as RealmEventContent)
        .filter(
          (event): event is IncrementalIndexEventContent =>
            event.eventName === 'index' && event.indexType === 'incremental',
        );
    }

    const TESTER = '@tester:localhost';

    // The realm lets anyone read and write it, so a batch reaches the endpoint
    // with or without credentials — which is the difference the identity module
    // is about. Everywhere else the caller is authenticated, since that is the
    // ordinary case and it is what gives an operation an actor to read.
    function post(body: string) {
      return anonymousPost(body).set(
        'Authorization',
        `Bearer ${createJWT(realm, TESTER, ['read', 'write'])}`,
      );
    }

    function anonymousPost(body: string) {
      return request
        .post('/_operations')
        .set('Accept', OPERATIONS)
        .set('Content-Type', OPERATIONS)
        .send(body);
    }

    // Sent as a `POST` carrying the override header, which is the spelling for
    // clients that cannot send a `QUERY` method; the realm reads it back into a
    // `QUERY` before it decides which permission the request needs.
    function query(body: string) {
      return post(body).set('X-HTTP-Method-Override', 'QUERY');
    }

    module('validation', function () {
      test('an href outside this realm is refused, naming the entry', async function (assert) {
        let response = await post(
          envelope(
            invoke('escalate', { href: '/report-kept' }),
            invoke('escalate', {
              href: 'http://127.0.0.1:4999/other/report-x',
            }),
          ),
        );

        assert.strictEqual(response.status, 400, 'HTTP 400 status');
        let [error] = response.body.errors;
        assert.strictEqual(error.code, 'invalid-params');
        assert.strictEqual(
          error.meta.entry,
          1,
          'the error names the entry that carries the foreign href',
        );
        assert.true(
          error.detail.includes('http://127.0.0.1:4999/other/report-x'),
          `detail names the href: ${error.detail}`,
        );
        assert.strictEqual(
          storedCard('report-kept.json').data.attributes?.status,
          'open',
          'the entry that would have succeeded wrote nothing',
        );
      });

      test('a name the target does not carry is refused', async function (assert) {
        let response = await post(
          envelope(invoke('unheardOf', { href: '/report-kept' })),
        );

        assert.strictEqual(response.status, 404, 'HTTP 404 status');
        let [error] = response.body.errors;
        assert.strictEqual(error.code, 'unknown-operation');
        assert.strictEqual(error.meta.entry, 0);
      });

      test('every spelling of the operations media type reaches the endpoint', async function (assert) {
        // The router matches a media type by its type and its parameters, so the
        // extension is named the same operation whichever way a client writes
        // it. Sent as the content type alone in each case — a `fetch` that sets
        // one and leaves `Accept` to its default is the shape that has no other
        // header to fall back on.
        for (let spelling of [
          `application/vnd.api+json;ext="${BOXEL_OPERATIONS_EXT}"`,
          `application/vnd.api+json; ext="${BOXEL_OPERATIONS_EXT}"`,
          `application/vnd.api+json;ext=${BOXEL_OPERATIONS_EXT}`,
          `application/vnd.api+json;ext="https://jsonapi.org/ext/atomic ${BOXEL_OPERATIONS_EXT}"`,
          `application/vnd.api+json;charset=utf-8;ext="${BOXEL_OPERATIONS_EXT}"`,
        ]) {
          let response = await request
            .post('/_operations')
            .set('Content-Type', spelling)
            .set(
              'Authorization',
              `Bearer ${createJWT(realm, TESTER, ['read', 'write'])}`,
            )
            .send(envelope(invoke('read', { href: '/report-kept' })));

          assert.strictEqual(
            response.status,
            200,
            `${spelling} is carried out`,
          );
        }
      });

      test('an Accept naming another family does not hide the content type that named this endpoint', async function (assert) {
        // The lookup prefers `Accept` and falls back to `Content-Type`, and the
        // fall-through is on failing to match a route rather than on the family
        // holding none for the method. `application/json` holds POST routes —
        // for other paths — so stopping at the family would answer "no such
        // route" to a request whose content type named this one.
        let response = await request
          .post('/_operations')
          .set('Accept', 'application/json; charset=utf-8')
          .set('Content-Type', OPERATIONS)
          .set(
            'Authorization',
            `Bearer ${createJWT(realm, TESTER, ['read', 'write'])}`,
          )
          .send(envelope(invoke('read', { href: '/report-kept' })));

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
      });

      test('a body sent without the operations extension is told what it is missing', async function (assert) {
        let response = await request
          .post('/_operations')
          .set('Accept', SupportedMimeType.JSONAPI)
          .set('Content-Type', SupportedMimeType.JSONAPI)
          .send(envelope(invoke('escalate', { href: '/report-kept' })));

        assert.strictEqual(response.status, 400, 'HTTP 400 status');
        let [error] = response.body.errors;
        assert.strictEqual(error.title, 'Invalid content type');
        assert.true(
          error.detail.includes('ext='),
          `detail names the extension parameter: ${error.detail}`,
        );
      });

      test('an entry naming a query is sent to the search engine', async function (assert) {
        let response = await query(
          envelope(invoke('knownReviewers', { href: '/report-kept' })),
        );

        assert.strictEqual(response.status, 400, 'HTTP 400 status');
        let [error] = response.body.errors;
        assert.strictEqual(error.code, 'wrong-entry-point');
        assert.strictEqual(error.meta.entry, 0);
        assert.true(
          error.detail.includes('search engine'),
          `detail says where a query runs: ${error.detail}`,
        );
      });

      test('an entry naming readSource is sent to the byte routes', async function (assert) {
        let response = await query(
          envelope(invoke('readSource', { href: '/notes.md' })),
        );

        assert.strictEqual(response.status, 400, 'HTTP 400 status');
        let [error] = response.body.errors;
        assert.strictEqual(error.code, 'wrong-entry-point');
        assert.strictEqual(error.meta.entry, 0);
      });

      test('a QUERY batch carrying a write is refused', async function (assert) {
        let response = await query(
          envelope(
            invoke('read', { href: '/report-kept' }),
            invoke('escalate', { href: '/report-kept' }),
          ),
        );

        assert.strictEqual(response.status, 400, 'HTTP 400 status');
        let [error] = response.body.errors;
        assert.strictEqual(error.code, 'wrong-entry-point');
        assert.strictEqual(
          error.meta.entry,
          1,
          'the error names the entry that writes',
        );
        assert.strictEqual(
          storedCard('report-kept.json').data.attributes?.status,
          'open',
          'nothing was written',
        );
      });

      test('an entry naming no verb the envelope carries is refused', async function (assert) {
        let response = await post(
          envelope({ op: 'add', href: '/report-kept' }),
        );

        assert.strictEqual(response.status, 400, 'HTTP 400 status');
        let [error] = response.body.errors;
        assert.strictEqual(error.meta.entry, 0);
        for (let verb of ['invoke', 'parallel', 'serial']) {
          assert.true(
            error.detail.includes(verb),
            `detail names the "${verb}" verb: ${error.detail}`,
          );
        }
      });

      test('a group holding no members is refused', async function (assert) {
        let response = await post(
          envelope(invoke('escalate', { href: '/report-kept' }), parallel()),
        );

        assert.strictEqual(response.status, 400, 'HTTP 400 status');
        let [error] = response.body.errors;
        assert.strictEqual(error.meta.entry, 1);
        assert.strictEqual(
          storedCard('report-kept.json').data.attributes?.status,
          'open',
          'and the entry beside it wrote nothing',
        );
      });

      test("a group carrying an invocation's members is refused", async function (assert) {
        for (let [member, value] of [
          ['boxel:name', 'escalate'],
          ['href', '/report-kept'],
          ['data', { body: 'x' }],
        ] as [string, unknown][]) {
          let response = await post(
            envelope({
              op: 'serial',
              [member]: value,
              'boxel:operations': [
                invoke('escalate', { href: '/report-kept' }),
              ],
            }),
          );

          assert.strictEqual(response.status, 400, `"${member}" is refused`);
          assert.true(
            response.body.errors[0].detail.includes(member),
            `detail names the member: ${response.body.errors[0].detail}`,
          );
        }
      });

      test('a refusal inside a group names the path down to the entry', async function (assert) {
        let response = await post(
          envelope(
            invoke('escalate', { href: '/report-kept' }),
            parallel(
              invoke('escalate', { href: '/report-kept' }),
              serial(
                invoke('escalate', {
                  href: 'http://127.0.0.1:4999/other/report-x',
                }),
              ),
            ),
          ),
        );

        assert.strictEqual(response.status, 400, 'HTTP 400 status');
        let [error] = response.body.errors;
        assert.strictEqual(
          error.meta.entry,
          '[1].boxel:operations[1].boxel:operations[0]',
          'the path through the tree, since no single number reaches it',
        );
      });

      test('a QUERY batch carrying a write anywhere in the tree is refused', async function (assert) {
        let response = await query(
          envelope(
            invoke('read', { href: '/report-kept' }),
            parallel(
              invoke('read', { href: '/report-kept' }),
              serial(invoke('escalate', { href: '/report-tree-write' })),
            ),
          ),
        );

        assert.strictEqual(response.status, 400, 'HTTP 400 status');
        let [error] = response.body.errors;
        assert.strictEqual(error.code, 'wrong-entry-point');
        assert.strictEqual(
          error.meta.entry,
          '[1].boxel:operations[1].boxel:operations[0]',
          'the write is named wherever in the tree it sits',
        );
        assert.strictEqual(
          storedCard('report-tree-write.json').data.attributes?.status,
          'open',
          'nothing was written',
        );
      });

      test('a body that is not an envelope is refused', async function (assert) {
        let response = await post(JSON.stringify({ 'atomic:operations': [] }));

        assert.strictEqual(response.status, 400, 'HTTP 400 status');
        let [error] = response.body.errors;
        assert.true(
          error.detail.includes('boxel:operations'),
          `detail names the member it looked for: ${error.detail}`,
        );
      });

      test('a type reference that is not one is refused rather than thrown out of', async function (assert) {
        let response = await post(
          envelope(
            invoke('create', {
              data: {
                type: 'card',
                attributes: { firstName: 'Mango' },
                meta: {
                  adoptsFrom: { type: 'fieldOf', card: null, field: 'x' },
                },
              },
            }),
          ),
        );

        assert.strictEqual(
          response.status,
          400,
          "a malformed reference is the caller's to fix, not a fault to report",
        );
        assert.strictEqual(response.body.errors[0].meta.entry, 0);
      });

      test('an operation whose declaration carries a stage a batch does not run is refused', async function (assert) {
        let response = await post(
          envelope(
            invoke('restate', {
              href: '/report-unserved',
              data: { headline: 'Revised' },
            }),
          ),
        );

        assert.strictEqual(response.status, 501, 'HTTP 501 status');
        assert.true(
          response.body.errors[0].detail.includes('input'),
          `the refusal names the stage: ${response.body.errors[0].detail}`,
        );
        assert.strictEqual(
          storedCard('report-unserved.json').data.attributes?.headline,
          'Quarterly Review',
          'and nothing was written under a declaration half carried out',
        );
      });

      test('two entries claiming one local id are refused', async function (assert) {
        let response = await post(
          envelope(
            invoke('create', {
              data: {
                lid: 'twin',
                type: 'card',
                attributes: { firstName: 'Mango' },
                meta: { adoptsFrom: PERSON },
              },
            }),
            invoke('create', {
              data: {
                lid: 'twin',
                type: 'card',
                attributes: { firstName: 'Van Gogh' },
                meta: { adoptsFrom: PERSON },
              },
            }),
          ),
        );

        assert.strictEqual(response.status, 400, 'HTTP 400 status');
        let [error] = response.body.errors;
        assert.strictEqual(error.meta.entry, 1);
        assert.true(
          error.detail.includes('twin'),
          `detail names the local id: ${error.detail}`,
        );
      });

      test('a local id no entry creates is refused', async function (assert) {
        let response = await post(
          envelope(
            invoke('create', {
              data: {
                type: 'card',
                attributes: { firstName: 'Mango' },
                relationships: {
                  friend: { data: { lid: 'nobody', type: 'card' } },
                },
                meta: { adoptsFrom: PERSON },
              },
            }),
          ),
        );

        assert.strictEqual(response.status, 400, 'HTTP 400 status');
        let [error] = response.body.errors;
        assert.strictEqual(error.meta.entry, 0);
        assert.true(
          error.detail.includes('nobody'),
          `detail names the local id: ${error.detail}`,
        );
      });
    });

    module('invocation', function () {
      test('a named transform runs and answers with the identity it wrote', async function (assert) {
        let response = await post(
          envelope(
            invoke('addComment', {
              href: '/report-named',
              data: { body: 'Reviewed.' },
            }),
          ),
        );

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        let [result] = response.body['atomic:results'];
        assert.strictEqual(
          result.data.id,
          `${testRealmHref}report-named`,
          'the result names the card the entry targeted',
        );
        assert.strictEqual(
          typeof result.data.meta.version,
          'string',
          'the result carries the version the card now holds',
        );
        assert.strictEqual(
          result.data.attributes,
          undefined,
          'a write answers with an identity rather than a document',
        );
        assert.deepEqual(
          storedCard('report-named.json').data.attributes?.comments,
          [{ body: 'Reviewed.', postedBy: TESTER }],
          'the comment the operation appends is on disk, recording the caller ' +
            'the realm verified as the actor',
        );
      });

      test('a create names the type it mints and echoes the local id', async function (assert) {
        let response = await post(
          envelope(
            invoke('create', {
              data: {
                lid: 'author',
                type: 'card',
                attributes: { firstName: 'Mango' },
                meta: { adoptsFrom: PERSON },
              },
            }),
            invoke('create', {
              data: {
                lid: 'sidekick',
                type: 'card',
                attributes: { firstName: 'Van Gogh' },
                relationships: {
                  friend: { data: { lid: 'author', type: 'card' } },
                },
                meta: { adoptsFrom: PERSON },
              },
            }),
          ),
        );

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        let [author, sidekick] = response.body['atomic:results'];
        assert.deepEqual(
          [author.data.lid, sidekick.data.lid],
          ['author', 'sidekick'],
          'each create echoes the local id the client named it with',
        );
        assert.true(
          author.data.id.startsWith(`${testRealmHref}Person/`),
          `the minted id is under the type's directory: ${author.data.id}`,
        );
        assert.strictEqual(
          author.data.type,
          'card',
          'a write answers with a card identity',
        );
        let stored = JSON.parse(
          readFileSync(
            realmFile(`${sidekick.data.id.slice(testRealmHref.length)}.json`),
            'utf8',
          ),
        );
        assert.strictEqual(
          new URL(
            stored.data.relationships.friend.links.self,
            `${sidekick.data.id}.json`,
          ).href,
          author.data.id,
          'the second card links to the one the first entry minted',
        );
      });

      test('an equivalent spelling of an href names the same card', async function (assert) {
        // The index is read by exact URL, so a declared operation resolves only
        // once the spelling has been folded to the one the realm addresses the
        // card by — and the identity the entry answers with is that one too.
        for (let [spelling, what] of [
          ['/report-canonical?view=full', 'a query string'],
          ['/report-canonical#section', 'a fragment'],
        ]) {
          let response = await post(
            envelope(invoke('escalate', { href: spelling })),
          );

          assert.strictEqual(response.status, 200, `${what} is carried out`);
          assert.strictEqual(
            response.body['atomic:results'][0].data.id,
            `${testRealmHref}report-canonical`,
            `${what} answers with the id the realm serves the card under`,
          );
        }
        assert.strictEqual(
          storedCard('report-canonical.json').data.attributes?.status,
          'escalated',
          'and the card the spellings name is the one that changed',
        );
      });

      test('a delete answers with no state and removes the file', async function (assert) {
        let response = await post(
          envelope(invoke('delete', { href: '/report-deleted' })),
        );

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.deepEqual(
          response.body['atomic:results'],
          [{ data: null }],
          'a delete leaves no state to describe',
        );
        assert.false(
          existsSync(realmFile('report-deleted.json')),
          'the card is gone from disk',
        );
      });

      test('an href relative to the realm names a card inside it', async function (assert) {
        let response = await post(
          envelope(invoke('escalate', { href: '/report-relative' })),
        );

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.strictEqual(
          response.body['atomic:results'][0].data.id,
          `${testRealmHref}report-relative`,
          'a leading slash names the realm root rather than the origin',
        );
      });

      test('a line is appended to a file whose extension the realm does not register', async function (assert) {
        let response = await post(
          envelope(
            invoke('appendLine', {
              href: '/telemetry.log',
              data: { line: 'deployed' },
            }),
          ),
        );

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.strictEqual(
          readFileSync(realmFile('telemetry.log'), 'utf8'),
          'boot\ndeployed\n',
          'the line is on the end of the file',
        );
      });

      test('an append hands the field and its items through to the executor', async function (assert) {
        // The one entry shape whose payload is neither a document nor params:
        // the field and the items are named in `data` and handed to the append
        // executor under the names it reads them by. They are also the members
        // taken out of what an operation sees as its params, so passing them
        // through and keeping them out of params are the same change.
        let response = await post(
          envelope(
            invoke('appendContainsMany', {
              href: '/deploys',
              data: { field: 'events', items: [{ label: 'shipped' }] },
            }),
          ),
        );

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.strictEqual(
          response.body['atomic:results'][0].data.id,
          `${testRealmHref}deploys`,
        );
        assert.deepEqual(
          storedCard('deploys.json').data.attributes?.events,
          [{ label: 'shipped' }],
          'the item the entry named is on the end of the field it named',
        );
      });

      test('a read answers with the document, and a write on a file is refused', async function (assert) {
        let read = await query(envelope(invoke('read', { href: '/notes.md' })));

        assert.strictEqual(read.status, 200, 'HTTP 200 status');
        assert.strictEqual(
          read.body['atomic:results'][0].data.type,
          'file-meta',
          'a file reads as its metadata document',
        );

        let write = await post(
          envelope(invoke('transform', { href: '/notes.md' })),
        );
        assert.strictEqual(write.status, 405, 'HTTP 405 status');
        assert.strictEqual(
          write.body.errors[0].code,
          'operation-not-allowed',
          'a file carries no transform',
        );
      });
    });

    module('atomicity', function () {
      test('a failing entry leaves the batch unwritten, unindexed and unannounced', async function (assert) {
        let jobsBefore = await indexJobIds();
        let since = Date.now();

        let response = await post(
          envelope(
            invoke('read', { href: '/report-kept' }),
            invoke('escalate', { href: '/report-rollback' }),
            invoke('delete', { href: '/does-not-exist' }),
          ),
        );

        assert.strictEqual(response.status, 404, 'HTTP 404 status');
        assert.strictEqual(
          response.body.errors[0].meta.entry,
          2,
          'the error names the entry the caller sent, not the position it took ' +
            'among the entries that write',
        );
        assert.strictEqual(
          storedCard('report-rollback.json').data.attributes?.status,
          'open',
          'the entry that could have been carried out wrote nothing',
        );
        assert.deepEqual(
          await indexJobIds(),
          jobsBefore,
          'no index job was enqueued',
        );
        assert.deepEqual(
          await incrementalIndexEventsSince(since),
          [],
          'no index event was broadcast',
        );
      });

      test('a refusal names the entry the caller sent, in its key and in its prose', async function (assert) {
        // The coordinator is handed only the entries that write, so its own
        // numbering runs 0,1 where the caller sent 1,2. Both the keys and the
        // sentence have to speak the caller's.
        let response = await post(
          envelope(
            invoke('read', { href: '/report-kept' }),
            invoke('appendLine', {
              href: '/positions.log',
              data: { line: 'deployed' },
            }),
            invoke('update', {
              href: '/positions.log',
              data: { content: 'replaced\n' },
            }),
          ),
        );

        assert.strictEqual(response.status, 400, 'HTTP 400 status');
        let [error] = response.body.errors;
        assert.strictEqual(error.meta.entry, 2, 'the entry that collides');
        assert.strictEqual(
          error.meta.conflictsWith,
          1,
          'and the entry it collides with',
        );
        assert.true(
          error.detail.includes('entry 2'),
          `the prose names the entry that collides: ${error.detail}`,
        );
        assert.true(
          error.detail.includes('entry 1'),
          `and the entry it collides with: ${error.detail}`,
        );
        assert.strictEqual(
          readFileSync(realmFile('positions.log'), 'utf8'),
          'boot\n',
          'and nothing was written',
        );
      });

      test('a read in a mixed batch answers with the pre-batch document', async function (assert) {
        let response = await post(
          envelope(
            invoke('read', { href: '/report-mixed' }),
            invoke('escalate', { href: '/report-mixed' }),
            invoke('read', { href: '/notes.md' }),
          ),
        );

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        let [before, write, file] = response.body['atomic:results'];
        assert.strictEqual(
          before.data.attributes.status,
          'open',
          'the read answers with the state the batch started from',
        );
        assert.strictEqual(write.data.id, `${testRealmHref}report-mixed`);
        assert.strictEqual(
          file.data.type,
          'file-meta',
          'a file read sits alongside card writes',
        );
        assert.strictEqual(
          storedCard('report-mixed.json').data.attributes?.status,
          'escalated',
          'the write in the same batch landed',
        );
      });

      test('an answer is never cached', async function (assert) {
        let written = await post(
          envelope(invoke('escalate', { href: '/report-uncached' })),
        );
        assert.strictEqual(written.status, 200, 'HTTP 200 status');
        assert.strictEqual(written.get('Cache-Control'), 'no-store');
        assert.strictEqual(written.get('ETag'), undefined);
        assert.strictEqual(written.get('Content-Type'), OPERATIONS);

        let read = await query(
          envelope(invoke('read', { href: '/report-uncached' })),
        );
        assert.strictEqual(read.status, 200, 'HTTP 200 status');
        assert.strictEqual(read.get('Cache-Control'), 'no-store');
        assert.strictEqual(read.get('ETag'), undefined);
      });
    });

    module('groups', function () {
      test('a parallel group commits its members together, under one job and one event', async function (assert) {
        let jobsBefore = await indexJobIds();
        let since = Date.now();

        // Tagged so the batch's own broadcast can be told from the ones this
        // realm makes for the rest of the file's tests: it is shared, and a
        // straggler from an earlier test can land inside the window.
        let response = await post(
          envelope(
            parallel(
              invoke('escalate', { href: '/report-parallel-1' }),
              invoke('escalate', { href: '/report-parallel-2' }),
              invoke('escalate', { href: '/report-parallel-3' }),
            ),
          ),
        ).set('X-Boxel-Client-Request-Id', 'parallel-group');

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        for (let card of [
          'report-parallel-1',
          'report-parallel-2',
          'report-parallel-3',
        ]) {
          assert.strictEqual(
            storedCard(`${card}.json`).data.attributes?.status,
            'escalated',
            `${card} was written`,
          );
        }
        assert.strictEqual(
          (await indexJobIds()).length - jobsBefore.length,
          1,
          'the whole group indexed under one job',
        );
        // The realm broadcasts out of band from the commit, so the event is
        // waited for rather than read off the window the response returned in.
        await waitUntil(
          async () =>
            (await incrementalIndexEventsSince(since)).some(
              (event) => event.clientRequestId === 'parallel-group',
            ),
          {
            timeout: 30_000,
            timeoutMessage: "the group's index event never arrived",
          },
        );
        let announced = (await incrementalIndexEventsSince(since)).filter(
          (event) => event.clientRequestId === 'parallel-group',
        );
        assert.strictEqual(
          announced.length,
          1,
          `the group announced itself once (got ${announced.length})`,
        );
        // By containment: what a write invalidates is the card plus whatever
        // depends on it, so an exact list would pin the fixture's link graph
        // rather than the claim, which is that one event covers all three.
        for (let card of [
          'report-parallel-1',
          'report-parallel-2',
          'report-parallel-3',
        ]) {
          assert.true(
            (announced[0].invalidations ?? []).includes(
              `${testRealmHref}${card}`,
            ),
            `the one event names ${card}`,
          );
        }
      });

      test('a member whose precondition does not hold leaves the whole group unwritten', async function (assert) {
        let jobsBefore = await indexJobIds();

        let response = await post(
          envelope(
            parallel(
              invoke('escalate', { href: '/report-abandoned-1' }),
              invoke('openOnly', { href: '/report-closed' }),
              invoke('escalate', { href: '/report-abandoned-2' }),
            ),
          ),
        );

        assert.strictEqual(response.status, 400, 'HTTP 400 status');
        let [error] = response.body.errors;
        assert.strictEqual(error.code, 'assertion-failed');
        assert.strictEqual(
          error.meta.entry,
          '[0].boxel:operations[1]',
          'the member whose assertion did not hold',
        );
        for (let card of ['report-abandoned-1', 'report-abandoned-2']) {
          assert.strictEqual(
            storedCard(`${card}.json`).data.attributes?.status,
            'open',
            `${card} staged successfully and was still not written`,
          );
        }
        assert.strictEqual(
          storedCard('report-closed.json').data.attributes?.status,
          'closed',
        );
        // The job is the whole of what is checked here, and it is checked
        // rather than the broadcast because the broadcast cannot be: the realm
        // announces out of band, which is why the positive case above waits up
        // to 30s for its own event. Read with no wait, an empty window says
        // only that nothing has arrived yet — it would be empty for a batch
        // that did commit — so asserting it would be asserting nothing. No job
        // is the same claim made in a form that can fail: the announcement
        // follows the job, and this batch enqueued none.
        assert.deepEqual(
          await indexJobIds(),
          jobsBefore,
          'no index job was enqueued, so there is nothing to announce',
        );
      });

      test('two members of one parallel group changing a card are refused, naming both', async function (assert) {
        let response = await post(
          envelope(
            parallel(
              invoke('escalate', { href: '/report-conflict' }),
              invoke('addComment', {
                href: '/report-conflict',
                data: { body: 'at the same time' },
              }),
            ),
          ),
        );

        assert.strictEqual(response.status, 400, 'HTTP 400 status');
        let [error] = response.body.errors;
        assert.strictEqual(error.code, 'conflicting-targets');
        assert.strictEqual(error.meta.entry, '[0].boxel:operations[1]');
        assert.strictEqual(error.meta.conflictsWith, '[0].boxel:operations[0]');
        for (let path of [
          '[0].boxel:operations[0]',
          '[0].boxel:operations[1]',
        ]) {
          assert.true(
            error.detail.includes(path),
            `the prose names ${path}: ${error.detail}`,
          );
        }
        assert.strictEqual(
          storedCard('report-conflict.json').data.attributes?.status,
          'open',
          'and neither of them was written',
        );
      });

      test('the same two entries in serial order compose instead', async function (assert) {
        let response = await post(
          envelope(
            serial(
              invoke('escalate', { href: '/report-conflict' }),
              invoke('addComment', {
                href: '/report-conflict',
                data: { body: 'after it' },
              }),
            ),
          ),
        );

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        let stored = storedCard('report-conflict.json');
        assert.strictEqual(
          stored.data.attributes?.status,
          'escalated',
          'the first entry landed',
        );
        assert.deepEqual(
          stored.data.attributes?.comments,
          [{ body: 'after it', postedBy: TESTER }],
          'and the second composed over it rather than replacing it',
        );
      });

      test('groups nest, and the results mirror the shape of the request', async function (assert) {
        let response = await post(
          envelope(
            invoke('read', { href: '/report-shape' }),
            parallel(
              serial(
                invoke('create', { data: person('writer', 'Mango') }),
                invoke('create', {
                  data: person('note', 'Van Gogh', 'writer'),
                }),
              ),
              invoke('appendLine', {
                href: '/group.log',
                data: { line: 'elsewhere' },
              }),
            ),
          ),
        );

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        let [read, group] = response.body['atomic:results'];
        assert.strictEqual(
          read.data.attributes.status,
          'open',
          'the read answers with the pre-batch document, where the entry sat',
        );
        assert.strictEqual(
          group.length,
          2,
          "a group's position holds its members' results",
        );
        let [branch, appended] = group;
        assert.deepEqual(
          branch.map((result: { data: { lid: string } }) => result.data.lid),
          ['writer', 'note'],
          'the serial branch answers in request order, nested one deeper',
        );
        assert.strictEqual(
          appended.data.id,
          `${testRealmHref}group.log`,
          'and the other branch answers beside it',
        );
        assert.strictEqual(
          readFileSync(realmFile('group.log'), 'utf8'),
          'boot\nelsewhere\n',
          'the append landed',
        );
        let note = JSON.parse(
          readFileSync(
            realmFile(`${branch[1].data.id.slice(testRealmHref.length)}.json`),
            'utf8',
          ),
        );
        assert.strictEqual(
          new URL(note.data.relationships.friend.links.self, branch[1].data.id)
            .href,
          branch[0].data.id,
          'and the second create links to the card the first one minted',
        );
      });

      test('a parallel member links to a card an earlier serial step creates', async function (assert) {
        // Every local id in the tree is resolved once, before any of it
        // stages, so which entry mints a card and which link to it is not a
        // question about the schedule.
        let response = await post(
          envelope(
            invoke('create', { data: person('tree-author', 'Author') }),
            parallel(
              invoke('create', {
                data: person('tree-fan-1', 'Fan One', 'tree-author'),
              }),
              invoke('create', {
                data: person('tree-fan-2', 'Fan Two', 'tree-author'),
              }),
            ),
          ),
        );

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        let [author, fans] = response.body['atomic:results'];
        for (let fan of fans) {
          let stored = JSON.parse(
            readFileSync(
              realmFile(`${fan.data.id.slice(testRealmHref.length)}.json`),
              'utf8',
            ),
          );
          assert.strictEqual(
            new URL(stored.data.relationships.friend.links.self, fan.data.id)
              .href,
            author.data.id,
            `${fan.data.lid} links to the card the serial step minted`,
          );
        }
      });

      test('groups three deep commit together', async function (assert) {
        let jobsBefore = await indexJobIds();

        let response = await post(
          envelope(
            parallel(
              serial(
                parallel(
                  invoke('escalate', { href: '/report-nested-1' }),
                  invoke('escalate', { href: '/report-nested-2' }),
                ),
                invoke('addComment', {
                  href: '/report-nested-1',
                  data: { body: 'after the inner group' },
                }),
              ),
              invoke('escalate', { href: '/report-nested-3' }),
            ),
          ),
        );

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        for (let card of [
          'report-nested-1',
          'report-nested-2',
          'report-nested-3',
        ]) {
          assert.strictEqual(
            storedCard(`${card}.json`).data.attributes?.status,
            'escalated',
            `${card} was written`,
          );
        }
        assert.deepEqual(
          storedCard('report-nested-1.json').data.attributes?.comments,
          [{ body: 'after the inner group', postedBy: TESTER }],
          'the entry after the innermost group composed over what it staged',
        );
        assert.strictEqual(
          (await indexJobIds()).length - jobsBefore.length,
          1,
          'and the whole tree indexed under one job',
        );
      });
    });

    module('identity', function () {
      test('an operation that reads the actor refuses a request that authenticated nobody', async function (assert) {
        let response = await anonymousPost(
          envelope(
            invoke('addComment', {
              href: '/report-anonymous',
              data: { body: 'Who said this?' },
            }),
          ),
        );

        assert.strictEqual(response.status, 401, 'HTTP 401 status');
        let [error] = response.body.errors;
        assert.strictEqual(error.code, 'actor-required');
        assert.strictEqual(error.meta.entry, 0);
        assert.deepEqual(
          storedCard('report-anonymous.json').data.attributes?.comments,
          [],
          'nothing was written for a caller with no identity',
        );
      });

      test('an operation that reads no actor is carried out for an anonymous caller', async function (assert) {
        let response = await anonymousPost(
          envelope(invoke('escalate', { href: '/report-anonymous' })),
        );

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.strictEqual(
          storedCard('report-anonymous.json').data.attributes?.status,
          'escalated',
          'a realm anyone may write carries out a batch that needs no identity',
        );
      });

      test('the actor an operation reads is the user the realm authenticated', async function (assert) {
        let response = await post(
          envelope(
            invoke('addComment', {
              href: '/report-identified',
              data: { body: 'Reviewed.' },
            }),
          ),
        );

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.deepEqual(
          storedCard('report-identified.json').data.attributes?.comments,
          [{ body: 'Reviewed.', postedBy: TESTER }],
          'the comment records the caller the realm verified, and no other ' +
            'identity is invented for it',
        );
      });
    });
  });

  module('a realm anyone may only read', function (hooks) {
    let realm: Realm;
    let request: RealmRequest;

    setupPermissionedRealmCached(hooks, {
      mode: 'before',
      realmURL: readOnlyRealm,
      permissions: {
        reader: ['read'],
        '@node-test_realm:localhost': ['read', 'realm-owner'],
      },
      fileSystem: {
        'person.gts': `
        import { contains, field, CardDef, Component } from "@cardstack/base/card-api";
        import StringField from "@cardstack/base/string";

        export class Person extends CardDef {
          @field firstName = contains(StringField);
          static isolated = class Isolated extends Component<typeof this> {
            <template><h1><@fields.firstName /></h1></template>
          }
          static embedded = class Embedded extends Component<typeof this> {
            <template><h1><@fields.firstName /></h1></template>
          }
          static fitted = class Fitted extends Component<typeof this> {
            <template><h1><@fields.firstName /></h1></template>
          }
        }
      `,
        'person-1.json': {
          data: {
            type: 'card',
            attributes: { firstName: 'Mango' },
            meta: {
              adoptsFrom: {
                module: rri(`${readOnlyRealm.href}person`),
                name: 'Person',
              },
            },
          },
        },
      },
      onRealmSetup(args) {
        realm = args.testRealm;
        request = withRealmPath(args.request, readOnlyRealm);
      },
    });

    // The permission is derived from the method before a body is read, so these
    // two send the same batch and differ only in how it is sent.
    let batch = () =>
      JSON.stringify({
        'boxel:operations': [
          { op: 'invoke', 'boxel:name': 'read', href: '/person-1' },
        ],
      });

    test('a POST needs realm write', async function (assert) {
      let response = await request
        .post('/_operations')
        .set('Accept', OPERATIONS)
        .set('Content-Type', OPERATIONS)
        .set('Authorization', `Bearer ${createJWT(realm, 'reader', ['read'])}`)
        .send(batch());

      assert.strictEqual(response.status, 403, 'HTTP 403 status');
    });

    test('a QUERY needs only realm read', async function (assert) {
      let response = await request
        .post('/_operations')
        .set('Accept', OPERATIONS)
        .set('Content-Type', OPERATIONS)
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Authorization', `Bearer ${createJWT(realm, 'reader', ['read'])}`)
        .send(batch());

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      assert.strictEqual(
        response.body['atomic:results'][0].data.attributes.firstName,
        'Mango',
        'the read a reader is authorized for is carried out',
      );
    });
  });
});
