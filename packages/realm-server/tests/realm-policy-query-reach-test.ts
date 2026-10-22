import QUnit from 'qunit';
const { module, test } = QUnit;
import supertest from 'supertest';
import type { Test, SuperTest } from 'supertest';
import { basename, join } from 'path';
import { dirSync } from 'tmp';
import {
  DURING_PRERENDER_HEADER,
  rri,
  setSearchShapeSink,
  SupportedMimeType,
  X_BOXEL_LINK_SHAPE_HEADER,
  type SearchShapeEvent,
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
import { createJWT as createRealmServerJWT } from '../utils/jwt.ts';

// ============================================================================
// How far a declared query's results reach into each row's link graph, and
// who decides.
//
// A search assembles the transitive closure of every result's links by
// default, so a caller admitted to a query's rows is admitted to everything
// those rows point at. A `query` declaration may say how much of that to
// carry — `full`, `ids`, `none` — and the declaration belongs to the query
// rather than to the caller: a realm writer and a caller reached by a policy
// grant are served the same results by the same request.
//
// The topology is the row-reach suite's, asked through search. The Education
// realm holds rosters and the students they link to, and `Roster` declares
// three queries that differ only in what their `links` declares. The teacher
// who asks them holds no permission on that realm at all and is admitted to
// each by a query grant. The students are granted to nobody, which is what
// makes the difference between the strategies observable: under `full` the
// teacher receives students they could not have fetched, and under `ids` they
// receive their names and are refused when they go and ask for them.
// ============================================================================

const EDUCATION = 'http://127.0.0.1:4444/education/';
const ORG = 'http://127.0.0.1:4444/org/';
const POLICY_CARD = `${ORG}policies/education`;
const ADMIN = '@education-admin:localhost';
const ORG_ADMIN = '@org-admin:localhost';
const TEACHER = '@teacher:localhost';

const REALM_POLICY = {
  module: rri('@cardstack/catalog/realm-policy/realm-policy'),
  name: 'RealmPolicy',
};

const ROSTER = { module: `${EDUCATION}roster`, name: 'Roster' };

// Is the caller one of this roster's teachers. `any(. == actor())` rather than
// `contains`, which matches substrings, and a shape the `predicate` profile
// compiles to a filter, which a query grant needs.
const TEACHES = '.teacherIds | any(. == actor())';

const STUDENT_MODULE = `
  import { contains, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  export class Student extends CardDef {
    @field name = contains(StringField);
  }
`;

// One search, three declarations. `roll` is computed from the linked students,
// which is what makes it the probe for the one thing no strategy narrows: it is
// computed when the card is indexed, under the realm's own authority, and lands
// in the card's own attributes rather than in the link closure.
//
// `GuardedRoster` narrows its own `read` to `none`. It turns up in all three
// queries' results, which is what shows whose declaration a result row is
// served under.
const ROSTER_MODULE = `
  import { contains, containsMany, field, linksToMany, CardDef } from "@cardstack/base/card-api";
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
      // A linked card can still be an empty slot on a render's first pass,
      // before the links it names are loaded; the value the index records is
      // the one the render settles on.
      computeVia: function (this: Roster) {
        return (this.students ?? [])
          .map((student) => student?.name)
          .filter(Boolean)
          .join(', ');
      },
    });

    @operation static listFull = { base: 'query', query: allRosters() };
    @operation static listIds = {
      base: 'query',
      query: allRosters(),
      links: 'ids',
    };
    @operation static listNone = {
      base: 'query',
      query: allRosters(),
      links: 'none',
    };
  }

  export class GuardedRoster extends Roster {
    @operation static read = { base: 'read', links: 'ids' };
  }
`;

type Grant = { operation: string; where?: unknown };
type Rule = { targetType: { module: string; name: string }; grants: Grant[] };

// One rule, granting each query to the rosters' own teachers. Nothing grants a
// read of a `Student`, so every student the teacher ends up holding arrived as
// part of a result row's representation rather than on its own merits.
const RULES: Rule[] = [
  {
    targetType: ROSTER,
    grants: ['listFull', 'listIds', 'listNone'].map((operation) => ({
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

const ALGEBRA = `${EDUCATION}rosters/algebra`;
const BIOLOGY = `${EDUCATION}rosters/biology`;
const ADA = `${EDUCATION}students/ada`;
const BEN = `${EDUCATION}students/ben`;
const CY = `${EDUCATION}students/cy`;

// What each roster links to, and so what its row names under `ids`.
const LINKS: Record<string, string[]> = {
  [ALGEBRA]: [ADA, BEN],
  [BIOLOGY]: [BEN, CY],
};

type Strategy = 'full' | 'ids' | 'none';
const QUERY_FOR: Record<Strategy, string> = {
  full: 'listFull',
  ids: 'listIds',
  none: 'listNone',
};
const STRATEGIES: Strategy[] = ['full', 'ids', 'none'];

interface Resource {
  id?: string;
  type?: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<
    string,
    { links?: { self?: string }; data?: unknown } | undefined
  >;
  meta?: Record<string, unknown>;
}

// A search entry document, narrowed to what this suite reads off it.
interface EntryBody {
  data: Resource[];
  included?: Resource[];
}

module(basename(import.meta.filename), function (hooks) {
  let education: Realm;
  let org: Realm;
  let request: SuperTest<Test>;
  let server: Server;

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
  }

  // One server for the whole module, since every test only reads. Booting it
  // indexes both realms, which runs inside the first test's budget, so that
  // budget is extended past the per-test timeout.
  hooks.before(function (assert) {
    assert.timeout(300_000);
  });

  setupDB(hooks, {
    before: async (dbAdapter, publisher, runner) => {
      await start({ dbAdapter, publisher, runner });
    },
    after: async () => {
      // Guarded, so a boot that failed partway still closes what it opened.
      for (let realm of [education, org]) {
        realm?.unsubscribe();
      }
      if (server) {
        await closeServer(server);
      }
      resetCatalogRealms();
    },
  });

  // The admin holds realm read, so the realm's ACL admits their search and no
  // policy is consulted. The teacher holds nothing, so every row they are
  // served is admitted by a query grant or not at all.
  type Caller = 'admin' | 'teacher';
  const USERS: Record<Caller, string> = { admin: ADMIN, teacher: TEACHER };
  const PERMISSIONS: Record<Caller, ('read' | 'write' | 'realm-owner')[]> = {
    admin: ['read', 'write', 'realm-owner'],
    teacher: [],
  };

  function body(strategy: Strategy, fields: string[] = ['item']) {
    return {
      operation: QUERY_FOR[strategy],
      on: ROSTER,
      realms: [EDUCATION],
      fields: { entry: fields },
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

  async function search(
    caller: Caller,
    payload: object,
    send = realmSearch,
  ): Promise<EntryBody> {
    let response = await send(caller, payload);
    if (response.status !== 200) {
      throw new Error(`search answered ${response.status}: ${response.text}`);
    }
    return response.body as EntryBody;
  }

  function getCard(url: string, caller: Caller) {
    return request
      .get(new URL(url).pathname)
      .set('Accept', SupportedMimeType.CardJson)
      .set(
        'Authorization',
        `Bearer ${createJWT(education, USERS[caller], PERMISSIONS[caller])}`,
      );
  }

  // The card each result row was served with, by its id.
  function items(doc: EntryBody): Map<string, Resource> {
    let rowIds = new Set(doc.data.map((entry) => entry.id));
    return new Map(
      (doc.included ?? [])
        .filter(
          (resource) =>
            resource.type === 'card' && resource.id && rowIds.has(resource.id),
        )
        .map((resource) => [resource.id!, resource]),
    );
  }

  // Every card the response carries beyond the rows themselves: the assembled
  // link closure. Sorted, so a comparison reads as a set rather than as an
  // assembly order.
  function closure(doc: EntryBody): string[] {
    let rowIds = new Set(doc.data.map((entry) => entry.id));
    return [
      ...new Set(
        (doc.included ?? [])
          .filter(
            (resource) =>
              resource.type === 'card' &&
              resource.id &&
              !rowIds.has(resource.id),
          )
          .map((resource) => new URL(resource.id!, EDUCATION).href),
      ),
    ].sort();
  }

  // What a row's card names through its relationships. A link the response
  // names without carrying is exactly the `ids` shape.
  function namedTargets(item: Resource | undefined): string[] {
    return Object.values(item?.relationships ?? {})
      .map((relationship) => relationship?.links?.self)
      .filter((self): self is string => typeof self === 'string')
      .map((self) => new URL(self, item!.id).href)
      .sort();
  }

  function rowIds(doc: EntryBody): string[] {
    return doc.data.map((entry) => entry.id!);
  }

  // The gate's refusal to a caller who may not read the realm, which the
  // teacher is: they are told nothing is there.
  async function assertNotThere(assert: Assert, url: string, label: string) {
    let response = await getCard(url, 'teacher');
    assert.strictEqual(response.status, 404, `${label}: status`);
    assert.false(
      /not permitted/.test(response.text),
      `${label}: nothing says the gate refused`,
    );
  }

  test('the grant admits the teacher to every roster, under each declaration', async function (assert) {
    // The premise the rest of the suite rests on: the teacher reaches these
    // rows through the query grants alone, and reaches no student at all.
    for (let strategy of STRATEGIES) {
      assert.deepEqual(
        rowIds(await search('teacher', body(strategy))),
        [ALGEBRA, BIOLOGY],
        `${strategy}: both rosters, in the declaration's order`,
      );
    }
    for (let target of [ADA, BEN, CY]) {
      await assertNotThere(assert, target, `a direct read of ${target}`);
    }
  });

  module('the default', function () {
    test('a query declaring no strategy carries each row’s whole closure, to a grant-reached caller too', async function (assert) {
      let doc = await search('teacher', body('full'));
      // Stated rather than implied. A grant on a query admits everything its
      // rows' representations carry, so turning this into an enforced
      // boundary later is a change this assertion makes visible.
      assert.deepEqual(
        closure(doc),
        [ADA, BEN, CY],
        'the teacher receives every linked student in `included[]`',
      );
      for (let [id, item] of items(doc)) {
        assert.deepEqual(
          namedTargets(item),
          LINKS[id],
          `and ${id} names its students`,
        );
      }
    });
  });

  module('ids', function () {
    test('each row names its targets and nothing is assembled', async function (assert) {
      let doc = await search('teacher', body('ids'));
      assert.deepEqual(closure(doc), [], 'no linked resource is carried');
      let served = items(doc);
      assert.deepEqual(
        [...served.keys()],
        [ALGEBRA, BIOLOGY],
        'every row still carries its card',
      );
      for (let [id, item] of served) {
        assert.deepEqual(
          namedTargets(item),
          LINKS[id],
          `and ${id} names every link`,
        );
      }
    });
  });

  module('none', function () {
    test('no row names or assembles any relationship', async function (assert) {
      let doc = await search('teacher', body('none'));
      assert.deepEqual(closure(doc), [], 'nothing assembled');
      let served = items(doc);
      assert.deepEqual(
        [...served.keys()],
        [ALGEBRA, BIOLOGY],
        'every row still carries its card',
      );
      for (let [id, item] of served) {
        assert.strictEqual(
          item.relationships,
          undefined,
          `${id} names nothing`,
        );
        assert.strictEqual(
          typeof item.attributes?.title,
          'string',
          `and still carries its own attributes`,
        );
      }
    });

    test('it narrows each row’s card, never the entry the row is delivered in', async function (assert) {
      let doc = await search('teacher', body('none', ['html', 'item']));
      for (let entry of doc.data) {
        assert.deepEqual(
          entry.relationships?.item?.data,
          { type: 'card', id: entry.id },
          `${entry.id}: the entry still names its card`,
        );
        let renderings = entry.relationships?.html?.data;
        assert.true(
          Array.isArray(renderings) ? renderings.length > 0 : false,
          `${entry.id}: and still carries its renderings`,
        );
      }
      assert.deepEqual(closure(doc), [], 'while the card links to nothing');
    });

    test('each row’s card says its relationships were withheld, on both endpoints', async function (assert) {
      // A card served with no relationships reads, to a consumer that keeps
      // it as a live instance, as a card linking to nothing. The marker is
      // what tells the two apart, so it rides on every narrowed row and on no
      // row that still carries its links.
      for (let [label, send] of [
        ['the realm’s own search', realmSearch],
        ['the federated search', federatedSearch],
      ] as const) {
        for (let strategy of STRATEGIES) {
          let doc = await search('teacher', body(strategy), send);
          let served = items(doc);
          assert.deepEqual(
            [...served.keys()],
            [ALGEBRA, BIOLOGY],
            `${label}, ${strategy}: every row carries its card`,
          );
          for (let [id, item] of served) {
            assert.strictEqual(
              item.meta?.relationshipsWithheld,
              strategy === 'none' ? true : undefined,
              `${label}, ${strategy}: ${id} ${
                strategy === 'none' ? 'is' : 'is not'
              } marked as withheld`,
            );
          }
        }
        let sparse = await search(
          'teacher',
          body('none', ['item.title', 'item.students']),
          send,
        );
        for (let [id, item] of items(sparse)) {
          assert.true(
            item.meta?.relationshipsWithheld,
            `${label}: a sparse row ${id} is marked too`,
          );
        }
      }
    });

    test('a sparse row asking for a link field is not told what it links to', async function (assert) {
      let doc = await search(
        'teacher',
        body('none', ['item.title', 'item.students']),
      );
      for (let [id, item] of items(doc)) {
        assert.strictEqual(
          item.relationships,
          undefined,
          `${id}: the field it asked for is withheld with the rest`,
        );
        assert.strictEqual(
          typeof item.attributes?.title,
          'string',
          `${id}: its other field is carried`,
        );
      }
    });
  });

  module('whose declaration a row is served under', function () {
    test('every row is served under the query’s declaration, not its own type’s read', async function (assert) {
      // Stated rather than implied. `GuardedRoster` narrows its own `read` to
      // `ids`, and a `full` query still carries its row whole: a row's type's
      // `read` governs reads of that card, and is not consulted while a query's
      // results are assembled — so a narrowing holds on a query only when the
      // query declares it.
      let full = await search('teacher', body('full'));
      assert.deepEqual(
        namedTargets(items(full).get(BIOLOGY)),
        [BEN, CY],
        'the guarded roster names its students',
      );
      assert.true(
        closure(full).includes(CY),
        'and carries the student only it links to, which its own read leaves unassembled',
      );

      // The other direction: a narrowing query narrows every row alike,
      // including one whose own read declares nothing.
      let narrowed = await search('teacher', body('none'));
      assert.strictEqual(
        items(narrowed).get(ALGEBRA)?.relationships,
        undefined,
        'a row whose type declares nothing is narrowed by the query',
      );
    });
  });

  module('uniform for every caller', function () {
    test('the results are the same whether the caller was admitted coarsely or by grant', async function (assert) {
      // The rows and what they carry. What the response says about itself
      // beside them is not the question here.
      let results = ({ data, included }: EntryBody) => ({ data, included });
      for (let strategy of STRATEGIES) {
        assert.deepEqual(
          results(await search('teacher', body(strategy))),
          results(await search('admin', body(strategy))),
          `${strategy}: the shape does not depend on how the caller was authorized`,
        );
      }
    });

    test('a named target is fetched on its own request and gated there', async function (assert) {
      let doc = await search('teacher', body('ids'));
      for (let target of namedTargets(items(doc).get(ALGEBRA))) {
        await assertNotThere(assert, target, `the per-link fetch of ${target}`);
        assert.strictEqual(
          (await getCard(target, 'admin')).status,
          200,
          `${target} is there to be read by a caller the realm admits`,
        );
      }
    });
  });

  module('computed derivation', function () {
    test('a value derived from a linked card survives every strategy', async function (assert) {
      for (let strategy of STRATEGIES) {
        let served = items(await search('teacher', body(strategy)));
        assert.strictEqual(
          served.get(ALGEBRA)?.attributes?.roll,
          'Ada, Ben',
          `${strategy}: the roll computed from the students is carried`,
        );
      }
    });
  });

  module('composition with the request', function () {
    test('a request may narrow a full query, and may not widen a narrowed one', async function (assert) {
      let narrowed = await search('teacher', body('full'), (caller, payload) =>
        realmSearch(caller, payload).set(
          X_BOXEL_LINK_SHAPE_HEADER,
          'links-only',
        ),
      );
      assert.deepEqual(
        closure(narrowed),
        [],
        'a caller asking for less than the declaration gets less',
      );
      assert.deepEqual(
        namedTargets(items(narrowed).get(ALGEBRA)),
        [ADA, BEN],
        'and its rows still name their targets',
      );

      // The other direction is the one that matters: the request asks for the
      // links to be named, and the declaration withholds even that.
      let asked = await search('teacher', body('none'), (caller, payload) =>
        realmSearch(caller, payload).set(
          X_BOXEL_LINK_SHAPE_HEADER,
          'links-only',
        ),
      );
      assert.strictEqual(
        items(asked).get(ALGEBRA)?.relationships,
        undefined,
        'a request never widens what the query declared',
      );
    });
  });

  module('a render', function () {
    test('a render’s search keeps each row’s stored links, whatever the query declares', async function (assert) {
      // A render resolves the cards its search answers with itself, and keeps
      // them for the rest of the indexing job, so a row whose relationships
      // were withheld would draw its link fields empty in every later render
      // that shows it. The render skips the assembly pass either way; what it
      // must not lose is which cards each row links to.
      for (let [label, send] of [
        ['the realm’s own search', realmSearch],
        ['the federated search', federatedSearch],
      ] as const) {
        let doc = await search('admin', body('none'), (caller, payload) =>
          send(caller, payload).set(DURING_PRERENDER_HEADER, 'true'),
        );
        let served = items(doc);
        assert.deepEqual(
          [...served.keys()],
          [ALGEBRA, BIOLOGY],
          `${label}: every row is answered`,
        );
        for (let [id, item] of served) {
          assert.deepEqual(
            namedTargets(item),
            LINKS[id],
            `${label}: ${id} still names its students`,
          );
          assert.strictEqual(
            item.meta?.relationshipsWithheld,
            undefined,
            `${label}: ${id} is not marked as withheld`,
          );
        }
        assert.deepEqual(
          closure(doc),
          [],
          `${label}: and nothing is assembled`,
        );
      }
    });
  });

  module('both endpoints', function () {
    test('the federated search serves each declaration the way the realm’s own search does', async function (assert) {
      for (let strategy of STRATEGIES) {
        let federated = await search(
          'teacher',
          body(strategy),
          federatedSearch,
        );
        let local = await search('teacher', body(strategy));
        assert.deepEqual(
          closure(federated),
          closure(local),
          `${strategy}: the same closure`,
        );
        assert.deepEqual(
          [...items(federated).values()].map(namedTargets),
          [...items(local).values()].map(namedTargets),
          `${strategy}: the same named targets`,
        );
      }
    });

    test('the federated search reports the served shape as the query asked for it', async function (assert) {
      let events: SearchShapeEvent[] = [];
      setSearchShapeSink((event) => events.push(event));
      try {
        for (let strategy of STRATEGIES) {
          let response = await federatedSearch('teacher', body(strategy)).set(
            'x-boxel-logging-correlation-id',
            `query-reach-${strategy}`,
          );
          assert.strictEqual(response.status, 200, `${strategy}: HTTP 200`);
        }
      } finally {
        setSearchShapeSink(undefined);
      }
      for (let [strategy, linkMode] of [
        ['full', 'full'],
        ['ids', 'links-only'],
        ['none', 'none'],
      ] as const) {
        let [event] = events.filter(
          (candidate) => candidate.correlationId === `query-reach-${strategy}`,
        );
        assert.strictEqual(
          event?.linkMode,
          linkMode,
          `${strategy}: the mode it was served in`,
        );
        assert.false(
          event?.linkModeDowngraded,
          `${strategy}: a declaration's narrowing is not reported as the policy overruling the caller`,
        );
      }
    });
  });
});
