import { waitUntil } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { meta, rri } from '@cardstack/runtime-common';

import { testRealmURL } from '../helpers';
import {
  setupBaseRealm,
  CardDef,
  contains,
  containsMany,
  linksToMany,
  field,
  StringField,
  getDataBucket,
} from '../helpers/base-realm';
import { setupRenderingTest } from '../helpers/setup';

module('Integration | Lattice query readiness', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);

  for (let scenario of [
    'populated',
    'confirmed empty',
    'partial',
    'unknown count',
    'failed target',
    'superseded load',
  ]) {
    test(`dependent queries require a ready roster: ${scenario}`, async function (assert) {
      let loader = getService('loader-service').loader;
      let api = await getService('card-service').getAPI();
      class Person extends CardDef {
        @field name = contains(StringField);
      }
      class Room extends CardDef {
        @field students = linksToMany(Person);
      }
      class Goal extends CardDef {
        @field studentId = contains(StringField);
      }
      class Summary extends CardDef {
        static materialized = true;
        @field rooms = linksToMany(Room, { query: {} });
        @field rosterIds = containsMany(StringField, {
          computeVia: function (this: Summary) {
            return Array.from(this.rooms[0]?.students ?? []).map(
              (student) => student.id,
            );
          },
        });
        @field goals = linksToMany(Goal, {
          query: { filter: { in: { studentId: '$this.rosterIds' } } },
        });
        @field slow = linksToMany(Goal, {
          query: { filter: { eq: { studentId: 'slow' } } },
        });
      }
      loader.shimModule(`${testRealmURL}lattice-readiness`, {
        Person,
        Room,
        Goal,
        Summary,
      });
      let summary = new Summary();
      summary.id = rri(`${testRealmURL}Summary/one`);
      (summary as any)[meta] = {
        realmURL: testRealmURL,
        adoptsFrom: {
          module: rri(`${testRealmURL}lattice-readiness`),
          name: 'Summary',
        },
      };
      let person = new Person({ name: 'Synthetic member' });
      person.id = rri(`${testRealmURL}Person/one`);
      let room = new Room({
        students: scenario === 'confirmed empty' ? [] : [person],
      });
      let release!: () => void;
      let gate = new Promise<void>((resolve) => (release = resolve));
      let releaseSlow!: () => void;
      let slowGate = new Promise<void>((resolve) => (releaseSlow = resolve));
      let releaseReplacement!: () => void;
      let replacementGate = new Promise<void>(
        (resolve) => (releaseReplacement = resolve),
      );
      let replaced = false;
      let store = api.getStore(summary);
      let original = store.getSearchResource;
      let queries: any[] = [];
      let roomResult = {
        instances: [] as Room[],
        instancesByRealm: [],
        isLoading: true,
        totalMatchCount: undefined as number | undefined,
        isPartial: false,
        meta: { page: { total: 0 } },
        pendingLoad: undefined as Promise<void> | undefined,
      };
      let complete = {
        instances: [],
        instancesByRealm: [],
        isLoading: false,
        totalMatchCount: 0,
        isPartial: false,
        meta: { page: { total: 0 } },
      };
      let slowResult = { ...complete, isLoading: true, pendingLoad: slowGate };
      store.getSearchResource = (_parent, getQuery) => {
        let query = getQuery();
        queries.push(query);
        if (
          query?.filter &&
          'eq' in query.filter &&
          query.filter.eq.studentId === 'slow'
        ) {
          slowResult.pendingLoad = slowGate.then(() => {
            slowResult.isLoading = false;
          });
          store.trackLoad(slowResult.pendingLoad);
          return slowResult as any;
        }
        if (queries.length === 1) {
          let settleRoom = () => {
            roomResult.instances = [room];
            roomResult.totalMatchCount = 1;
            roomResult.meta.page.total = 1;
            roomResult.isLoading = false;
            if (scenario === 'partial') {
              roomResult.totalMatchCount = 2;
              roomResult.isPartial = true;
            } else if (scenario === 'unknown count') {
              roomResult.totalMatchCount = undefined;
            } else if (scenario === 'failed target') {
              getDataBucket(room).set('students', [
                {
                  type: 'link-error',
                  reference: `${testRealmURL}Person/failed`,
                  errorDoc: {
                    status: 500,
                    message: 'roster input failed',
                    additionalErrors: null,
                  },
                },
              ]);
            }
          };
          roomResult.pendingLoad = gate.then(() => {
            if (scenario === 'superseded load') {
              roomResult.pendingLoad = replacementGate.then(settleRoom);
              store.trackLoad(roomResult.pendingLoad);
              replaced = true;
            } else {
              settleRoom();
            }
          });
          store.trackLoad(roomResult.pendingLoad);
          return roomResult as any;
        }
        return complete as any;
      };
      let globals = globalThis as any;
      let priorContext = globals.__boxelRenderContext;
      let priorSnapshot = globals.__latticeInputSnapshot;
      globals.__boxelRenderContext = true;
      globals.__latticeInputSnapshot = {
        realmURL: testRealmURL,
        generation: 1,
      };
      let prepared: Promise<void> | undefined;
      let preparationComplete = false;
      try {
        prepared = api
          .updateFromSerialized(
            summary,
            {
              data: {
                id: summary.id,
                type: 'card',
                attributes: {},
                meta: (summary as any)[meta],
              },
            },
            store,
          )
          .then(() => api.preparePublicationQueries(summary));
        void prepared.then(
          () => {
            preparationComplete = true;
          },
          () => {},
        );
        await Promise.race([waitUntil(() => queries.length >= 2), prepared]);
        assert.strictEqual(
          queries.length,
          2,
          'the prerequisite and independent query start while roster inputs are held',
        );
        let readiness = await loader.import<
          typeof import('@cardstack/base/field-support')
        >('@cardstack/base/field-support');
        api.beginComputePass();
        try {
          assert.deepEqual(
            summary.rosterIds,
            [],
            'an ordinary pending read can return a placeholder',
          );
          assert.throws(
            () =>
              readiness.readLatticeQueryInputs(
                summary,
                api.getFields(summary).goals!,
                () => summary.rosterIds,
              ),
            /waiting for its input relationships/,
            'a computed memo cannot disguise pending query inputs as ready',
          );
        } finally {
          api.endComputePass();
        }
        release();
        if (scenario === 'superseded load') {
          await waitUntil(() => replaced);
          assert.strictEqual(
            queries.length,
            2,
            'an obsolete completion cannot release the dependent query',
          );
          assert.false(preparationComplete);
          releaseReplacement();
        }
        if (
          scenario === 'partial' ||
          scenario === 'unknown count' ||
          scenario === 'failed target'
        ) {
          releaseSlow();
          let expected =
            scenario === 'partial'
              ? /incomplete membership/
              : scenario === 'unknown count'
                ? /inputs did not settle/
                : /roster input failed/;
          await assert.rejects(prepared, expected);
          assert.strictEqual(
            queries.length,
            2,
            'invalid inputs never start a dependent search',
          );
        } else {
          await waitUntil(() => queries.length === 3);
          assert.true(
            slowResult.isLoading,
            'dependent work starts while the unrelated query is still held',
          );
          assert.false(
            preparationComplete,
            'publication still waits for all required input work',
          );
          releaseSlow();
          await prepared;
          assert.strictEqual(
            queries.length,
            3,
            'the dependent query starts exactly once after readiness',
          );
          assert.deepEqual(
            queries[2].filter.in.studentId,
            scenario === 'confirmed empty' ? [] : [person.id],
          );
          let document = api.serializeCard(summary, {
            includeComputeds: true,
            omitQueryFields: true,
          });
          let manifest = api.publicationManifest(summary, document, 1);
          assert.strictEqual(
            manifest?.watches.length,
            3,
            'even a confirmed empty predicate is registered',
          );
          let membership = document.data.relationships?.goals;
          assert.false(Array.isArray(membership));
          let data = Array.isArray(membership) ? undefined : membership?.data;
          assert.deepEqual(
            data,
            [],
            'empty result membership is authoritative',
          );
        }
      } finally {
        release();
        releaseSlow();
        releaseReplacement();
        await prepared?.catch(() => {});
        store.getSearchResource = original;
        globals.__boxelRenderContext = priorContext;
        globals.__latticeInputSnapshot = priorSnapshot;
      }
    });
  }

  test('nested readiness capture and exceptions cannot leak into unrelated reads', async function (assert) {
    let loader = getService('loader-service').loader;
    let api = await getService('card-service').getAPI();
    let readiness = await loader.import<
      typeof import('@cardstack/base/field-support')
    >('@cardstack/base/field-support');
    class Input extends CardDef {}
    class Owner extends CardDef {
      @field inputs = linksToMany(Input);
      @field peers = linksToMany(Input);
    }
    let owner = new Owner();
    let fields = api.getFields(owner);
    assert.throws(
      () =>
        readiness.readLatticeQueryInputs(owner, fields.inputs!, () => {
          readiness.readLatticeQueryInputs(owner, fields.peers!, () => {
            readiness.readLatticeQueryInputs(owner, fields.inputs!, () => 0);
          });
        }),
      /dependency cycle/,
    );
    assert.false(readiness.isReadingLatticeQueryInputs());
    assert.strictEqual(
      readiness.readLatticeQueryInputs(owner, fields.inputs!, () => 7),
      7,
    );
    assert.throws(
      () =>
        readiness.readLatticeQueryInputs(owner, fields.inputs!, () => {
          throw new Error('ready input failure');
        }),
      /ready input failure/,
    );
    assert.false(readiness.isReadingLatticeQueryInputs());
  });
});
