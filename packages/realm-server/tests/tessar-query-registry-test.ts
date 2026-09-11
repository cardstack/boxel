import QUnit from 'qunit';
import type { PgAdapter } from '@cardstack/postgres';
import {
  IndexQueryEngine,
  VirtualNetwork,
  baseRealmRRI,
  rri,
  type Definition,
  type DefinitionLookup,
  type Filter,
} from '@cardstack/runtime-common';
import {
  TessarQueryRegistry,
  type TessarDocument,
} from '@cardstack/runtime-common/tessar-query-registry';
import { setupDB } from './helpers/index.ts';

const { module, test } = QUnit;
const realmURL = 'https://tessar.example/';
const on = { module: rri(`${realmURL}record`), name: 'TessarRecord' };
const definition: Definition = {
  type: 'card-def',
  codeRef: on,
  displayName: 'Tessar record',
  fields: {
    name: 'string',
    score: 'number',
    active: 'boolean',
    tags: 'strings',
  },
  fieldDefs: {
    string: {
      type: 'contains',
      isPrimitive: true,
      isComputed: false,
      fieldOrCard: { module: rri(`${baseRealmRRI}string`), name: 'default' },
    },
    strings: {
      type: 'containsMany',
      isPrimitive: true,
      isComputed: false,
      fieldOrCard: { module: rri(`${baseRealmRRI}string`), name: 'default' },
    },
    number: {
      type: 'contains',
      isPrimitive: true,
      isComputed: false,
      serializerName: 'number',
      fieldOrCard: { module: rri(`${baseRealmRRI}number`), name: 'default' },
    },
    boolean: {
      type: 'contains',
      isPrimitive: true,
      isComputed: false,
      serializerName: 'boolean',
      fieldOrCard: { module: rri(`${baseRealmRRI}boolean`), name: 'default' },
    },
  },
};

module('Tessar | Postgres query registry', function (hooks) {
  let db: PgAdapter;
  let engine: IndexQueryEngine;
  let registry: TessarQueryRegistry;
  setupDB(hooks, {
    templateDatabase: process.env.TESSAR_TEST_TEMPLATE_DB,
    beforeEach: async (adapter) => {
      db = adapter;
      // Persisted definition fixture: the SQL compiler receives the same
      // loaderless field schema that a real module-index entry supplies.
      let lookup = {
        async lookupDefinition() {
          return definition;
        },
      } as unknown as DefinitionLookup;
      let network = new VirtualNetwork();
      network.addRealmMapping(baseRealmRRI, 'https://cardstack.com/base/');
      engine = new IndexQueryEngine(db, lookup, network);
      registry = new TessarQueryRegistry(db, engine);
    },
  });
  let record = (name: string): TessarDocument => ({
    url: `${realmURL}record-1.json`,
    types: [`${on.module}/${on.name}`],
    search_doc: { name, score: 7, active: true, tags: ['red', 'blue'] },
  });

  test('real SQL verifies typed values, null, plural paths and boolean composition', async function (assert) {
    let predicates: Array<[Filter, boolean]> = [
      [{ on, eq: { name: 'A' } }, true],
      [{ on, eq: { name: 'B' } }, false],
      [{ on, in: { name: ['A', 'B'] } }, true],
      [{ on, range: { score: { gte: 7, lt: 8 } } }, true],
      [{ on, range: { score: { gt: 7 } } }, false],
      [{ on, eq: { active: true } }, true],
      [{ on, eq: { tags: 'blue' } }, true],
      [{ on, eq: { score: null } }, false],
      [
        { on, any: [{ eq: { name: 'B' } }, { not: { eq: { score: 8 } } }] },
        true,
      ],
    ];
    for (let [filter, expected] of predicates) {
      assert.strictEqual(
        await engine.tessarMatchesDocument(filter, record('A')),
        expected,
        JSON.stringify(filter),
      );
    }
    assert.true(
      await engine.tessarMatchesDocument(
        { on, eq: { score: null } },
        { ...record('A'), search_doc: { name: 'A' } },
      ),
      'missing field follows SQL null semantics',
    );
  });

  test('watch publication rolls back atomically and dirty state survives a new connection', async function (assert) {
    let owner = {
      realmURL,
      ownerURL: `${realmURL}summary`,
      generation: 1,
      inputGeneration: 1,
      definitionRevision: 'tessar-v1',
      watches: await registry.prepare([
        { fieldPath: 'records', query: { filter: { on, eq: { name: 'A' } } } },
      ]),
    };
    await assert.rejects(
      db.withWriteLock(`tessar:${realmURL}`, async (tx) => {
        await registry.publish(tx!, owner);
        throw new Error('Tessar injected rollback');
      }),
      /injected rollback/,
    );
    assert.deepEqual(
      await registry.affected(realmURL, undefined, record('A')),
      [],
      'rollback leaves no partial watch or terms',
    );
    await db.withWriteLock(`tessar:${realmURL}`, async (tx) => {
      assert.true(await registry.publish(tx!, owner));
    });
    assert.deepEqual(
      await registry.affected(realmURL, record('A'), record('B')),
      [owner.ownerURL],
      'membership exit invalidates',
    );
    await db.withWriteLock(`tessar:${realmURL}`, async (tx) => {
      await registry.markDirty(tx!, realmURL, [owner.ownerURL], 3);
    });
    let { PgAdapter } = await import('@cardstack/postgres');
    let reopened = new PgAdapter();
    try {
      let afterRestart = new TessarQueryRegistry(reopened, engine);
      assert.deepEqual(
        await afterRestart.pending(realmURL),
        [{ ownerURL: owner.ownerURL, generation: 3 }],
        'dirty work is durable',
      );
      await reopened.withWriteLock(`tessar:${realmURL}`, async (tx) => {
        assert.false(
          await afterRestart.publish(tx!, {
            ...owner,
            generation: 2,
            inputGeneration: 2,
          }),
          'racing stale publication is rejected',
        );
        assert.true(
          await afterRestart.publish(tx!, {
            ...owner,
            generation: 3,
            inputGeneration: 3,
          }),
        );
      });
      assert.deepEqual(await afterRestart.pending(realmURL), []);
    } finally {
      await reopened.close();
    }
  });
});
