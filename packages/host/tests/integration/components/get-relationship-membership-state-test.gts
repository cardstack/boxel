import { render } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import {
  PermissionsContextName,
  localId,
  type Permissions,
  type SerializedError,
} from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common/loader';

import {
  provideConsumeContext,
  saveCard,
  setupCardLogs,
  setupLocalIndexing,
  testRealmURL,
} from '../../helpers';
import {
  CardDef,
  FieldDef,
  contains,
  field,
  getBrokenLinks,
  getDataBucket,
  getRelationshipMembershipState,
  linksTo,
  linksToMany,
  setupBaseRealm,
  StringField,
} from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

import type {
  RelationshipState as RelationshipStateType,
  RelationshipStatus as RelationshipStatusType,
} from '@cardstack/base/card-api';

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

// A singular `linksTo` resolves to a one-element membership; return that member.
function singleMember(
  assert: Assert,
  rel: RelationshipStatusType,
): RelationshipState {
  let membership = rel.membership;
  assert.strictEqual(
    membership?.length,
    1,
    'singular linksTo returns a one-element membership',
  );
  if (!membership || membership.length !== 1) {
    throw new Error('expected a one-element membership');
  }
  return membership[0];
}

// The per-element membership of a `linksToMany` (an array; `undefined` only
// while a query-backed search is in flight).
function members(rel: RelationshipStatusType): RelationshipState[] {
  return rel.membership ?? [];
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

module('Integration | getRelationshipMembershipState', function (hooks) {
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
    async () => await loader.import('@cardstack/base/card-api'),
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

      let state = singleMember(
        assert,
        getRelationshipMembershipState(person, 'pet'),
      );
      assertKind(assert, state, 'present');
      assert.strictEqual(state.value, pet);
      assert.strictEqual(state.reference, `${testRealmURL}Pet/mango`);
    });

    test("returns kind 'present' with the local id as reference when the linked card is unsaved", async function (assert) {
      // Unsaved CardDef instances have a localId but no URL `id` until saveCard
      // runs. getRelationshipMembershipState reports them as 'present' with the local id as
      // the reference — the store's identity map correlates that local id to
      // the remote URL once the server assigns one, so it stays resolvable.
      class Pet extends CardDef {
        @field firstName = contains(StringField);
      }
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field pet = linksTo(Pet);
      }
      loader.shimModule(`${testRealmURL}test-cards`, { Person, Pet });

      let unsavedPet = new Pet({ firstName: 'Mango' });
      let person = new Person({ firstName: 'Hassan', pet: unsavedPet });

      let state = singleMember(
        assert,
        getRelationshipMembershipState(person, 'pet'),
      );
      assertKind(assert, state, 'present');
      assert.strictEqual(state.value, unsavedPet);
      assert.strictEqual(
        state.reference,
        unsavedPet[localId],
        'unsaved linked card uses its local id as the reference',
      );
      assert.strictEqual(
        typeof state.reference,
        'string',
        'reference is always a string for present',
      );
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
      let state = singleMember(
        assert,
        getRelationshipMembershipState(person, 'pet'),
      );
      assertKind(assert, state, 'not-set');
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

      let state = singleMember(
        assert,
        getRelationshipMembershipState(person, 'pet'),
      );
      assertKind(assert, state, 'not-loaded');
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

      let state = singleMember(
        assert,
        getRelationshipMembershipState(person, 'pet'),
      );
      assertKind(assert, state, 'error');
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

      let state = singleMember(
        assert,
        getRelationshipMembershipState(person, 'pet'),
      );
      assertKind(assert, state, 'not-found');
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

      let states = members(getRelationshipMembershipState(person, 'pets'));
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
      let states = members(getRelationshipMembershipState(person, 'pets'));
      assert.strictEqual(states.length, 0);
    });

    test('whole-field sentinel (computed linksToMany unresolved upstream) surfaces as a one-element array', async function (assert) {
      class Pet extends CardDef {
        @field firstName = contains(StringField);
      }
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field pets = linksToMany(Pet);
      }
      loader.shimModule(`${testRealmURL}test-cards`, { Person, Pet });

      let person = new Person({ firstName: 'Hassan' });
      let sentinel: NotLoadedSentinel = {
        type: 'not-loaded',
        reference: `${testRealmURL}upstream/computed-source`,
      };
      getDataBucket(person).set('pets', sentinel);

      let states = members(getRelationshipMembershipState(person, 'pets'));
      assert.strictEqual(states.length, 1);
      assertKind(assert, states[0], 'not-loaded');
      assert.strictEqual(
        states[0].reference,
        `${testRealmURL}upstream/computed-source`,
      );
    });
  });

  // A computed `linksTo` / `linksToMany` derives from already-materialized
  // declared fields, so it never lazily loads: `isLoading` is always false and
  // there is no `not-loaded` state — only `present` (running instances) or
  // `not-set` (the compute resolved to nothing). Otherwise it behaves exactly
  // like the non-computed forms.
  module('computed relationships', function () {
    test('computed linksTo: present member, never loading', async function (assert) {
      class Pet extends CardDef {
        @field firstName = contains(StringField);
      }
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field pet = linksTo(Pet);
        @field petAlias = linksTo(Pet, {
          computeVia: function (this: Person) {
            return this.pet;
          },
        });
      }
      loader.shimModule(`${testRealmURL}test-cards`, { Person, Pet });

      let pet = new Pet({ firstName: 'Mango' });
      await saveCard(pet, `${testRealmURL}Pet/mango`, loader);
      let person = new Person({ firstName: 'Hassan', pet });

      let rel = getRelationshipMembershipState(person, 'petAlias');
      assert.false(rel.isLoading, 'a computed linksTo never reports loading');
      let state = singleMember(assert, rel);
      assertKind(assert, state, 'present');
      assert.strictEqual(state.value, pet);
      assert.strictEqual(state.reference, `${testRealmURL}Pet/mango`);
    });

    test('computed linksToMany: every member present, never loading', async function (assert) {
      class Pet extends CardDef {
        @field firstName = contains(StringField);
      }
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field pets = linksToMany(Pet);
        @field petsAlias = linksToMany(Pet, {
          computeVia: function (this: Person) {
            return this.pets;
          },
        });
      }
      loader.shimModule(`${testRealmURL}test-cards`, { Person, Pet });

      let mango = new Pet({ firstName: 'Mango' });
      let vangogh = new Pet({ firstName: 'Van Gogh' });
      await saveCard(mango, `${testRealmURL}Pet/mango`, loader);
      await saveCard(vangogh, `${testRealmURL}Pet/vangogh`, loader);
      let person = new Person({ firstName: 'Hassan', pets: [mango, vangogh] });

      let rel = getRelationshipMembershipState(person, 'petsAlias');
      assert.false(
        rel.isLoading,
        'a computed linksToMany never reports loading',
      );
      let states = members(rel);
      assert.deepEqual(
        states.map((s) => s.kind),
        ['present', 'present'],
        'every computed element is present',
      );
      assert.deepEqual(
        states.map((s) => s.value),
        [mango, vangogh],
        'computed elements carry the running instances',
      );
    });

    test('computed linksTo resolving to nothing is not-set, still not loading', async function (assert) {
      class Pet extends CardDef {
        @field firstName = contains(StringField);
      }
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field maybePet = linksTo(Pet, {
          computeVia: function (this: Person) {
            return undefined;
          },
        });
      }
      loader.shimModule(`${testRealmURL}test-cards`, { Person, Pet });

      let person = new Person({ firstName: 'Hassan' });
      let rel = getRelationshipMembershipState(person, 'maybePet');
      assert.false(rel.isLoading);
      let state = singleMember(assert, rel);
      assertKind(assert, state, 'not-set');
    });
  });

  module('getBrokenLinks', function () {
    test('returns no findings when every declared link is present or unset', async function (assert) {
      class Pet extends CardDef {
        @field firstName = contains(StringField);
      }
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field pet = linksTo(Pet);
        @field pets = linksToMany(Pet);
      }
      loader.shimModule(`${testRealmURL}test-cards`, { Person, Pet });

      let mango = new Pet({ firstName: 'Mango' });
      await saveCard(mango, `${testRealmURL}Pet/mango`, loader);
      let person = new Person({
        firstName: 'Hassan',
        pet: mango,
        pets: [mango],
      });

      assert.deepEqual(
        getBrokenLinks(person),
        [],
        'a present singular link, a present plural link, and unset links yield nothing',
      );
    });

    test('finds a singular linksTo in error state', async function (assert) {
      class Pet extends CardDef {
        @field firstName = contains(StringField);
      }
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field pet = linksTo(Pet);
      }
      loader.shimModule(`${testRealmURL}test-cards`, { Person, Pet });

      let person = new Person({ firstName: 'Hassan' });
      let doc = errorDoc('upstream exploded');
      getDataBucket(person).set('pet', {
        type: 'link-error',
        reference: `${testRealmURL}Pet/exploded`,
        errorDoc: doc,
      } satisfies LinkErrorSentinel);

      let findings = getBrokenLinks(person);
      assert.strictEqual(findings.length, 1, 'one finding');
      assert.strictEqual(findings[0].fieldName, 'pet');
      assert.strictEqual(findings[0].kind, 'error');
      assert.strictEqual(findings[0].reference, `${testRealmURL}Pet/exploded`);
      assert.strictEqual(findings[0].errorDoc, doc);
    });

    test('finds a singular linksTo in not-found state', async function (assert) {
      class Pet extends CardDef {
        @field firstName = contains(StringField);
      }
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field pet = linksTo(Pet);
      }
      loader.shimModule(`${testRealmURL}test-cards`, { Person, Pet });

      let person = new Person({ firstName: 'Hassan' });
      let doc = errorDoc('missing', 404);
      getDataBucket(person).set('pet', {
        type: 'link-not-found',
        reference: `${testRealmURL}Pet/missing`,
        errorDoc: doc,
      } satisfies LinkNotFoundSentinel);

      let findings = getBrokenLinks(person);
      assert.strictEqual(findings.length, 1);
      assert.strictEqual(findings[0].fieldName, 'pet');
      assert.strictEqual(findings[0].kind, 'not-found');
      assert.strictEqual(findings[0].reference, `${testRealmURL}Pet/missing`);
      assert.strictEqual(findings[0].errorDoc, doc);
    });

    test('ignores a not-loaded (in-flight) link', async function (assert) {
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
        reference: `${testRealmURL}Pet/loading`,
      } satisfies NotLoadedSentinel);

      assert.deepEqual(
        getBrokenLinks(person),
        [],
        'a not-loaded slot is an in-flight fetch, not a terminal failure',
      );
    });

    test('plural: reports only the broken slots, one finding per slot, under the field name', async function (assert) {
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

      let findings = getBrokenLinks(person);
      assert.strictEqual(
        findings.length,
        2,
        'only the error and not-found slots are reported (present + not-loaded skipped)',
      );
      assert.deepEqual(
        findings.map((f) => f.fieldName),
        ['pets', 'pets'],
        'each finding carries the plural field name',
      );
      assert.deepEqual(findings.map((f) => f.kind).sort(), [
        'error',
        'not-found',
      ]);
      let errorFinding = findings.find((f) => f.kind === 'error');
      assert.strictEqual(
        errorFinding?.reference,
        `${testRealmURL}Pet/exploded`,
      );
      assert.strictEqual(errorFinding?.errorDoc, errDoc);
    });

    test('reports every broken declared field across a card', async function (assert) {
      class Pet extends CardDef {
        @field firstName = contains(StringField);
      }
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field pet = linksTo(Pet);
        @field pets = linksToMany(Pet);
      }
      loader.shimModule(`${testRealmURL}test-cards`, { Person, Pet });

      let person = new Person({ firstName: 'Hassan' });
      getDataBucket(person).set('pet', {
        type: 'link-not-found',
        reference: `${testRealmURL}Pet/missing`,
        errorDoc: errorDoc('missing', 404),
      } satisfies LinkNotFoundSentinel);
      getDataBucket(person).set('pets', [
        {
          type: 'link-error',
          reference: `${testRealmURL}Pet/exploded`,
          errorDoc: errorDoc('boom'),
        } satisfies LinkErrorSentinel,
      ]);

      let findings = getBrokenLinks(person);
      assert.deepEqual(
        findings.map((f) => f.fieldName).sort(),
        ['pet', 'pets'],
        'both the broken singular and plural fields are reported',
      );
    });

    test('skips computed relationship fields', async function (assert) {
      class Pet extends CardDef {
        @field firstName = contains(StringField);
      }
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field pet = linksTo(Pet);
        // A computed alias of the (broken) declared `pet`. The scan must report
        // the declared field only; computed fields are not scanned.
        @field petAlias = linksTo(Pet, {
          computeVia: function (this: Person) {
            return this.pet;
          },
        });
      }
      loader.shimModule(`${testRealmURL}test-cards`, { Person, Pet });

      let person = new Person({ firstName: 'Hassan' });
      getDataBucket(person).set('pet', {
        type: 'link-error',
        reference: `${testRealmURL}Pet/exploded`,
        errorDoc: errorDoc('upstream exploded'),
      } satisfies LinkErrorSentinel);

      let findings = getBrokenLinks(person);
      assert.deepEqual(
        findings.map((f) => f.fieldName),
        ['pet'],
        'only the declared field is reported, not the computed alias',
      );
    });

    test('recurses into a contained FieldDef and finds its broken linksTo', async function (assert) {
      class Pet extends CardDef {
        @field name = contains(StringField);
      }
      class Detail extends FieldDef {
        @field label = contains(StringField);
        @field pet = linksTo(Pet);
      }
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field detail = contains(Detail);
      }
      loader.shimModule(`${testRealmURL}test-cards`, { Person, Pet, Detail });

      let person = new Person({
        firstName: 'Hassan',
        detail: new Detail({ label: 'x' }),
      });
      let doc = errorDoc('upstream exploded');
      // Plant the sentinel on the contained FieldDef's own bucket — a contained
      // field has no index entry, so only recursion catches this.
      getDataBucket((person as any).detail).set('pet', {
        type: 'link-error',
        reference: `${testRealmURL}Pet/exploded`,
        errorDoc: doc,
      } satisfies LinkErrorSentinel);

      let findings = getBrokenLinks(person);
      assert.strictEqual(
        findings.length,
        1,
        'the contained broken link is found',
      );
      assert.strictEqual(findings[0].fieldName, 'pet');
      assert.strictEqual(findings[0].kind, 'error');
      assert.strictEqual(findings[0].reference, `${testRealmURL}Pet/exploded`);
      assert.strictEqual(findings[0].errorDoc, doc);
    });

    test('recurses into a present linked card and finds its broken linksTo', async function (assert) {
      class Pet extends CardDef {
        @field name = contains(StringField);
      }
      class Child extends CardDef {
        @field name = contains(StringField);
        @field pet = linksTo(Pet);
      }
      class Parent extends CardDef {
        @field name = contains(StringField);
        @field child = linksTo(Child);
      }
      loader.shimModule(`${testRealmURL}test-cards`, { Parent, Child, Pet });

      let child = new Child({ name: 'Child' });
      await saveCard(child, `${testRealmURL}Child/c`, loader);
      let parent = new Parent({ name: 'Parent', child });
      let doc = errorDoc('missing', 404);
      getDataBucket(child).set('pet', {
        type: 'link-not-found',
        reference: `${testRealmURL}Pet/missing`,
        errorDoc: doc,
      } satisfies LinkNotFoundSentinel);

      let findings = getBrokenLinks(parent);
      assert.strictEqual(
        findings.length,
        1,
        "the present linked child's broken link is found",
      );
      assert.strictEqual(findings[0].fieldName, 'pet');
      assert.strictEqual(findings[0].kind, 'not-found');
      assert.strictEqual(findings[0].reference, `${testRealmURL}Pet/missing`);
    });

    test('cycle protection: a present self-link does not loop', async function (assert) {
      class Pet extends CardDef {
        @field name = contains(StringField);
      }
      class Node extends CardDef {
        @field name = contains(StringField);
        @field self = linksTo(() => Node);
        @field pet = linksTo(Pet);
      }
      loader.shimModule(`${testRealmURL}test-cards`, { Node, Pet });

      let node = new Node({ name: 'Node' });
      await saveCard(node, `${testRealmURL}Node/n`, loader);
      // A present link back to itself (the cycle) plus one broken link.
      getDataBucket(node).set('self', node);
      getDataBucket(node).set('pet', {
        type: 'link-error',
        reference: `${testRealmURL}Pet/exploded`,
        errorDoc: errorDoc('boom'),
      } satisfies LinkErrorSentinel);

      let findings = getBrokenLinks(node);
      assert.strictEqual(
        findings.length,
        1,
        'the broken link is found exactly once; the self-cycle terminates',
      );
      assert.strictEqual(findings[0].fieldName, 'pet');
    });

    test('is a pure read: does not initialize absent fields in the data bucket', async function (assert) {
      class Pet extends CardDef {
        @field name = contains(StringField);
      }
      class Detail extends FieldDef {
        @field label = contains(StringField);
        @field pet = linksTo(Pet);
      }
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field bestFriend = linksTo(Pet);
        // Left unset on purpose — none of these may be materialized by the scan.
        @field pet = linksTo(Pet);
        @field pets = linksToMany(Pet);
        @field detail = contains(Detail);
      }
      loader.shimModule(`${testRealmURL}test-cards`, { Person, Pet, Detail });

      // Only firstName + a broken bestFriend are in the bucket; pet / pets /
      // detail are never touched.
      let person = new Person({ firstName: 'Hassan' });
      let bucket = getDataBucket(person);
      let bestFriend = {
        type: 'link-error',
        reference: `${testRealmURL}Pet/exploded`,
        errorDoc: errorDoc('boom'),
      } satisfies LinkErrorSentinel;
      bucket.set('bestFriend', bestFriend);

      let keysBefore = [...bucket.keys()].sort();

      let findings = getBrokenLinks(person);
      assert.strictEqual(findings.length, 1, 'finds the one broken link');
      assert.strictEqual(findings[0].fieldName, 'bestFriend');

      // The scan added nothing — absent linksTo / linksToMany / contains fields
      // were not initialized via the field getter's emptyValue.
      assert.deepEqual(
        [...bucket.keys()].sort(),
        keysBefore,
        'no new bucket entries: absent fields stay absent after the scan',
      );
      assert.false(bucket.has('pet'), 'unset singular linksTo not initialized');
      assert.false(bucket.has('pets'), 'unset linksToMany not initialized');
      assert.false(bucket.has('detail'), 'unset contains not initialized');
      // The entries that were present keep their identity — nothing replaced.
      assert.strictEqual(
        bucket.get('bestFriend'),
        bestFriend,
        'present sentinel entry is the same object after the scan',
      );
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
      getRelationshipMembershipState(person, 'pet');
      getRelationshipMembershipState(person, 'pet');
      getRelationshipMembershipState(person, 'pet');

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
      // once through getRelationshipMembershipState (which uses peekAtField), then push
      // sentinels directly so the test stays hermetic.
      getRelationshipMembershipState(person, 'pets');
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

      getRelationshipMembershipState(person, 'pets');
      getRelationshipMembershipState(person, 'pets');

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
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field pet = linksTo(Pet);
      }
      loader.shimModule(`${testRealmURL}test-cards`, { Person, Pet });

      let renderCount = 0;
      let bump = () => {
        renderCount++;
        return '';
      };
      let stateKind = (s: ReturnType<typeof getRelationshipMembershipState>) =>
        (s.membership ?? []).map((x) => x.kind).join(',');

      // 'not-set' is enough for the render-count contract — any kind exercises
      // the same template-side read path, and not-set needs no realm setup.
      let person = new Person({ firstName: 'Hassan' });

      await render(
        <template>
          <span>{{bump}}</span>
          <span data-test-a>{{stateKind
              (getRelationshipMembershipState person 'pet')
            }}</span>
          <span data-test-b>{{stateKind
              (getRelationshipMembershipState person 'pet')
            }}</span>
          <span data-test-c>{{stateKind
              (getRelationshipMembershipState person 'pet')
            }}</span>
        </template>,
      );

      assert
        .dom('[data-test-a]')
        .hasText('not-set', 'first read returns not-set');
      assert
        .dom('[data-test-b]')
        .hasText('not-set', 'second read returns not-set');
      assert
        .dom('[data-test-c]')
        .hasText('not-set', 'third read returns not-set');
      assert.strictEqual(
        renderCount,
        1,
        'three getRelationshipMembershipState reads in one render frame did not schedule re-renders',
      );
    });

    test('stability anchors: value and reference are stable across calls even though the envelope is fresh', async function (assert) {
      // Edit-mode component stability depends on consumers keying on the stable
      // `reference` string and binding inputs to the stable `value` card —
      // never to envelope identity. This locks in that those anchors are stable
      // across repeated reads while the envelope object intentionally is not.
      class Pet extends CardDef {
        @field firstName = contains(StringField);
      }
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field pets = linksToMany(Pet);
      }
      loader.shimModule(`${testRealmURL}test-cards`, { Person, Pet });

      let mango = new Pet({ firstName: 'Mango' });
      let vangogh = new Pet({ firstName: 'Van Gogh' });
      await saveCard(mango, `${testRealmURL}Pet/mango`, loader);
      await saveCard(vangogh, `${testRealmURL}Pet/vangogh`, loader);
      let person = new Person({
        firstName: 'Hassan',
        pets: [mango, vangogh],
      });

      let first = members(getRelationshipMembershipState(person, 'pets'));
      let second = members(getRelationshipMembershipState(person, 'pets'));

      assert.notStrictEqual(
        first,
        second,
        'the returned array is a fresh object each call',
      );
      assert.notStrictEqual(
        first[0],
        second[0],
        'each envelope is a fresh object each call',
      );

      // Stable anchors — these are what edit-mode templates must key/bind on.
      assert.strictEqual(
        first[0].value,
        second[0].value,
        'value (card instance) is identical across calls',
      );
      assert.strictEqual(
        first[0].value,
        mango,
        'value is the original card instance',
      );
      assert.strictEqual(
        first[0].reference,
        second[0].reference,
        'reference string is stable across calls',
      );
      assert.strictEqual(first[1].value, vangogh);
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
        () => getRelationshipMembershipState(person, 'pet'),
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
        () => getRelationshipMembershipState(person, 'firstName'),
        /requires a 'linksTo' or 'linksToMany' field/,
      );
    });
  });
});
