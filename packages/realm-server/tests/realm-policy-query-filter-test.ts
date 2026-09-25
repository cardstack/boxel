import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename, join } from 'path';
import { dirSync } from 'tmp';
import {
  parseSearchEntryQueryFromPayload,
  rri,
  type QueuePublisher,
  type QueueRunner,
  type Realm,
} from '@cardstack/runtime-common';
import { lowerQueryOperation } from '@cardstack/runtime-common/card-operations';
import type { PgAdapter } from '@cardstack/postgres';
import { resetCatalogRealms } from '../handlers/handle-fetch-catalog-realms.ts';
import type { RealmHttpServer as Server } from '../server.ts';
import {
  closeServer,
  createVirtualNetwork,
  matrixURL,
  realmConfigCardJSON,
  runTestRealmServerWithRealms,
  setupDB,
} from './helpers/index.ts';
import { setupCatalogTestSubset } from './helpers/catalog-test-subset.ts';

// A query grant's compiled filter, run through the realm's own search engine
// against real card definitions and indexed cards: what each filter admits,
// set against what its predicate says about each card.
const EDUCATION = 'http://127.0.0.1:4444/education/';
const POLICY_CARD = `${EDUCATION}policies/education`;
const TEACHER = '@teacher:localhost';
const OTHER = '@other:localhost';
const P1 = `${EDUCATION}people/p1`;
const P2 = `${EDUCATION}people/p2`;

const REALM_POLICY = {
  module: rri('@cardstack/catalog/realm-policy/realm-policy'),
  name: 'RealmPolicy',
};

const CLASSROOM_MODULE = `
  import { contains, containsMany, field, linksTo, linksToMany, CardDef, FieldDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  import NumberField from "@cardstack/base/number";
  import { Person } from "./person";
  export class Address extends FieldDef {
    @field city = contains(StringField);
  }
  export class Classroom extends CardDef {
    @field providerId = contains(StringField);
    @field teacherIds = containsMany(StringField);
    @field roomNumber = contains(NumberField);
    @field address = contains(Address);
    @field lead = linksTo(() => Person);
    @field teachers = linksToMany(() => Person);
  }
`;

const PERSON_MODULE = `
  import { contains, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  export class Person extends CardDef {
    @field name = contains(StringField);
  }
`;

function person(name: string) {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes: { name },
      meta: { adoptsFrom: { module: '../person', name: 'Person' } },
    },
  });
}

function classroom({
  attributes,
  lead,
  teachers = [],
}: {
  attributes: Record<string, unknown>;
  lead?: string;
  teachers?: string[];
}) {
  let relationships: Record<string, unknown> = {
    lead: { links: { self: lead ?? null } },
  };
  teachers.forEach((teacher, index) => {
    relationships[`teachers.${index}`] = { links: { self: teacher } };
  });
  return JSON.stringify({
    data: {
      type: 'card',
      attributes,
      relationships,
      meta: { adoptsFrom: { module: '../classroom', name: 'Classroom' } },
    },
  });
}

// Six classrooms. `c`'s one teacher id merely contains the teacher's, `d` has
// nothing set at all, and `f` has an empty roster and no room number: the
// places where a filter is narrower than its predicate.
const CLASSROOMS: Record<string, string> = {
  a: classroom({
    attributes: {
      providerId: TEACHER,
      teacherIds: [OTHER],
      roomNumber: 101,
      address: { city: 'Springfield' },
    },
    lead: '../people/p1',
    teachers: ['../people/p1'],
  }),
  b: classroom({
    attributes: {
      providerId: OTHER,
      teacherIds: [TEACHER, OTHER],
      roomNumber: 204,
      address: { city: 'Shelbyville' },
    },
    lead: '../people/p2',
    teachers: ['../people/p1', '../people/p2'],
  }),
  c: classroom({
    attributes: {
      providerId: OTHER,
      teacherIds: [`${TEACHER}.org`],
      roomNumber: 305,
    },
    teachers: ['../people/p2'],
  }),
  d: classroom({ attributes: {} }),
  e: classroom({
    attributes: {
      providerId: TEACHER,
      teacherIds: [TEACHER],
      roomNumber: 204,
    },
  }),
  f: classroom({
    attributes: {
      providerId: TEACHER,
      teacherIds: [],
    },
  }),
};

// Each grant, and the classrooms its filter admits for the teacher.
const CASES: { where?: string; admits: string[]; because?: string }[] = [
  { where: '.providerId == actor()', admits: ['a', 'e', 'f'] },
  { where: '.teacherIds | any(. == actor())', admits: ['b', 'e'] },
  {
    where: '.teacherIds | contains([actor()])',
    admits: ['b', 'e'],
    because:
      "BXL's `contains` also admits `c`, whose id only contains the teacher's; the filter matches whole ids",
  },
  { where: '.roomNumber > 200', admits: ['b', 'c', 'e'] },
  {
    where: '.roomNumber < 200',
    admits: ['a'],
    because:
      'BXL also admits `d` and `f`, since `null < 200` holds there; a filter admits no card that has no room number',
  },
  { where: '.address.city == "Springfield"', admits: ['a'] },
  { where: `.lead.id == "${P1}"`, admits: ['a'] },
  { where: `.teachers | any(.id == "${P2}")`, admits: ['b', 'c'] },
  {
    where: '.providerId != actor()',
    admits: ['b', 'c'],
    because:
      'BXL also admits `d`, whose provider is unset; a filter admits no card that has none',
  },
  {
    where: '.providerId == actor() or (.teacherIds | any(. == actor()))',
    admits: ['a', 'b', 'e', 'f'],
  },
  {
    where: '(.roomNumber > 200 or .providerId == null) | not',
    admits: ['a'],
    because:
      'BXL also admits `f`, since `null > 200` is false there; a filter has no answer for a card with no room number, so it admits none',
  },
  { admits: ['a', 'b', 'c', 'd', 'e', 'f'] },
];

module(basename(import.meta.filename), function (hooks) {
  let education: Realm;
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
            'classroom.gts': CLASSROOM_MODULE,
            'person.gts': PERSON_MODULE,
            'people/p1.json': person('Pat'),
            'people/p2.json': person('Sam'),
            ...Object.fromEntries(
              Object.entries(CLASSROOMS).map(([name, json]) => [
                `classrooms/${name}.json`,
                json,
              ]),
            ),
            'policies/education.json': JSON.stringify({
              data: {
                type: 'card',
                attributes: {
                  rules: [
                    {
                      targetType: {
                        module: `${EDUCATION}classroom`,
                        name: 'Classroom',
                      },
                      grants: CASES.map(({ where }) => ({
                        operation: 'query',
                        ...(where ? { where } : {}),
                      })),
                    },
                  ],
                },
                meta: { adoptsFrom: REALM_POLICY },
              },
            }),
          },
          permissions: {
            '@education-admin:localhost': ['read', 'write', 'realm-owner'],
          },
        },
      ],
      dbAdapter,
      publisher,
      runner,
      matrixURL,
    });
    server = result.testRealmHttpServer;
    education = result.realms.find((realm) => realm.url === EDUCATION)!;
  }

  setupDB(hooks, {
    beforeEach: async (dbAdapter, publisher, runner) => {
      await start({ dbAdapter, publisher, runner });
    },
    afterEach: async () => {
      education.__testOnlyClearCaches();
      education.unsubscribe();
      await closeServer(server);
      resetCatalogRealms();
    },
  });

  test("each query grant's filter admits, for its caller, the classrooms its predicate holds for", async function (assert) {
    let policy = await education.getCompiledPolicy();
    assert.deepEqual(policy?.issues, [], 'every grant compiles a filter');
    let grants = policy?.rules[0]?.grants ?? [];
    assert.strictEqual(grants.length, CASES.length);

    for (let [index, { where, admits, because }] of CASES.entries()) {
      let label = where ?? '(no condition)';
      let filter = grants[index]?.filter;
      assert.ok(filter, `${label} has a filter`);
      let bound = lowerQueryOperation(
        { base: 'query', query: { filter } },
        { actor: TEACHER },
      );
      let doc = await education.realmIndexQueryEngine.searchEntries(
        parseSearchEntryQueryFromPayload(bound),
      );
      assert.deepEqual(
        doc.data.map((entry) => entry.id).sort(),
        admits.map((name) => `${EDUCATION}classrooms/${name}`),
        because ? `${label}: ${because}` : label,
      );
    }
  });
});
