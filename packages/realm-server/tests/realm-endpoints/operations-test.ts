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
  realmConfigCardJSON,
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
  rest: {
    href?: string;
    data?: unknown;
    'boxel:target'?: Record<string, unknown>;
  } = {},
): Record<string, unknown> {
  return { op: 'invoke', 'boxel:name': name, ...rest };
}

// A query target naming the reports whose headline is `headline`. Every report
// this file finds by query carries a headline of its own, so a filter selects
// the fixtures one test wrote and none of the ones another did.
function findReports(
  headline: string,
  rest: { field?: string; expect?: 'one' | 'many' } = {},
): Record<string, unknown> {
  return {
    query: {
      'item.on': { module: `${testRealmHref}report`, name: 'ExternalReport' },
      eq: { 'item.headline': headline },
    },
    ...rest,
  };
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
          input: bxl\`. + {headline: (.headline // "Restated by default")}\`,
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

        @operation static headlineOnly = {
          base: 'read',
          output: bxl\`{data: {type: "card", id: .data.id, attributes: {headline: .data.attributes.headline, readBy: actor()}}}\`,
        };

        @operation static retire = {
          base: 'delete',
          params: { confirm: StringField },
          input: bxl\`.\`,
        };

        @operation static settled = {
          base: 'transform',
          set: { status: 'escalated' },
          output: bxl\`{data: {escalatedIn: realmConfig("timezone")}}\`,
        };

        @operation static broken = {
          base: 'transform',
          set: { status: 'escalated' },
          output: bxl\`{data: {status: instance("status")}}\`,
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
    // A type whose *default* `read` is specialized, which is what makes the
    // plain card+json `GET` of its cards a projected one.
    'projected.gts': `
      import { contains, field, CardDef, Component } from "@cardstack/base/card-api";
      import StringField from "@cardstack/base/string";
      import { operation, bxl } from "@cardstack/base/operations";

      export class ProjectedReport extends CardDef {
        @field headline = contains(StringField);
        @field salary = contains(StringField);

        @operation static read = {
          base: 'read',
          output: bxl\`{data: {type: "card", id: .data.id, attributes: {headline: .data.attributes.headline}, meta: .data.meta}}\`,
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
    // The realm's own config document, carrying the settings a transform reads
    // with `realmConfig(…)`.
    'realm.json': realmConfigCardJSON({
      name: 'Card Operations Envelope Test Realm',
      config: { timezone: 'UTC' },
    }),
    'staged.gts': `
      import { contains, field, CardDef, Component } from "@cardstack/base/card-api";
      import StringField from "@cardstack/base/string";
      import { operation, bxl } from "@cardstack/base/operations";

      export class StagedReadReport extends CardDef {
        @field headline = contains(StringField);

        @operation static read = {
          base: 'read',
          input: bxl\`.\`,
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
    'staged-report.json': {
      data: {
        type: 'card',
        attributes: { headline: 'Quarterly Review' },
        meta: {
          adoptsFrom: {
            module: rri(`${testRealmHref}staged`),
            name: 'StagedReadReport',
          },
        },
      },
    },
    'projected-report.json': {
      data: {
        type: 'card',
        attributes: { headline: 'Quarterly Review', salary: '120000' },
        meta: {
          adoptsFrom: {
            module: rri(`${testRealmHref}projected`),
            name: 'ProjectedReport',
          },
        },
      },
    },
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
        'report-restated',
        'report-restated-explicit',
        'report-projected',
        'report-broken-output',
        'report-retired',
        'report-settled',
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
        // One per base-version test, for the same reason.
        'report-base-fresh',
        'report-base-stale',
        'report-base-absent',
        'report-base-refused',
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
    // The cards a query target finds. Each carries a headline of its own, so a
    // filter picks out exactly the fixtures one test is about — the shared
    // `Quarterly Review` reports above would otherwise all answer to it.
    ...Object.fromEntries(
      [
        ['find-one', 'Find One'],
        ['find-two-a', 'Find Two'],
        ['find-two-b', 'Find Two'],
        ['find-many-a', 'Find Many'],
        ['find-many-b', 'Find Many'],
        ['find-conflict', 'Find Conflict'],
        ['find-expanded-a', 'Find Expanded'],
        ['find-closed', 'Find Closed'],
      ].map(([name, headline]) => [
        `${name}.json`,
        {
          data: {
            type: 'card',
            attributes: {
              headline,
              status: name === 'find-closed' ? 'closed' : 'open',
              comments: [],
            },
            relationships: { owner: { links: { self: './reviewer' } } },
            meta: { adoptsFrom: EXTERNAL_REPORT },
          },
        },
      ]),
    ),
    // The second member of the `Find Expanded` pair, whose own operation
    // refuses — so a refusal from inside an expansion has a position to name.
    'find-expanded-b.json': {
      data: {
        type: 'card',
        attributes: {
          headline: 'Find Expanded',
          status: 'closed',
          comments: [],
        },
        relationships: { owner: { links: { self: './reviewer' } } },
        meta: { adoptsFrom: EXTERNAL_REPORT },
      },
    },
    // A report whose owner is its own, so following the link and writing what
    // it points at is observable without disturbing the shared reviewer.
    'find-hop.json': {
      data: {
        type: 'card',
        attributes: { headline: 'Find Hop', status: 'open', comments: [] },
        relationships: { owner: { links: { self: './find-hop-owner' } } },
        meta: { adoptsFrom: EXTERNAL_REPORT },
      },
    },
    'find-hop-owner.json': {
      data: {
        type: 'card',
        attributes: { firstName: 'Owner' },
        meta: { adoptsFrom: PERSON },
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

    module('query-defined targets', function () {
      test('the one card a query matches is the card the entry runs against', async function (assert) {
        let response = await post(
          envelope(
            invoke('escalate', { 'boxel:target': findReports('Find One') }),
          ),
        );

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.strictEqual(
          storedCard('find-one.json').data.attributes?.status,
          'escalated',
          'the found card was written',
        );
        // The result is the one a named target produces, and its id is the
        // card the query found — which is how a caller that did not know the
        // URL learns it.
        let [result] = response.body['atomic:results'];
        assert.strictEqual(result.data.id, `${testRealmHref}find-one`);
        assert.strictEqual(result.data.type, 'card');
      });

      test('a query matching nothing is refused, naming the entry', async function (assert) {
        let response = await post(
          envelope(
            invoke('escalate', { href: '/report-kept' }),
            invoke('escalate', { 'boxel:target': findReports('Find Nobody') }),
          ),
        );

        assert.strictEqual(response.status, 400, 'HTTP 400 status');
        let [error] = response.body.errors;
        assert.strictEqual(error.code, 'invalid-params');
        assert.strictEqual(error.meta.entry, 1);
        assert.true(
          error.detail.includes('matched no card'),
          `detail names the count: ${error.detail}`,
        );
        assert.strictEqual(
          storedCard('report-kept.json').data.attributes?.status,
          'open',
          'and the entry that would have succeeded wrote nothing',
        );
      });

      test('a query matching several is refused, naming how many', async function (assert) {
        let response = await post(
          envelope(
            invoke('escalate', { 'boxel:target': findReports('Find Two') }),
          ),
        );

        assert.strictEqual(response.status, 400, 'HTTP 400 status');
        let [error] = response.body.errors;
        assert.true(
          error.detail.includes('2 cards answer to it'),
          `detail names the count: ${error.detail}`,
        );
        for (let card of ['find-two-a', 'find-two-b']) {
          assert.strictEqual(
            storedCard(`${card}.json`).data.attributes?.status,
            'open',
            `${card} was not written`,
          );
        }
      });

      test('an entry expecting many runs against every match and answers with an array', async function (assert) {
        let jobsBefore = await indexJobIds();

        let response = await post(
          envelope(
            invoke('escalate', {
              'boxel:target': findReports('Find Many', { expect: 'many' }),
            }),
          ),
        );

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        for (let card of ['find-many-a', 'find-many-b']) {
          assert.strictEqual(
            storedCard(`${card}.json`).data.attributes?.status,
            'escalated',
            `${card} was written`,
          );
        }
        // The entry's slot holds an array of the results its targets produced,
        // in the order the index returned them — the shape a group's position
        // already has, because the expansion is one.
        let [results] = response.body['atomic:results'];
        assert.deepEqual(
          results.map((result: { data: { id: string } }) => result.data.id),
          [`${testRealmHref}find-many-a`, `${testRealmHref}find-many-b`],
        );
        // Lean results: an identity and its version, never the document that
        // was written.
        assert.deepEqual(Object.keys(results[0].data).sort(), [
          'id',
          'meta',
          'type',
        ]);
        // And the expansion is still one batch — the found targets commit
        // together, under one job, the way the caller's own entries do.
        assert.strictEqual(
          (await indexJobIds()).length - jobsBefore.length,
          1,
          'the whole expansion indexed under one job',
        );
      });

      test('an entry expecting many and matching nothing answers with an empty array', async function (assert) {
        let jobsBefore = await indexJobIds();

        let response = await post(
          envelope(
            invoke('escalate', {
              'boxel:target': findReports('Find Nobody', { expect: 'many' }),
            }),
          ),
        );

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.deepEqual(response.body['atomic:results'], [[]]);
        // Nothing matched, so nothing staged: the batch takes no lock and has
        // nothing to announce.
        assert.strictEqual(
          (await indexJobIds()).length,
          jobsBefore.length,
          'no index job was enqueued',
        );
      });

      test('a refusal from inside an expansion names which of the found targets produced it', async function (assert) {
        // The second `Find Expanded` report is closed, and the operation
        // asserts that a report is open — so the expansion's second target is
        // the one that refuses, and the position it is named by is the path to
        // it through the entry that found it.
        let response = await post(
          envelope(
            invoke('escalate', { href: '/report-kept' }),
            invoke('openOnly', {
              'boxel:target': findReports('Find Expanded', { expect: 'many' }),
            }),
          ),
        );

        assert.strictEqual(response.status, 400, 'HTTP 400 status');
        let [error] = response.body.errors;
        assert.strictEqual(error.code, 'assertion-failed');
        assert.strictEqual(error.meta.entry, '[1].boxel:target[1]');
        assert.strictEqual(
          storedCard('find-expanded-a.json').data.attributes?.status,
          'open',
          'and the target before it in the same expansion wrote nothing',
        );
      });

      test('a field on the matched card makes the card it links to the target', async function (assert) {
        let response = await post(
          envelope(
            invoke('update', {
              'boxel:target': findReports('Find Hop', { field: 'owner' }),
              data: {
                type: 'card',
                attributes: { firstName: 'Reassigned' },
                meta: { adoptsFrom: PERSON },
              },
            }),
          ),
        );

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.strictEqual(
          storedCard('find-hop-owner.json').data.attributes?.firstName,
          'Reassigned',
          'the linked card was written',
        );
        assert.strictEqual(
          storedCard('find-hop.json').data.attributes?.headline,
          'Find Hop',
          'and the card the query matched was not',
        );
        let [result] = response.body['atomic:results'];
        assert.strictEqual(result.data.id, `${testRealmHref}find-hop-owner`);
      });

      test('a field that is not a link is refused, naming what it is', async function (assert) {
        let response = await post(
          envelope(
            invoke('escalate', {
              'boxel:target': findReports('Find One', { field: 'status' }),
            }),
          ),
        );

        assert.strictEqual(response.status, 400, 'HTTP 400 status');
        let [error] = response.body.errors;
        assert.strictEqual(error.code, 'invalid-params');
        assert.true(
          error.detail.includes('is a contains field'),
          `detail names the field's type: ${error.detail}`,
        );
      });

      test('a card this batch creates is not one its own query can match', async function (assert) {
        let jobsBefore = await indexJobIds();

        let response = await post(
          envelope(
            invoke('create', {
              data: {
                type: 'card',
                attributes: {
                  headline: 'Find Created',
                  status: 'open',
                  comments: [],
                },
                meta: { adoptsFrom: EXTERNAL_REPORT },
              },
            }),
            invoke('escalate', { 'boxel:target': findReports('Find Created') }),
          ),
        );

        assert.strictEqual(response.status, 400, 'HTTP 400 status');
        let [error] = response.body.errors;
        assert.strictEqual(error.meta.entry, 1);
        assert.true(
          error.detail.includes(
            'a card another entry of this batch creates is not one it can match',
          ),
          `detail says why: ${error.detail}`,
        );
        assert.strictEqual(
          (await indexJobIds()).length,
          jobsBefore.length,
          'and the create the batch was refused over was not carried out',
        );
      });

      test('a create cannot take its target from a query', async function (assert) {
        let response = await post(
          envelope(
            invoke('create', { 'boxel:target': findReports('Find One') }),
          ),
        );

        assert.strictEqual(response.status, 400, 'HTTP 400 status');
        let [error] = response.body.errors;
        assert.strictEqual(error.code, 'invalid-params');
        assert.true(
          error.detail.includes('takes its target from a query'),
          `detail says why: ${error.detail}`,
        );
      });

      test('a found target collides with a parallel sibling that named the same card', async function (assert) {
        // The conflict rule reads the files each member staged a change to, so
        // it does not matter that one member named its target and the other
        // described it — which is the property the whole resolution rests on.
        let response = await post(
          envelope(
            parallel(
              invoke('escalate', { href: '/find-conflict' }),
              invoke('addComment', {
                'boxel:target': findReports('Find Conflict'),
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
        assert.strictEqual(
          storedCard('find-conflict.json').data.attributes?.status,
          'open',
          'and neither of them was written',
        );
      });

      test('a read may describe its target too, and a read-only batch carries one', async function (assert) {
        let response = await query(
          envelope(invoke('read', { 'boxel:target': findReports('Find Two') })),
        );

        // Two cards answer to it, and a read is held to the same count rule as
        // a write: what the entry answers with is one document, so which of
        // the two it would be is not a question the realm picks for the caller.
        assert.strictEqual(response.status, 400, 'HTTP 400 status');
        assert.true(
          response.body.errors[0].detail.includes('2 cards answer to it'),
          response.body.errors[0].detail,
        );

        let found = await query(
          envelope(
            invoke('read', { 'boxel:target': findReports('Find Closed') }),
          ),
        );
        assert.strictEqual(found.status, 200, 'HTTP 200 status');
        let [result] = found.body['atomic:results'];
        assert.strictEqual(result.data.id, `${testRealmHref}find-closed`);
        assert.strictEqual(result.data.attributes.status, 'closed');
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

    // A caller that holds a card names the version it computed its write on top
    // of, and the result says whether the realm executed from the same one.
    //
    // The comparison is the coordinator's and is made inside the write lock
    // against the bytes it read there; what these are about is the wire — the
    // spelling a caller sends a base version with, and that nothing reaches the
    // stored file on the way through. A mismatch is reported and not refused:
    // refusing a write on a stale base is what `If-Match` is for, on the card
    // verbs, and a batch entry saying so would make the two mean the same
    // thing.
    module('base versions', function () {
      // The version a write reports is the token the next write names as its
      // base, so this reads one out of a result and sends it straight back.
      test('an entry naming the version the card holds reports the base matched', async function (assert) {
        let first = await post(
          envelope(
            invoke('addComment', {
              href: '/report-base-fresh',
              data: { body: 'First.' },
            }),
          ),
        );
        assert.strictEqual(first.status, 200, 'HTTP 200 status');
        let version = first.body['atomic:results'][0].data.meta.version;
        assert.strictEqual(
          typeof version,
          'string',
          'the first write reported a version to name as a base',
        );

        let second = await post(
          envelope(
            invoke('addComment', {
              href: '/report-base-fresh',
              data: { body: 'Second.', meta: { baseVersion: version } },
            }),
          ),
        );

        assert.strictEqual(second.status, 200, 'HTTP 200 status');
        let [result] = second.body['atomic:results'];
        assert.true(
          result.data.meta.baseMatched,
          'the realm executed from the version the caller named',
        );
        assert.deepEqual(
          storedCard('report-base-fresh.json').data.attributes?.comments,
          [
            { body: 'First.', postedBy: TESTER },
            { body: 'Second.', postedBy: TESTER },
          ],
          'both writes landed',
        );
      });

      test('an entry naming a version the card has moved past applies anyway and reports the mismatch', async function (assert) {
        let response = await post(
          envelope(
            invoke('addComment', {
              href: '/report-base-stale',
              data: {
                body: 'Sent against a base that moved.',
                meta: { baseVersion: 'a-version-this-card-never-held' },
              },
            }),
          ),
        );

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        let [result] = response.body['atomic:results'];
        assert.false(
          result.data.meta.baseMatched,
          'the realm reports that it executed from a different base',
        );
        assert.deepEqual(
          storedCard('report-base-stale.json').data.attributes?.comments,
          [{ body: 'Sent against a base that moved.', postedBy: TESTER }],
          'the write still applied — a moved base is reported, not refused',
        );
      });

      // Absent rather than `false`. A caller that named no base asked nothing,
      // and answering `false` would tell it its base did not match — a claim
      // about a base it never stated.
      test('an entry naming no base version has no baseMatched key', async function (assert) {
        let response = await post(
          envelope(
            invoke('addComment', {
              href: '/report-base-absent',
              data: { body: 'No base named.' },
            }),
          ),
        );

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        let [result] = response.body['atomic:results'];
        // The positive control, for the reason absence assertions need one: a
        // result carrying no meta at all would satisfy the check below just as
        // well as one deliberately withholding the key. A write always reports
        // a version, so finding one establishes that this meta is populated and
        // the absence is about `baseMatched`.
        assert.strictEqual(
          typeof result.data.meta.version,
          'string',
          'the result carries a populated write meta',
        );
        assert.false(
          'baseMatched' in result.data.meta,
          `the result reports nothing about a base: ${JSON.stringify(
            result.data.meta,
          )}`,
        );
      });

      // The base version is the envelope's to read, so it must not reach the
      // patch the entry stages. `meta` legitimately carries `adoptsFrom` and
      // `fields`, so it cannot be dropped wholesale — the member is lifted out
      // of it, and this is what says so.
      test('a base version is not written into the card it names', async function (assert) {
        let response = await post(
          envelope(
            invoke('update', {
              href: '/report-base-refused',
              data: {
                type: 'card',
                attributes: { status: 'escalated' },
                meta: {
                  adoptsFrom: EXTERNAL_REPORT,
                  baseVersion: 'a-version-this-card-never-held',
                },
              },
            }),
          ),
        );

        assert.strictEqual(
          response.status,
          200,
          `HTTP 200 status: ${response.text}`,
        );
        let stored = storedCard('report-base-refused.json');
        assert.strictEqual(
          stored.data.attributes?.status,
          'escalated',
          'the patch landed',
        );
        assert.false(
          'baseVersion' in (stored.data.meta as unknown as object),
          `the stored card carries no base version: ${JSON.stringify(
            stored.data.meta,
          )}`,
        );
      });

      test('a base version that is not a non-empty string is refused, naming the entry', async function (assert) {
        for (let [label, baseVersion] of [
          ['a number', 7],
          ['an empty string', ''],
        ] as const) {
          let response = await post(
            envelope(
              invoke('addComment', {
                href: '/report-base-absent',
                data: { body: 'Refused.', meta: { baseVersion } },
              }),
            ),
          );

          assert.strictEqual(response.status, 400, `HTTP 400 status: ${label}`);
          let [error] = response.body.errors;
          assert.strictEqual(
            error.meta.entry,
            0,
            `the entry is named: ${label}`,
          );
          assert.true(
            error.detail.includes('baseVersion'),
            `the refusal names the member: ${error.detail}`,
          );
        }
      });

      // A create has no prior state for a base version to describe and a delete
      // has none left to report a match on, so naming one is a caller that
      // believes it is writing conditionally when nothing is comparing
      // anything. Refused rather than ignored, for that reason.
      // A read never reaches the coordinator — it is answered before the batch
      // is staged — so the refusal for an entry that cannot use a base version
      // has to be made where every entry's definition is known. Without it a
      // well-formed base version on a read is silently dropped, which is the
      // same answer as a realm that does not report on bases at all, while a
      // malformed one on the same read is a refusal.
      test('a base version on an entry that writes nothing is refused, naming the entry', async function (assert) {
        let response = await post(
          envelope(
            invoke('read', {
              href: '/report-base-absent',
              data: { meta: { baseVersion: 'a-version-a-read-cannot-use' } },
            }),
          ),
        );

        assert.strictEqual(response.status, 400, 'HTTP 400 status');
        let [error] = response.body.errors;
        assert.strictEqual(error.meta.entry, 0, 'the entry is named');
        assert.true(
          error.detail.includes('base version'),
          `the refusal says a read has no base version: ${error.detail}`,
        );
        assert.strictEqual(
          response.body['atomic:results'],
          undefined,
          'the batch answered nothing',
        );
      });

      test('a base version on a create is refused, naming the entry', async function (assert) {
        let response = await post(
          envelope(
            invoke('create', {
              data: {
                type: 'card',
                attributes: { firstName: 'Mango' },
                meta: {
                  adoptsFrom: PERSON,
                  baseVersion: 'a-version-no-new-card-has',
                },
              },
            }),
          ),
        );

        assert.strictEqual(response.status, 400, 'HTTP 400 status');
        let [error] = response.body.errors;
        assert.strictEqual(error.meta.entry, 0, 'the entry is named');
        assert.true(
          error.detail.includes('base version'),
          `the refusal says a create has no base version: ${error.detail}`,
        );
      });
    });

    // The two stages around an operation, end to end: what a declaration's
    // `input` and `output` do to a real batch, and what a projected default
    // `read` does to the card+json `GET` of the cards that carry it. The
    // stages' own semantics are `card-operations-transforms-test.ts`; these
    // are about a declaration reaching them through a lowered definition and a
    // served response.
    module('transforms', function () {
      test('an input fills a value the params check would have refused', async function (assert) {
        // No headline is sent, so the value the write stores is one only the
        // program could have produced — and without the stage the entry does
        // not reach the write at all, since `headline` is a declared param.
        let response = await post(
          envelope(invoke('restate', { href: '/report-restated' })),
        );

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.strictEqual(
          storedCard('report-restated.json').data.attributes?.headline,
          'Restated by default',
          'the write ran on the payload the input produced',
        );
      });

      test("a caller's own value still wins over the input's default", async function (assert) {
        let response = await post(
          envelope(
            invoke('restate', {
              href: '/report-restated-explicit',
              data: { headline: 'Revised' },
            }),
          ),
        );

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.strictEqual(
          storedCard('report-restated-explicit.json').data.attributes?.headline,
          'Revised',
        );
      });

      test("a write's output projects the result, and reads the realm's settings", async function (assert) {
        // The same stage on the other transport: a read's `output` reaches the
        // realm's settings through the operation core, and a write's reaches
        // them through the batch handler, so one declaration cannot answer on
        // one transport and refuse on the other.
        let response = await post(
          envelope(invoke('settled', { href: '/report-settled' })),
        );

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.deepEqual(
          response.body['atomic:results'][0],
          { data: { escalatedIn: 'UTC' } },
          'the projection is the whole of what the write answers with',
        );
        assert.strictEqual(
          storedCard('report-settled.json').data.attributes?.status,
          'escalated',
          'and the write it projected landed',
        );
      });

      test('an output projects a read, and the redacted field is gone', async function (assert) {
        let response = await query(
          envelope(invoke('headlineOnly', { href: '/report-projected' })),
        );

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        let [projected] = response.body['atomic:results'];
        assert.deepEqual(
          projected,
          {
            data: {
              type: 'card',
              id: `${testRealmHref}report-projected`,
              attributes: { headline: 'Quarterly Review', readBy: TESTER },
            },
          },
          'the projection is the whole answer: no status, no comments, no ' +
            'owner relationship, and the caller it was projected for',
        );
      });

      test('a failing output is a 400 over a write that has already landed', async function (assert) {
        let response = await post(
          envelope(invoke('broken', { href: '/report-broken-output' })),
        );

        assert.strictEqual(response.status, 400, 'HTTP 400 status');
        let [error] = response.body.errors;
        assert.strictEqual(error.code, 'invalid-params');
        assert.strictEqual(error.meta.stage, 'output');
        assert.strictEqual(error.meta.entry, 0);
        assert.strictEqual(
          storedCard('report-broken-output.json').data.attributes?.status,
          'escalated',
          'the stage projects the result of a commit, so the commit is ' +
            'behind it: a refusal here says the caller cannot be told what ' +
            'happened, not that nothing did',
        );
      });

      test('the card+json GET of a projected type is served the projection, uncacheable', async function (assert) {
        let response = await request
          .get('/projected-report')
          .set('Accept', SupportedMimeType.CardJson)
          .set(
            'Authorization',
            `Bearer ${createJWT(realm, TESTER, ['read', 'write'])}`,
          );

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.strictEqual(
          response.body.data.attributes.headline,
          'Quarterly Review',
        );
        assert.strictEqual(
          response.body.data.attributes.salary,
          undefined,
          'the field the projection leaves out is not served',
        );
        assert.strictEqual(
          response.get('Cache-Control'),
          'private, no-store',
          'a projected body is held by no cache, shared or otherwise',
        );
        assert.ok(
          response.get('ETag'),
          'and the validator is still emitted, for a conditional write',
        );
      });

      test('a matching If-None-Match does not 304 a projected read', async function (assert) {
        let path = '/projected-report';
        let authorization = `Bearer ${createJWT(realm, TESTER, ['read', 'write'])}`;
        let first = await request
          .get(path)
          .set('Accept', SupportedMimeType.CardJson)
          .set('Authorization', authorization);
        let etag = first.get('ETag');
        assert.ok(etag, 'the first read emitted a validator');

        let conditional = await request
          .get(path)
          .set('Accept', SupportedMimeType.CardJson)
          .set('Authorization', authorization)
          .set('If-None-Match', etag!);

        assert.strictEqual(
          conditional.status,
          200,
          'the validator describes the unprojected document, so it cannot ' +
            'answer for this body',
        );
        assert.strictEqual(
          conditional.body.data.attributes.headline,
          'Quarterly Review',
        );

        let head = await request
          .head(path)
          .set('Accept', SupportedMimeType.CardJson)
          .set('Authorization', authorization)
          .set('If-None-Match', etag!);
        assert.strictEqual(
          head.status,
          200,
          'a HEAD states the headers the GET would send, 304 included',
        );
        assert.strictEqual(head.get('Cache-Control'), 'private, no-store');
      });

      test('a declared write is held to its params before anything is staged', async function (assert) {
        // The behaviors read a payload differently enough that some would
        // never notice one was missing — a `delete` reads none at all — so the
        // check cannot be left to the executor that would carry the write out.
        let response = await post(
          envelope(invoke('retire', { href: '/report-retired' })),
        );

        assert.strictEqual(response.status, 400, 'HTTP 400 status');
        let [error] = response.body.errors;
        assert.strictEqual(error.code, 'invalid-params');
        assert.true(
          error.detail.includes('params("confirm")'),
          `the refusal names the value it wanted: ${error.detail}`,
        );
        assert.true(
          existsSync(realmFile('report-retired.json')),
          'and the card the caller said too little to remove is still there',
        );
      });

      test('a read carrying only an input still runs, so it is never answered 304', async function (assert) {
        // An `input` changes no byte of the document a read serves, but it can
        // refuse — so the conditional fast path, which answers without running
        // the read at all, is off for one.
        let path = '/staged-report';
        let authorization = `Bearer ${createJWT(realm, TESTER, ['read', 'write'])}`;
        let first = await request
          .get(path)
          .set('Accept', SupportedMimeType.CardJson)
          .set('Authorization', authorization);

        assert.strictEqual(first.status, 200, 'HTTP 200 status');
        assert.strictEqual(
          first.get('Cache-Control'),
          'public, max-age=0, must-revalidate',
          'nothing projected the body, so it is cacheable as any other is',
        );

        let conditional = await request
          .get(path)
          .set('Accept', SupportedMimeType.CardJson)
          .set('Authorization', authorization)
          .set('If-None-Match', first.get('ETag')!);
        assert.strictEqual(
          conditional.status,
          200,
          'the stage has to run, and a 304 would skip it',
        );
        assert.strictEqual(
          conditional.body.data.attributes.headline,
          'Quarterly Review',
        );
      });

      test('a card whose type declares no read is served exactly as before', async function (assert) {
        let path = '/report-projected';
        let authorization = `Bearer ${createJWT(realm, TESTER, ['read', 'write'])}`;
        let first = await request
          .get(path)
          .set('Accept', SupportedMimeType.CardJson)
          .set('Authorization', authorization);

        assert.strictEqual(first.status, 200, 'HTTP 200 status');
        assert.strictEqual(
          first.get('Cache-Control'),
          'public, max-age=0, must-revalidate',
          'the ordinary directive, on a realm anyone may read',
        );
        assert.strictEqual(
          first.body.data.attributes.status,
          'open',
          'every field is served: the named projection above is not this read',
        );

        let conditional = await request
          .get(path)
          .set('Accept', SupportedMimeType.CardJson)
          .set('Authorization', authorization)
          .set('If-None-Match', first.get('ETag')!);
        assert.strictEqual(
          conditional.status,
          304,
          'and its conditional fast path is untouched',
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
