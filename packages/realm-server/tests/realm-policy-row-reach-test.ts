import QUnit from 'qunit';
const { module, test } = QUnit;
import supertest from 'supertest';
import type { Test, SuperTest, Response } from 'supertest';
import { basename, join } from 'path';
import { dirSync } from 'tmp';
import {
  rri,
  SupportedMimeType,
  X_BOXEL_LINK_SHAPE_HEADER,
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
  runTestRealmServerWithRealms,
  setupDB,
} from './helpers/index.ts';
import { setupCatalogTestSubset } from './helpers/catalog-test-subset.ts';

// ============================================================================
// How far a read reaches into the card's link graph, and who decides.
//
// A read assembles the transitive closure of its target's links by default, so
// a caller admitted to one row is admitted to everything that row points at.
// A read may declare how much of that to carry — `full` or `ids` — and the
// declaration belongs to the operation rather than to the caller: a
// realm writer and a caller reached by a policy grant are served the same
// document by the same request.
//
// The topology is the worked example's, cut to what this question needs. The
// Education realm holds two rosters that differ only in what their `read`
// declares; the teacher who reads them holds no permission on that realm at
// all and is admitted by a grant on the type they all descend from. The
// students those rosters link to are granted to nobody, which is what makes
// the difference between the strategies observable: under `full` the teacher
// receives students they could not have fetched, and under `ids` they receive
// their names and are refused when they go and ask for them.
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

// The type the grant names. Every roster below descends from it, so one rule
// admits all three and the only thing that varies between them is what their
// `read` declares.
const ROSTER = { module: `${EDUCATION}roster`, name: 'Roster' };
const SECTION = { module: `${EDUCATION}roster`, name: 'Section' };

// Is the caller one of this roster's teachers. `any(. == actor())` rather than
// `contains`, which matches substrings.
const TEACHES = '.teacherIds | any(. == actor())';

const STUDENT_MODULE = `
  import { contains, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  export class Student extends CardDef {
    @field name = contains(StringField);
  }
`;

// One shape, two declarations. `roll` is computed from the linked students,
// which is what makes it the probe for the one thing no strategy narrows: it is
// computed when the card is indexed, under the realm's own authority, and lands
// in the card's own attributes rather than in the link closure.
const ROSTER_MODULE = `
  import { contains, containsMany, field, linksTo, linksToMany, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  import { operation } from "@cardstack/base/operations";
  import { Student } from "./student";

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
  }

  export class FullRoster extends Roster {}

  export class IdsRoster extends Roster {
    @operation static read = {
      base: 'read',
      links: 'ids',
    };
  }

  // Declares nothing, and links to a roster that declares \`ids\`. What a read
  // of it carries is decided by its own read alone.
  export class Section extends CardDef {
    @field teacherIds = containsMany(StringField);
    @field roster = linksTo(() => Roster);
  }
`;

type Grant = { operation: string; where?: unknown };
type Rule = { targetType: { module: string; name: string }; grants: Grant[] };

// One rule, on the type the two rosters descend from. Nothing grants a read
// of a `Student`, so every student the teacher ends up holding arrived as part
// of a roster's representation rather than on its own merits.
const RULES: Rule[] = [
  { targetType: ROSTER, grants: [{ operation: 'read', where: TEACHES }] },
  { targetType: SECTION, grants: [{ operation: 'read', where: TEACHES }] },
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

function section(roster: string) {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes: { teacherIds: [TEACHER] },
      relationships: { roster: { links: { self: `../rosters/${roster}` } } },
      meta: { adoptsFrom: { module: '../roster', name: 'Section' } },
    },
  });
}

function envelope(...operations: unknown[]) {
  return JSON.stringify({ 'boxel:operations': operations });
}

const FULL = `${EDUCATION}rosters/full`;
const IDS = `${EDUCATION}rosters/ids`;
const SECTION_1 = `${EDUCATION}sections/s1`;
const ADA = `${EDUCATION}students/ada`;
const BEN = `${EDUCATION}students/ben`;

// A card document as the routes answer with one, narrowed to what this suite
// reads off it.
interface CardBody {
  data: {
    id?: string;
    attributes?: Record<string, unknown>;
    relationships?: Record<string, { links?: { self?: string } }>;
  };
  included?: {
    id?: string;
    type?: string;
    relationships?: Record<string, { links?: { self?: string } }>;
  }[];
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
            'rosters/full.json': roster('FullRoster', 'Full', ['ada', 'ben']),
            'rosters/ids.json': roster('IdsRoster', 'Ids', ['ada', 'ben']),
            'sections/s1.json': section('ids'),
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

  setupDB(hooks, {
    beforeEach: async (dbAdapter, publisher, runner) => {
      await start({ dbAdapter, publisher, runner });
    },
    afterEach: async () => {
      for (let realm of [education, org]) {
        realm.__testOnlyClearCaches();
        realm.unsubscribe();
      }
      await closeServer(server);
      resetCatalogRealms();
    },
  });

  function bearer(
    user: string,
    permissions: Parameters<typeof createJWT>[2] = [],
  ) {
    return `Bearer ${createJWT(education, user, permissions)}`;
  }

  // The admin holds realm read, so the coarse check admits them and the gate
  // never runs. The teacher holds nothing, so every read they make is admitted
  // by the grant or not at all.
  const AUTH = {
    admin: () => bearer(ADMIN, ['read', 'write', 'realm-owner']),
    teacher: () => bearer(TEACHER),
  };

  function path(url: string) {
    return new URL(url).pathname;
  }

  function getCard(url: string, auth: string) {
    return request
      .get(path(url))
      .set('Accept', SupportedMimeType.CardJson)
      .set('Authorization', auth);
  }

  function headCard(url: string, auth: string) {
    return request
      .head(path(url))
      .set('Accept', SupportedMimeType.CardJson)
      .set('Authorization', auth);
  }

  function invokeRead(url: string, auth: string) {
    return request
      .post(`${path(EDUCATION)}_operations`)
      .set('Accept', SupportedMimeType.BoxelOperations)
      .set('Content-Type', SupportedMimeType.BoxelOperations)
      .set('Authorization', auth)
      .send(envelope({ op: 'invoke', 'boxel:name': 'read', href: url }));
  }

  async function read(url: string, auth: string): Promise<CardBody> {
    let response = await getCard(url, auth);
    if (response.status !== 200) {
      throw new Error(
        `read of ${url} answered ${response.status}: ${response.text}`,
      );
    }
    return response.body as CardBody;
  }

  // A served document spells its ids and its relationship links relative to
  // itself, so both are read back through the document's own URL. Sorted, so a
  // comparison reads as a set rather than as an assembly order.
  function includedIds(body: CardBody, base: string): string[] {
    return (body.included ?? [])
      .filter((resource) => resource.type === 'card' && resource.id)
      .map((resource) => new URL(resource.id!, base).href)
      .sort();
  }

  // What a resource's relationships name. A link the response names without
  // carrying is exactly the `ids` shape.
  function namedTargets(
    relationships: Record<string, { links?: { self?: string } }> | undefined,
    base: string,
  ): string[] {
    return Object.values(relationships ?? {})
      .map((relationship) => relationship.links?.self)
      .filter((self): self is string => typeof self === 'string')
      .map((self) => new URL(self, base).href)
      .sort();
  }

  function linkedIds(body: CardBody, base: string): string[] {
    return namedTargets(body.data.relationships, base);
  }

  // The gate's refusal to a caller who may not read the realm, which the
  // teacher is: they are told nothing is there, so a card the policy does not
  // reach answers the way a card that does not exist does.
  function assertNotThere(assert: Assert, response: Response, label: string) {
    assert.strictEqual(response.status, 404, `${label}: status`);
    assert.false(
      /not permitted/.test(response.text),
      `${label}: nothing says the gate refused`,
    );
  }

  module('the default', function () {
    test('an operation declaring no strategy carries its whole closure, to a grant-reached caller too', async function (assert) {
      let body = await read(FULL, AUTH.teacher());
      // Stated rather than implied. A grant on a row admits everything that
      // row's representation carries, so turning this into an enforced
      // boundary later is a change this assertion makes visible.
      assert.deepEqual(
        includedIds(body, FULL),
        [ADA, BEN].sort(),
        'the teacher receives every linked student in `included[]`',
      );
      assert.deepEqual(
        linkedIds(body, FULL),
        [ADA, BEN].sort(),
        'and the relationships name them',
      );
      assertNotThere(
        assert,
        await getCard(ADA, AUTH.teacher()),
        'a student the teacher received inside the roster',
      );
    });

    test('an undeclared read is served under the unnarrowed validator', async function (assert) {
      let response = await getCard(FULL, AUTH.admin());
      assert.strictEqual(
        response.status,
        200,
        `the admin reads the roster: ${response.text}`,
      );
      let etag = response.headers.etag;
      assert.ok(etag, 'the read carries a validator');
      assert.false(
        /links-only|no-links/.test(etag),
        `and it names no narrowed shape: ${etag}`,
      );
    });
  });

  module('ids', function () {
    test('the relationships name their targets and nothing is assembled', async function (assert) {
      let body = await read(IDS, AUTH.teacher());
      assert.deepEqual(
        linkedIds(body, IDS),
        [ADA, BEN].sort(),
        'every link is named',
      );
      assert.strictEqual(
        body.included,
        undefined,
        'and no linked resource is carried',
      );
    });

    test('each named target is fetched on its own request and gated there', async function (assert) {
      let body = await read(IDS, AUTH.teacher());
      for (let target of linkedIds(body, IDS)) {
        assertNotThere(
          assert,
          await getCard(target, AUTH.teacher()),
          `the per-link fetch of ${target}`,
        );
        assert.strictEqual(
          (await getCard(target, AUTH.admin())).status,
          200,
          `${target} is there to be read by a caller the policy does reach`,
        );
      }
    });
  });

  module('scope', function () {
    test('a declaration narrows reads of its own card, not the card inside another read', async function (assert) {
      // Stated rather than implied. The roster declares `ids`, and a `full`
      // read of a card that links to it still carries it whole: a linked
      // type's declaration is not consulted while a closure is assembled, so
      // a narrowing only holds on the type that is read.
      let body = await read(SECTION_1, AUTH.teacher());
      let roster = (body.included ?? []).find(
        (resource) =>
          resource.id && new URL(resource.id, SECTION_1).href === IDS,
      );
      assert.ok(roster, 'the ids-declared roster is in the closure');
      assert.deepEqual(
        namedTargets(roster?.relationships, SECTION_1),
        [ADA, BEN].sort(),
        'carrying its relationships',
      );
      assert.deepEqual(
        includedIds(body, SECTION_1),
        [ADA, BEN, IDS].sort(),
        'and the students behind them, which its own read leaves unassembled',
      );
    });
  });

  module('uniform for every caller', function () {
    test('the document is the same whether the caller was admitted coarsely or by grant', async function (assert) {
      for (let [url, label] of [
        [FULL, 'full'],
        [IDS, 'ids'],
      ] as const) {
        assert.deepEqual(
          await read(url, AUTH.teacher()),
          await read(url, AUTH.admin()),
          `${label}: the shape does not depend on how the caller was authorized`,
        );
      }
    });
  });

  module('computed derivation', function () {
    test('a value derived from a linked card survives every strategy', async function (assert) {
      for (let [url, label] of [
        [FULL, 'full'],
        [IDS, 'ids'],
      ] as const) {
        let body = await read(url, AUTH.teacher());
        assert.strictEqual(
          body.data.attributes?.roll,
          'Ada, Ben',
          `${label}: the roll computed from the students is carried`,
        );
      }
    });
  });

  module('the validator describes the body', function () {
    test('a conditional read of each strategy is answered from its own validator', async function (assert) {
      for (let [url, label] of [
        [FULL, 'full'],
        [IDS, 'ids'],
      ] as const) {
        let first = await getCard(url, AUTH.admin());
        assert.strictEqual(
          first.status,
          200,
          `${label}: the admin reads it: ${first.text}`,
        );
        let etag = first.headers.etag;
        assert.ok(etag, `${label}: the read carries a validator`);
        assert.strictEqual(
          (await headCard(url, AUTH.admin())).headers.etag,
          etag,
          `${label}: and a HEAD states the same one`,
        );
        assert.strictEqual(
          (await getCard(url, AUTH.admin()).set('If-None-Match', etag)).status,
          304,
          `${label}: a conditional read matches it`,
        );
      }
    });

    test('the two strategies never share a validator', async function (assert) {
      // The part after the colon is the variant, which is where the shape is
      // named; the part before it is the index generation, which differs
      // between two separate cards anyway and would hide a collision.
      let variants = await Promise.all(
        [FULL, IDS].map(
          async (url) =>
            (await getCard(url, AUTH.admin())).headers.etag.split(':')[1],
        ),
      );
      assert.strictEqual(
        new Set(variants).size,
        2,
        `each strategy names its own shape: ${variants.join(' / ')}`,
      );
    });
  });

  module('the validator a narrowed request is answered from', function () {
    test('a request asking for links only is answered from its own validator', async function (assert) {
      // The validator built ahead of the assembly composes the declaration
      // with the request, so a conditional request carrying the header is the
      // case that reads that composition rather than the assembly's.
      for (let [url, label] of [
        [FULL, 'full'],
        [IDS, 'ids'],
      ] as const) {
        let first = await getCard(url, AUTH.admin()).set(
          X_BOXEL_LINK_SHAPE_HEADER,
          'links-only',
        );
        assert.strictEqual(
          first.status,
          200,
          `${label}: the admin reads it: ${first.text}`,
        );
        let etag = first.headers.etag;
        assert.ok(etag, `${label}: the read carries a validator`);
        assert.strictEqual(
          (
            await getCard(url, AUTH.admin())
              .set(X_BOXEL_LINK_SHAPE_HEADER, 'links-only')
              .set('If-None-Match', etag)
          ).status,
          304,
          `${label}: a conditional read with the same header matches it`,
        );
      }
    });
  });

  module('composition with the request', function () {
    test('a request may narrow a full read', async function (assert) {
      let narrowed = await getCard(FULL, AUTH.admin()).set(
        X_BOXEL_LINK_SHAPE_HEADER,
        'links-only',
      );
      let body = narrowed.body as CardBody;
      assert.deepEqual(
        linkedIds(body, FULL),
        [ADA, BEN].sort(),
        'a caller asking for less than the declaration gets less',
      );
      assert.strictEqual(body.included, undefined, 'and nothing is assembled');
    });
  });

  module('both transports', function () {
    test('the envelope answers with the shape the operation declares', async function (assert) {
      for (let [url, expected, label] of [
        [FULL, [ADA, BEN].sort(), 'full'],
        [IDS, [], 'ids'],
      ] as const) {
        let response = await invokeRead(url, AUTH.teacher());
        assert.strictEqual(
          response.status,
          200,
          `${label}: the envelope admits the read`,
        );
        let document = (response.body as { 'atomic:results': CardBody[] })[
          'atomic:results'
        ][0];
        assert.deepEqual(
          includedIds(document, url),
          [...expected],
          `${label}: the same closure the card+json GET carries`,
        );
      }
    });
  });
});
