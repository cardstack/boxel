import QUnit from 'qunit';
const { module, test } = QUnit;
import supertest from 'supertest';
import type { Test, SuperTest } from 'supertest';
import { basename, join } from 'path';
import { dirSync } from 'tmp';
import {
  DURING_PRERENDER_HEADER,
  rri,
  SupportedMimeType,
} from '@cardstack/runtime-common';
import type {
  QueuePublisher,
  QueueRunner,
  Realm,
} from '@cardstack/runtime-common';
import type { PgAdapter } from '@cardstack/postgres';
import { resetCatalogRealms } from '../handlers/handle-fetch-catalog-realms.ts';
import type { RealmHttpServer as Server } from '../server.ts';
import {
  closeServer,
  createJWT,
  createVirtualNetwork,
  matrixURL,
  realmConfigCardJSON,
  realmSecretSeed,
  runTestRealmServerWithRealms,
  setupDB,
} from './helpers/index.ts';
import { setupCatalogTestSubset } from './helpers/catalog-test-subset.ts';
import { settlePrerenderHtmlJobs } from './helpers/indexing.ts';
import { createJWT as createRealmServerJWT } from '../utils/jwt.ts';

// ============================================================================
// Which prerendered formats a read or a query serves, and who decides.
//
// A card's prerendered HTML is rendered once per format, under the realm's own
// authority, and shared by every viewer. A format whose template draws linked
// cards bakes their content into that one markup, so a caller admitted to the
// card receives the linked content whole. An operation may declare a format
// unshareable, and the format is then served data-only: no caller receives
// its markup, and nothing is rendered again or per caller.
//
// The topology is the query-reach suite's. The Education realm holds rosters
// and the students they link to; a roster's embedded format draws its roll,
// the names of its students. The teacher holds no permission on that realm and
// reaches the rosters only through query grants, and no rule grants a student,
// so the roll in a roster's embedded markup is exactly the linked content the
// declaration exists to keep out of their hands. A public realm beside it
// carries the host-mode page, which serves a card's markup to anyone.
// ============================================================================

const EDUCATION = 'http://127.0.0.1:4444/education/';
const ORG = 'http://127.0.0.1:4444/org/';
const NOTICES = 'http://127.0.0.1:4444/notices/';
const POLICY_CARD = `${ORG}policies/education`;
const ADMIN = '@education-admin:localhost';
const ORG_ADMIN = '@org-admin:localhost';
const TEACHER = '@teacher:localhost';

const REALM_POLICY = {
  module: rri('@cardstack/catalog/realm-policy/realm-policy'),
  name: 'RealmPolicy',
};

const ROSTER = { module: `${EDUCATION}roster`, name: 'Roster' };

const TEACHES = '.teacherIds | any(. == actor())';

const STUDENT_MODULE = `
  import { contains, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  export class Student extends CardDef {
    @field name = contains(StringField);
  }
`;

// Two queries over the same rows that differ only in what their `html`
// declares, so any difference between their answers is the declaration's.
//
// `GuardedRoster` withholds the same formats from reads rooted at its own
// cards. It turns up in both queries' results, which is what shows whose
// declaration a search row is served under.
const ROSTER_MODULE = `
  import { contains, containsMany, field, linksToMany, CardDef, Component } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  import { operation } from "@cardstack/base/operations";
  import { Student } from "./student";

  function allRosters() {
    return {
      filter: { type: () => Roster },
      sort: [{ on: () => Roster, by: 'title', direction: 'asc' }],
    };
  }

  export class Roster extends CardDef {
    @field title = contains(StringField);
    @field teacherIds = containsMany(StringField);
    @field students = linksToMany(() => Student);
    @field roll = contains(StringField, {
      computeVia: function (this: Roster) {
        return (this.students ?? [])
          .map((student) => student?.name)
          .filter(Boolean)
          .join(', ');
      },
    });

    static embedded = class Embedded extends Component<typeof this> {
      <template>
        <p class='roll'>Roll: <@fields.roll /></p>
      </template>
    };

    @operation static listShared = { base: 'query', query: allRosters() };
    @operation static listPrivate = {
      base: 'query',
      query: allRosters(),
      html: { embedded: 'unshareable', fitted: 'unshareable' },
    };
  }

  export class GuardedRoster extends Roster {
    @operation static read = {
      base: 'read',
      html: { embedded: 'unshareable', fitted: 'unshareable' },
    };
  }
`;

// A public realm's host-mode page injects a card's isolated and head markup.
// `SealedNotice` declares both unshareable on its `read`.
const NOTICE_MODULE = `
  import { contains, field, CardDef, Component } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  import { operation } from "@cardstack/base/operations";

  export class Notice extends CardDef {
    @field subject = contains(StringField);
    static isolated = class Isolated extends Component<typeof this> {
      <template>
        <p data-notice-body>Notice body: <@fields.subject /></p>
      </template>
    };
    static head = class Head extends Component<typeof this> {
      <template>
        <title>Notice head: {{@model.subject}}</title>
      </template>
    };
  }

  export class SealedNotice extends Notice {
    @operation static read = {
      base: 'read',
      html: { isolated: 'unshareable', head: 'unshareable' },
    };
  }
`;

type Grant = { operation: string; where?: unknown };
type Rule = { targetType: { module: string; name: string }; grants: Grant[] };

// Each query, and the ad-hoc search, granted to the rosters' own teachers.
// Nothing grants a student.
const RULES: Rule[] = [
  {
    targetType: ROSTER,
    grants: ['listShared', 'listPrivate', 'query'].map((operation) => ({
      operation,
      where: TEACHES,
    })),
  },
];

function policyCard(rules: Rule[]) {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes: { rules },
      meta: { adoptsFrom: REALM_POLICY },
    },
  });
}

function student(name: string) {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes: { name },
      meta: { adoptsFrom: { module: '../student', name: 'Student' } },
    },
  });
}

function roster(name: string, title: string, students: string[]) {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes: { title, teacherIds: [TEACHER] },
      relationships: Object.fromEntries(
        students.map((id, index) => [
          `students.${index}`,
          { links: { self: `../students/${id}` } },
        ]),
      ),
      meta: { adoptsFrom: { module: '../roster', name } },
    },
  });
}

function notice(name: string, subject: string) {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes: { subject },
      meta: { adoptsFrom: { module: '../notice', name } },
    },
  });
}

const ALGEBRA = `${EDUCATION}rosters/algebra`;
const BIOLOGY = `${EDUCATION}rosters/biology`;

type Query = 'listShared' | 'listPrivate';
type Format = 'embedded' | 'fitted' | 'isolated' | 'atom';

interface Resource {
  id?: string;
  type?: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, { data?: unknown } | undefined>;
  meta?: Record<string, unknown>;
}

interface EntryBody {
  data: Resource[];
  included?: Resource[];
}

module(basename(import.meta.filename), function (hooks) {
  let education: Realm;
  let org: Realm;
  let notices: Realm;
  let request: SuperTest<Test>;
  let server: Server;
  let db: PgAdapter;

  setupCatalogTestSubset(hooks);

  async function start({
    dbAdapter,
    publisher,
    runner,
  }: {
    dbAdapter: PgAdapter;
    publisher: QueuePublisher;
    runner: QueueRunner;
  }) {
    db = dbAdapter;
    let result = await runTestRealmServerWithRealms({
      virtualNetwork: createVirtualNetwork(),
      realmsRootPath: join(dirSync().name, 'realm_server_1'),
      realms: [
        {
          realmURL: new URL(EDUCATION),
          fileSystem: {
            'realm.json': realmConfigCardJSON({
              name: 'Education',
              policy: POLICY_CARD,
            }),
            'student.gts': STUDENT_MODULE,
            'roster.gts': ROSTER_MODULE,
            'students/ada.json': student('Ada'),
            'students/ben.json': student('Ben'),
            'students/cy.json': student('Cy'),
            'rosters/algebra.json': roster('Roster', 'Algebra', ['ada', 'ben']),
            'rosters/biology.json': roster('GuardedRoster', 'Biology', [
              'ben',
              'cy',
            ]),
          },
          permissions: {
            [ADMIN]: ['read', 'write', 'realm-owner'],
          },
        },
        {
          realmURL: new URL(ORG),
          fileSystem: {
            'realm.json': realmConfigCardJSON({ name: 'Org' }),
            'policies/education.json': policyCard(RULES),
          },
          permissions: {
            [ORG_ADMIN]: ['read', 'write', 'realm-owner'],
          },
        },
        {
          realmURL: new URL(NOTICES),
          fileSystem: {
            'realm.json': realmConfigCardJSON({ name: 'Notices' }),
            'notice.gts': NOTICE_MODULE,
            'notices/open.json': notice('Notice', 'Open house'),
            'notices/sealed.json': notice('SealedNotice', 'Sealed ballot'),
          },
          permissions: {
            '*': ['read'],
            [ADMIN]: ['read', 'write', 'realm-owner'],
          },
        },
      ],
      dbAdapter,
      publisher,
      runner,
      matrixURL,
    });
    server = result.testRealmHttpServer;
    request = supertest(server);
    education = result.realms.find((realm) => realm.url === EDUCATION)!;
    org = result.realms.find((realm) => realm.url === ORG)!;
    notices = result.realms.find((realm) => realm.url === NOTICES)!;
  }

  // One server for the whole module, since every test only reads. Booting it
  // indexes the realms, which runs inside the first test's budget, so that
  // budget is extended past the per-test timeout.
  hooks.before(function (assert) {
    assert.timeout(300_000);
  });

  setupDB(hooks, {
    before: async (dbAdapter, publisher, runner) => {
      await start({ dbAdapter, publisher, runner });
      // Every assertion here reads stored markup, which the prerender-html
      // pass writes after indexing, so each realm's pass is settled first.
      for (let realm of [EDUCATION, NOTICES]) {
        await settlePrerenderHtmlJobs(dbAdapter, realm, { timeout: 180_000 });
      }
    },
    after: async () => {
      for (let realm of [education, org, notices]) {
        realm?.unsubscribe();
      }
      if (server) {
        await closeServer(server);
      }
      resetCatalogRealms();
    },
  });

  // The admin holds realm read, so the realm's ACL admits them and no policy
  // is consulted. The teacher holds nothing, so every row they are served is
  // admitted by a grant or not at all.
  type Caller = 'admin' | 'teacher';
  const USERS: Record<Caller, string> = { admin: ADMIN, teacher: TEACHER };
  const PERMISSIONS: Record<Caller, ('read' | 'write' | 'realm-owner')[]> = {
    admin: ['read', 'write', 'realm-owner'],
    teacher: [],
  };

  function named(
    operation: Query,
    format: Format,
    fields?: string[],
  ): Record<string, unknown> {
    return {
      operation,
      on: ROSTER,
      realms: [EDUCATION],
      filter: { eq: { htmlQuery: { eq: { format } } } },
      ...(fields ? { fields: { entry: fields } } : {}),
    };
  }

  function realmSearch(caller: Caller, payload: object) {
    return request
      .post(`${new URL(EDUCATION).pathname}_search`)
      .set('Accept', SupportedMimeType.CardJson)
      .set('Content-Type', 'application/json')
      .set('X-HTTP-Method-Override', 'QUERY')
      .set(
        'Authorization',
        `Bearer ${createJWT(education, USERS[caller], PERMISSIONS[caller])}`,
      )
      .send(payload);
  }

  function federatedSearch(caller: Caller, payload: object) {
    return request
      .post('/_federated-search')
      .set('Accept', SupportedMimeType.CardJson)
      .set('Content-Type', 'application/json')
      .set('X-HTTP-Method-Override', 'QUERY')
      .set(
        'Authorization',
        `Bearer ${createRealmServerJWT(
          { user: USERS[caller], sessionRoom: `session-room-${caller}` },
          realmSecretSeed,
        )}`,
      )
      .send(payload);
  }

  const ENDPOINTS = [
    ['the realm’s own search', realmSearch],
    ['the federated search', federatedSearch],
  ] as const;

  async function search(
    caller: Caller,
    payload: object,
    send: typeof realmSearch = realmSearch,
  ): Promise<EntryBody> {
    let response = await send(caller, payload);
    if (response.status !== 200) {
      throw new Error(`search answered ${response.status}: ${response.text}`);
    }
    return response.body as EntryBody;
  }

  function cardHtml(url: string, format: Format) {
    return request
      .get(`${new URL(url).pathname}?format=${format}`)
      .set('Accept', SupportedMimeType.CardHtml)
      .set(
        'Authorization',
        `Bearer ${createJWT(education, ADMIN, PERMISSIONS.admin)}`,
      );
  }

  // The markup each row was served with, by row id, for the format asked for.
  function markup(doc: EntryBody): Map<string, string | undefined> {
    let byId = new Map(
      (doc.included ?? [])
        .filter((resource) => resource.type === 'html')
        .map((resource) => [resource.id!, resource]),
    );
    return new Map(
      doc.data.map((entry) => {
        let ids = (entry.relationships?.html?.data ?? []) as { id: string }[];
        let html = ids
          .map((ref) => byId.get(ref.id)?.attributes?.html)
          .find((value): value is string => typeof value === 'string');
        return [entry.id!, html];
      }),
    );
  }

  // Whether each row answered with its card's data in place of markup.
  function servedItem(doc: EntryBody): Map<string, boolean> {
    return new Map(
      doc.data.map((entry) => [
        entry.id!,
        (entry.relationships?.item?.data as { id?: string } | undefined)?.id ===
          entry.id,
      ]),
    );
  }

  function rowIds(doc: EntryBody): string[] {
    return doc.data.map((entry) => entry.id!);
  }

  test('the grants admit the teacher to every roster, under each declaration', async function (assert) {
    for (let operation of ['listShared', 'listPrivate'] as const) {
      assert.deepEqual(
        rowIds(await search('teacher', named(operation, 'embedded'))),
        [ALGEBRA, BIOLOGY],
        `${operation}: both rosters, in the declaration's order`,
      );
    }
  });

  module('a query', function () {
    test('a query declaring nothing serves each row’s markup whole, to a grant-reached caller too', async function (assert) {
      // Stated rather than implied: the roll in a roster's embedded markup
      // names students no rule grants the teacher, and a query that declares
      // nothing hands it over.
      let served = markup(
        await search('teacher', named('listShared', 'embedded')),
      );
      assert.true(
        (served.get(ALGEBRA) ?? '').includes('Ada, Ben'),
        'the teacher receives the roll baked into the embedded markup',
      );
      assert.true(
        (served.get(BIOLOGY) ?? '').includes('Ben, Cy'),
        'for every row',
      );
    });

    test('a query declaring a format unshareable serves every row data-only for it', async function (assert) {
      for (let format of ['embedded', 'fitted'] as const) {
        for (let caller of ['teacher', 'admin'] as const) {
          let doc = await search(caller, named('listPrivate', format));
          assert.deepEqual(
            rowIds(doc),
            [ALGEBRA, BIOLOGY],
            `${format}, ${caller}: the same rows come back`,
          );
          assert.deepEqual(
            [...markup(doc).values()],
            [undefined, undefined],
            `${format}, ${caller}: no row carries markup for it`,
          );
          assert.false(
            (doc.included ?? []).some((resource) => resource.type === 'html'),
            `${format}, ${caller}: no rendering rides the response at all`,
          );
          assert.deepEqual(
            [...servedItem(doc).values()],
            [true, true],
            `${format}, ${caller}: each row answers with its card instead`,
          );
          let algebra = (doc.included ?? []).find(
            (resource) => resource.type === 'card' && resource.id === ALGEBRA,
          );
          assert.strictEqual(
            algebra?.attributes?.title,
            'Algebra',
            `${format}, ${caller}: and the card carries its data`,
          );
        }
      }
    });

    test('a pinned html branch is empty for a format served data-only', async function (assert) {
      let doc = await search(
        'teacher',
        named('listPrivate', 'embedded', ['html']),
      );
      for (let entry of doc.data) {
        assert.deepEqual(
          entry.relationships?.html?.data,
          [],
          `${entry.id}: the branch is there and holds nothing`,
        );
      }
    });

    test('the formats a query does not name are served their markup', async function (assert) {
      for (let format of ['isolated', 'atom'] as const) {
        let served = markup(
          await search('teacher', named('listPrivate', format)),
        );
        for (let [id, html] of served) {
          assert.strictEqual(
            typeof html,
            'string',
            `${format}: ${id} carries its markup`,
          );
        }
      }
    });

    test('every row is served under the query’s declaration, not its own type’s read', async function (assert) {
      // `GuardedRoster` withholds its embedded format from reads rooted at its
      // own cards, and a query that declares nothing still serves its row's
      // markup: a row type's `read` is not consulted while a query's rows are
      // assembled, as it is not for `links`.
      let shared = markup(
        await search('teacher', named('listShared', 'embedded')),
      );
      assert.true(
        (shared.get(BIOLOGY) ?? '').includes('Ben, Cy'),
        'the guarded roster’s markup is served under a query declaring nothing',
      );

      // The other direction: a withholding query withholds every row alike,
      // including one whose own read declares nothing.
      let withheld = markup(
        await search('teacher', named('listPrivate', 'embedded')),
      );
      assert.strictEqual(
        withheld.get(ALGEBRA),
        undefined,
        'a row whose type declares nothing is served data-only by the query',
      );
    });

    test('the results are the same whether the caller was admitted coarsely or by grant', async function (assert) {
      let results = ({ data, included }: EntryBody) => ({ data, included });
      for (let operation of ['listShared', 'listPrivate'] as const) {
        for (let [label, send] of ENDPOINTS) {
          assert.deepEqual(
            results(
              await search('teacher', named(operation, 'embedded'), send),
            ),
            results(await search('admin', named(operation, 'embedded'), send)),
            `${label}, ${operation}: the shape does not depend on how the caller was authorized`,
          );
        }
      }
    });

    test('withholding a format renders nothing and discards nothing', async function (assert) {
      // The markup a data-only format withholds is still the one rendering the
      // realm keeps, unchanged, and a format left shareable is served from
      // that same rendering to every caller.
      let stored = async () =>
        (await db.execute(
          `SELECT embedded_html, generation FROM prerendered_html
           WHERE url = '${ALGEBRA}.json' AND type = 'instance'`,
        )) as {
          embedded_html: Record<string, string> | null;
          generation: number;
        }[];
      let before = await stored();
      assert.strictEqual(before.length, 1, 'the card has one rendering row');
      for (let caller of ['teacher', 'admin'] as const) {
        await search(caller, named('listPrivate', 'embedded'));
        await search(caller, named('listShared', 'embedded'));
      }
      assert.deepEqual(
        await stored(),
        before,
        'the stored rendering and its generation are untouched',
      );
      assert.true(
        Object.values(before[0].embedded_html ?? {}).some((html) =>
          html.includes('Ada, Ben'),
        ),
        'and it still holds the markup the declaration withholds',
      );
      let teacher = markup(
        await search('teacher', named('listShared', 'embedded')),
      );
      let admin = markup(
        await search('admin', named('listShared', 'embedded')),
      );
      assert.deepEqual(
        teacher,
        admin,
        'a shared format is the same markup for every caller',
      );
    });
  });

  module('an ad-hoc search', function () {
    test('an ad-hoc search declares nothing, so it serves every format’s markup', async function (assert) {
      // The ad-hoc grant is the one a policy author cannot narrow: a
      // grant-reached caller who wants a format data-only is granted a named
      // query that declares it, not this.
      for (let caller of ['teacher', 'admin'] as const) {
        let served = markup(
          await search(caller, {
            filter: {
              'item.on': ROSTER,
              eq: { htmlQuery: { eq: { format: 'embedded' } } },
            },
            realms: [EDUCATION],
          }),
        );
        assert.true(
          (served.get(ALGEBRA) ?? '').includes('Ada, Ben'),
          `${caller}: the embedded markup a named query withholds is served`,
        );
      }
    });
  });

  module('a render', function () {
    test('a render’s search keeps every format’s markup, whatever the query declares', async function (assert) {
      // What a render draws becomes part of the embedding card's own
      // prerendered HTML, which that card's own declarations govern, so its
      // search is served the markup a live caller is not.
      for (let [label, send] of ENDPOINTS) {
        let served = markup(
          await search(
            'admin',
            named('listPrivate', 'embedded'),
            (caller, payload) =>
              send(caller, payload).set(DURING_PRERENDER_HEADER, 'true'),
          ),
        );
        assert.true(
          (served.get(ALGEBRA) ?? '').includes('Ada, Ben'),
          `${label}: the render receives the embedded markup`,
        );
      }
    });
  });

  module('both endpoints', function () {
    test('the federated search serves each declaration the way the realm’s own search does', async function (assert) {
      // Asked in turn of the same rows, so a response cached for one query is
      // never served for the other.
      for (let operation of ['listShared', 'listPrivate'] as const) {
        let federated = await search(
          'teacher',
          named(operation, 'embedded'),
          federatedSearch,
        );
        let local = await search('teacher', named(operation, 'embedded'));
        assert.deepEqual(
          [...markup(federated).entries()],
          [...markup(local).entries()],
          `${operation}: the same markup, row for row`,
        );
      }
      let shared = markup(
        await search(
          'teacher',
          named('listShared', 'embedded'),
          federatedSearch,
        ),
      );
      let withheld = markup(
        await search(
          'teacher',
          named('listPrivate', 'embedded'),
          federatedSearch,
        ),
      );
      assert.notDeepEqual(
        [...shared.values()],
        [...withheld.values()],
        'the two declarations are two answers',
      );
    });
  });

  module('the single-card HTML read', function () {
    test('a card whose read declares a format unshareable answers data-only for it', async function (assert) {
      for (let format of ['embedded', 'fitted'] as const) {
        let response = await cardHtml(BIOLOGY, format);
        assert.strictEqual(response.status, 200, `${format}: answered`);
        let { data, included } = JSON.parse(response.text) as {
          data: Resource;
          included?: Resource[];
        };
        assert.strictEqual(
          data.relationships?.html,
          undefined,
          `${format}: no rendering is served`,
        );
        assert.deepEqual(
          data.relationships?.item?.data,
          { type: 'card', id: BIOLOGY },
          `${format}: the card is served in its place`,
        );
        assert.false(
          (included ?? []).some((resource) => resource.type === 'html'),
          `${format}: and no markup rides the response`,
        );
      }
    });

    test('its other formats, and a card whose read declares nothing, are served their markup', async function (assert) {
      let rendered = async (url: string, format: Format) => {
        let response = await cardHtml(url, format);
        let { data } = JSON.parse(response.text) as { data: Resource };
        return (data.relationships?.html?.data as unknown[] | undefined)
          ?.length;
      };
      assert.strictEqual(
        await rendered(BIOLOGY, 'isolated'),
        1,
        'the guarded card’s isolated rendering is served',
      );
      assert.strictEqual(
        await rendered(ALGEBRA, 'embedded'),
        1,
        'a card of a type declaring nothing is served its embedded rendering',
      );
    });

    test('a validator names the withheld formats a request selects, and no others', async function (assert) {
      let withheld = (await cardHtml(BIOLOGY, 'embedded')).get('etag') ?? '';
      assert.true(
        withheld.endsWith(':dataonly-embedded"'),
        `the validator names the withheld format asked for, got ${withheld}`,
      );
      let shared = (await cardHtml(BIOLOGY, 'isolated')).get('etag') ?? '';
      assert.true(
        /^"\d+:\d+"$/.test(shared),
        `a shared format of the same card keeps the plain index:html validator a client rebuilds, got ${shared}`,
      );
      let plain = (await cardHtml(ALGEBRA, 'embedded')).get('etag') ?? '';
      assert.false(
        plain.includes('dataonly'),
        `a card of a type declaring nothing carries no such segment, got ${plain}`,
      );
    });
  });

  module('the host-mode page', function () {
    function page(url: string) {
      return request.get(new URL(url).pathname).set('Accept', 'text/html');
    }

    // The markup the realm stores for a card, so an assertion that a page
    // carries none of it reads as a withholding rather than as an absence.
    async function stored(url: string) {
      let [row] = (await db.execute(
        `SELECT isolated_html, head_html FROM prerendered_html
         WHERE url = '${url}.json' AND type = 'instance'`,
      )) as { isolated_html: string | null; head_html: string | null }[];
      return row;
    }

    test('a card whose read declares isolated and head unshareable is served no markup of either', async function (assert) {
      let markup = await stored(`${NOTICES}notices/sealed`);
      assert.true(
        (markup?.isolated_html ?? '').includes('data-notice-body'),
        'the realm stores the card’s isolated markup',
      );
      assert.true(
        (markup?.head_html ?? '').includes('Notice head: Sealed ballot'),
        'and its head markup',
      );
      let sealed = await page(`${NOTICES}notices/sealed`);
      assert.strictEqual(sealed.status, 200, 'the page is served');
      assert.false(
        sealed.text.includes('data-notice-body'),
        'no isolated markup is injected',
      );
      assert.false(
        sealed.text.includes('Notice head: Sealed ballot'),
        'and no head markup',
      );
      assert.true(
        sealed.text.includes('<title>Boxel</title>'),
        'the page carries the default title in its place',
      );
    });

    test('a card whose read declares nothing is served both', async function (assert) {
      let markup = await stored(`${NOTICES}notices/open`);
      assert.true(
        (markup?.isolated_html ?? '').includes('data-notice-body'),
        'the realm stores the card’s isolated markup',
      );
      let open = await page(`${NOTICES}notices/open`);
      assert.strictEqual(open.status, 200, 'the page is served');
      assert.true(
        open.text.includes('data-notice-body'),
        'its isolated markup is injected',
      );
      assert.true(
        open.text.includes('Notice head: Open house'),
        'and its head markup',
      );
    });
  });
});
