import { render } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import {
  PermissionsContextName,
  baseRealm,
  type Permissions,
  type SerializedError,
} from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common/loader';

import type { RelationshipState as RelationshipStateType } from 'https://cardstack.com/base/card-api';

import {
  provideConsumeContext,
  saveCard,
  setupCardLogs,
  setupLocalIndexing,
  testRealmURL,
} from '../../helpers';
import {
  CardDef,
  contains,
  field,
  getDataBucket,
  getRelationship,
  linksTo,
  linksToMany,
  relationshipMeta,
  setupBaseRealm,
  StringField,
} from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

type RelationshipState = RelationshipStateType;
type NotLoadedSentinel = { type: 'not-loaded'; reference: string };
type LinkErrorSentinel = {
  type: 'link-error';
  reference: string;
  errorDoc: SerializedError;
};
type LinkNotFoundSentinel = {
  type: 'link-not-found';
  reference: string;
  errorDoc: SerializedError;
};

function errorDoc(message: string, status = 500): SerializedError {
  return {
    status,
    message,
    additionalErrors: null,
  };
}

function assertSingular(
  assert: Assert,
  state: RelationshipState | RelationshipState[],
): asserts state is RelationshipState {
  assert.notOk(
    Array.isArray(state),
    'singular linksTo returns one state, not an array',
  );
  if (Array.isArray(state)) {
    throw new Error('expected singular state');
  }
}

function assertKind<K extends RelationshipState['kind']>(
  assert: Assert,
  state: RelationshipState,
  kind: K,
): asserts state is Extract<RelationshipState, { kind: K }> {
  assert.strictEqual(state.kind, kind, `expected kind '${kind}'`);
  if (state.kind !== kind) {
    throw new Error(`expected kind ${kind} but got ${state.kind}`);
  }
}

function assertPlural(
  assert: Assert,
  state: RelationshipState | RelationshipState[],
): asserts state is RelationshipState[] {
  assert.ok(Array.isArray(state), 'plural linksToMany returns an array');
  if (!Array.isArray(state)) {
    throw new Error('expected plural state');
  }
}

module('Integration | getRelationship', function (hooks) {
  let loader: Loader;

  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  setupLocalIndexing(hooks);

  setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });

  hooks.beforeEach(async function () {
    let permissions: Permissions = { canWrite: true, canRead: true };
    provideConsumeContext(PermissionsContextName, permissions);
    loader = getService('loader-service').loader;
  });

  setupCardLogs(
    hooks,
    async () => await loader.import(`${baseRealm.url}card-api`),
  );

  module('singular linksTo', function () {
    test("returns kind 'present' for a loaded linked card", async function (assert) {
      class Pet extends CardDef {
        @field firstName = contains(StringField);
      }
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field pet = linksTo(Pet);
      }
      loader.shimModule(`${testRealmURL}test-cards`, { Person, Pet });

      let pet = new Pet({ firstName: 'Mango' });
      await saveCard(pet, `${testRealmURL}Pet/mango`, loader);
      let person = new Person({ firstName: 'Hassan', pet });

      let state = getRelationship(person, 'pet');
      assertSingular(assert, state);
      assertKind(assert, state, 'present');
      assert.true(state.isLoaded);
      assert.false(state.isError);
      assert.strictEqual(state.value, pet);
      assert.strictEqual(state.reference, `${testRealmURL}Pet/mango`);
    });

    test("returns kind 'not-set' when the field has never been assigned", async function (assert) {
      class Pet extends CardDef {
        @field firstName = contains(StringField);
      }
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field pet = linksTo(Pet);
      }
      loader.shimModule(`${testRealmURL}test-cards`, { Person, Pet });

      let person = new Person({ firstName: 'Hassan' });
      let state = getRelationship(person, 'pet');
      assertSingular(assert, state);
      assertKind(assert, state, 'not-set');
      assert.false(state.isLoaded);
      assert.false(state.isError);
      assert.strictEqual(state.value, undefined);
      assert.strictEqual(state.reference, undefined);
    });

    test("returns kind 'not-loaded' when the data bucket holds a not-loaded sentinel", async function (assert) {
      class Pet extends CardDef {
        @field firstName = contains(StringField);
      }
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field pet = linksTo(Pet);
      }
      loader.shimModule(`${testRealmURL}test-cards`, { Person, Pet });

      let person = new Person({ firstName: 'Hassan' });
      let sentinel: NotLoadedSentinel = {
        type: 'not-loaded',
        reference: `${testRealmURL}Pet/mango`,
      };
      getDataBucket(person).set('pet', sentinel);

      let state = getRelationship(person, 'pet');
      assertSingular(assert, state);
      assertKind(assert, state, 'not-loaded');
      assert.false(state.isLoaded);
      assert.false(state.isError);
      assert.strictEqual(state.value, undefined);
      assert.strictEqual(state.reference, `${testRealmURL}Pet/mango`);
    });

    test("returns kind 'error' when the data bucket holds a link-error sentinel", async function (assert) {
      class Pet extends CardDef {
        @field firstName = contains(StringField);
      }
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field pet = linksTo(Pet);
      }
      loader.shimModule(`${testRealmURL}test-cards`, { Person, Pet });

      let person = new Person({ firstName: 'Hassan' });
      let doc = errorDoc('upstream pet exploded');
      let sentinel: LinkErrorSentinel = {
        type: 'link-error',
        reference: `${testRealmURL}Pet/exploded`,
        errorDoc: doc,
      };
      getDataBucket(person).set('pet', sentinel);

      let state = getRelationship(person, 'pet');
      assertSingular(assert, state);
      assertKind(assert, state, 'error');
      assert.false(state.isLoaded);
      assert.true(state.isError);
      assert.strictEqual(state.value, undefined);
      assert.strictEqual(state.reference, `${testRealmURL}Pet/exploded`);
      assert.strictEqual(state.errorDoc, doc);
    });

    test("returns kind 'not-found' when the data bucket holds a link-not-found sentinel", async function (assert) {
      class Pet extends CardDef {
        @field firstName = contains(StringField);
      }
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field pet = linksTo(Pet);
      }
      loader.shimModule(`${testRealmURL}test-cards`, { Person, Pet });

      let person = new Person({ firstName: 'Hassan' });
      let doc = errorDoc('not found', 404);
      let sentinel: LinkNotFoundSentinel = {
        type: 'link-not-found',
        reference: `${testRealmURL}Pet/missing`,
        errorDoc: doc,
      };
      getDataBucket(person).set('pet', sentinel);

      let state = getRelationship(person, 'pet');
      assertSingular(assert, state);
      assertKind(assert, state, 'not-found');
      assert.false(state.isLoaded);
      assert.true(state.isError);
      assert.strictEqual(state.value, undefined);
      assert.strictEqual(state.reference, `${testRealmURL}Pet/missing`);
      assert.strictEqual(state.errorDoc, doc);
    });
  });

  module('plural linksToMany', function () {
    test('returns an array with one state per element across all five kinds', async function (assert) {
      class Pet extends CardDef {
        @field firstName = contains(StringField);
      }
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field pets = linksToMany(Pet);
      }
      loader.shimModule(`${testRealmURL}test-cards`, { Person, Pet });

      let mango = new Pet({ firstName: 'Mango' });
      await saveCard(mango, `${testRealmURL}Pet/mango`, loader);
      let person = new Person({ firstName: 'Hassan', pets: [mango] });

      let errDoc = errorDoc('boom');
      let notFoundDoc = errorDoc('missing', 404);
      let pets = getDataBucket(person).get('pets');
      assert.ok(Array.isArray(pets), 'pets bucket entry is an array');
      pets.push({
        type: 'not-loaded',
        reference: `${testRealmURL}Pet/vangogh`,
      } satisfies NotLoadedSentinel);
      pets.push({
        type: 'link-error',
        reference: `${testRealmURL}Pet/exploded`,
        errorDoc: errDoc,
      } satisfies LinkErrorSentinel);
      pets.push({
        type: 'link-not-found',
        reference: `${testRealmURL}Pet/missing`,
        errorDoc: notFoundDoc,
      } satisfies LinkNotFoundSentinel);

      let states = getRelationship(person, 'pets');
      assertPlural(assert, states);
      assert.strictEqual(states.length, 4);

      let [s0, s1, s2, s3] = states;
      assertKind(assert, s0, 'present');
      assert.strictEqual(s0.value, mango);
      assert.strictEqual(s0.reference, `${testRealmURL}Pet/mango`);

      assertKind(assert, s1, 'not-loaded');
      assert.strictEqual(s1.reference, `${testRealmURL}Pet/vangogh`);

      assertKind(assert, s2, 'error');
      assert.strictEqual(s2.reference, `${testRealmURL}Pet/exploded`);
      assert.strictEqual(s2.errorDoc, errDoc);

      assertKind(assert, s3, 'not-found');
      assert.strictEqual(s3.reference, `${testRealmURL}Pet/missing`);
      assert.strictEqual(s3.errorDoc, notFoundDoc);
    });

    test("returns an empty array for a never-set linksToMany ('not-set' equivalent for plural)", async function (assert) {
      class Pet extends CardDef {
        @field firstName = contains(StringField);
      }
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field pets = linksToMany(Pet);
      }
      loader.shimModule(`${testRealmURL}test-cards`, { Person, Pet });

      let person = new Person({ firstName: 'Hassan' });
      let states = getRelationship(person, 'pets');
      assertPlural(assert, states);
      assert.strictEqual(states.length, 0);
    });
  });

  module('relationshipMeta back-compat wrapper', function () {
    test("legacy envelope: present → { type: 'loaded', card }", async function (assert) {
      class Pet extends CardDef {
        @field firstName = contains(StringField);
      }
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field pet = linksTo(Pet);
      }
      loader.shimModule(`${testRealmURL}test-cards`, { Person, Pet });

      let pet = new Pet({ firstName: 'Mango' });
      await saveCard(pet, `${testRealmURL}Pet/mango`, loader);
      let person = new Person({ firstName: 'Hassan', pet });

      let meta = relationshipMeta(person, 'pet');
      if (!meta || Array.isArray(meta)) {
        assert.ok(false, 'expected singular legacy meta');
      } else if (meta.type === 'loaded') {
        assert.strictEqual(meta.card, pet);
      } else {
        assert.ok(false, `expected type 'loaded' but got ${meta.type}`);
      }
    });

    test("legacy envelope: not-set → { type: 'loaded', card: null }", async function (assert) {
      class Pet extends CardDef {
        @field firstName = contains(StringField);
      }
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field pet = linksTo(Pet);
      }
      loader.shimModule(`${testRealmURL}test-cards`, { Person, Pet });

      let person = new Person({ firstName: 'Hassan' });
      let meta = relationshipMeta(person, 'pet');
      if (!meta || Array.isArray(meta)) {
        assert.ok(false, 'expected singular legacy meta');
      } else if (meta.type === 'loaded') {
        assert.strictEqual(meta.card, null);
      } else {
        assert.ok(false, `expected type 'loaded' but got ${meta.type}`);
      }
    });

    test("legacy envelope: not-loaded → { type: 'not-loaded', reference }", async function (assert) {
      class Pet extends CardDef {
        @field firstName = contains(StringField);
      }
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field pet = linksTo(Pet);
      }
      loader.shimModule(`${testRealmURL}test-cards`, { Person, Pet });

      let person = new Person({ firstName: 'Hassan' });
      getDataBucket(person).set('pet', {
        type: 'not-loaded',
        reference: `${testRealmURL}Pet/mango`,
      } satisfies NotLoadedSentinel);

      let meta = relationshipMeta(person, 'pet');
      if (!meta || Array.isArray(meta)) {
        assert.ok(false, 'expected singular legacy meta');
      } else if (meta.type === 'not-loaded') {
        assert.strictEqual(meta.reference, `${testRealmURL}Pet/mango`);
      } else {
        assert.ok(false, `expected type 'not-loaded' but got ${meta.type}`);
      }
    });

    test("legacy envelope: error / not-found collapse to 'not-loaded' so existing branches stay stable", async function (assert) {
      class Pet extends CardDef {
        @field firstName = contains(StringField);
      }
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field pet = linksTo(Pet);
      }
      loader.shimModule(`${testRealmURL}test-cards`, { Person, Pet });

      let person = new Person({ firstName: 'Hassan' });
      getDataBucket(person).set('pet', {
        type: 'link-error',
        reference: `${testRealmURL}Pet/exploded`,
        errorDoc: errorDoc('boom'),
      } satisfies LinkErrorSentinel);

      let meta = relationshipMeta(person, 'pet');
      if (!meta || Array.isArray(meta)) {
        assert.ok(false, 'expected singular legacy meta for error');
      } else {
        assert.strictEqual(
          meta.type,
          'not-loaded',
          'error sentinel maps to legacy not-loaded',
        );
      }

      getDataBucket(person).set('pet', {
        type: 'link-not-found',
        reference: `${testRealmURL}Pet/missing`,
        errorDoc: errorDoc('missing', 404),
      } satisfies LinkNotFoundSentinel);

      meta = relationshipMeta(person, 'pet');
      if (!meta || Array.isArray(meta)) {
        assert.ok(false, 'expected singular legacy meta for not-found');
      } else {
        assert.strictEqual(
          meta.type,
          'not-loaded',
          'not-found sentinel maps to legacy not-loaded',
        );
      }
    });

    test('returns undefined for non-linksTo/linksToMany fields', async function (assert) {
      class Person extends CardDef {
        @field firstName = contains(StringField);
      }
      loader.shimModule(`${testRealmURL}test-cards`, { Person });
      let person = new Person({ firstName: 'Hassan' });
      assert.strictEqual(relationshipMeta(person, 'firstName'), undefined);
    });
  });

  module('purity guarantees', function () {
    test('does not trigger lazilyLoadLink: the not-loaded sentinel survives the read intact', async function (assert) {
      class Pet extends CardDef {
        @field firstName = contains(StringField);
      }
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field pet = linksTo(Pet);
      }
      loader.shimModule(`${testRealmURL}test-cards`, { Person, Pet });

      let person = new Person({ firstName: 'Hassan' });
      let sentinel: NotLoadedSentinel = {
        type: 'not-loaded',
        reference: `${testRealmURL}Pet/never-fetched`,
      };
      getDataBucket(person).set('pet', sentinel);

      // Repeated reads should not mutate the bucket entry — lazilyLoadLink
      // would replace it (or, for linksToMany, set a `.loading` flag on the
      // sentinel). Sentinel identity preserved == no fetch was kicked off.
      getRelationship(person, 'pet');
      getRelationship(person, 'pet');
      getRelationship(person, 'pet');

      assert.strictEqual(
        getDataBucket(person).get('pet'),
        sentinel,
        'bucket entry is the same sentinel object after three reads',
      );
      assert.notOk(
        (sentinel as { loading?: boolean }).loading,
        'sentinel has no `.loading` flag — lazy loader was not invoked',
      );
    });

    test('does not trigger lazilyLoadLink for linksToMany either', async function (assert) {
      class Pet extends CardDef {
        @field firstName = contains(StringField);
      }
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field pets = linksToMany(Pet);
      }
      loader.shimModule(`${testRealmURL}test-cards`, { Person, Pet });

      let person = new Person({ firstName: 'Hassan' });
      // Seed the WatchedArray that linksToMany.emptyValue() returns by reading
      // once through getRelationship (which uses peekAtField), then push
      // sentinels directly so the test stays hermetic.
      getRelationship(person, 'pets');
      let pets = getDataBucket(person).get('pets');
      let sentinelA: NotLoadedSentinel = {
        type: 'not-loaded',
        reference: `${testRealmURL}Pet/a`,
      };
      let sentinelB: NotLoadedSentinel = {
        type: 'not-loaded',
        reference: `${testRealmURL}Pet/b`,
      };
      pets.push(sentinelA, sentinelB);

      getRelationship(person, 'pets');
      getRelationship(person, 'pets');

      assert.notOk(
        (sentinelA as { loading?: boolean }).loading,
        'sentinelA has no `.loading` flag',
      );
      assert.notOk(
        (sentinelB as { loading?: boolean }).loading,
        'sentinelB has no `.loading` flag',
      );
    });

    test('repeated reads inside a render cause exactly one render — pure read, no extra invalidations', async function (assert) {
      class Pet extends CardDef {
        @field firstName = contains(StringField);
      }
      let renderCount = 0;
      let bump = () => {
        renderCount++;
        return '';
      };
      let stateKind = (s: ReturnType<typeof getRelationship>) =>
        Array.isArray(s) ? s.map((x) => x.kind).join(',') : s.kind;

      let mango = new Pet({ firstName: 'Mango' });

      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field pet = linksTo(Pet);
      }
      let person = new Person({ firstName: 'Hassan', pet: mango });
      await saveCard(mango, `${testRealmURL}Pet/mango`, loader);

      await render(
        <template>
          <span>{{bump}}</span>
          <span data-test-a>{{stateKind (getRelationship person 'pet')}}</span>
          <span data-test-b>{{stateKind (getRelationship person 'pet')}}</span>
          <span data-test-c>{{stateKind (getRelationship person 'pet')}}</span>
        </template>,
      );

      assert
        .dom('[data-test-a]')
        .hasText('present', 'first read renders present');
      assert
        .dom('[data-test-b]')
        .hasText('present', 'second read renders present');
      assert
        .dom('[data-test-c]')
        .hasText('present', 'third read renders present');
      assert.strictEqual(
        renderCount,
        1,
        'three getRelationship reads in one render frame did not schedule re-renders',
      );
    });
  });

  module('error cases', function () {
    test('throws when the field does not exist', async function (assert) {
      class Person extends CardDef {
        @field firstName = contains(StringField);
      }
      loader.shimModule(`${testRealmURL}test-cards`, { Person });
      let person = new Person({ firstName: 'Hassan' });
      assert.throws(
        () => getRelationship(person, 'pet'),
        /does not have a field 'pet'/,
      );
    });

    test('throws when the field is not a linksTo / linksToMany', async function (assert) {
      class Person extends CardDef {
        @field firstName = contains(StringField);
      }
      loader.shimModule(`${testRealmURL}test-cards`, { Person });
      let person = new Person({ firstName: 'Hassan' });
      assert.throws(
        () => getRelationship(person, 'firstName'),
        /requires a 'linksTo' or 'linksToMany' field/,
      );
    });
  });
});
