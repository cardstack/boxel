import { waitUntil } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import {
  baseRealm,
  PermissionsContextName,
  type LooseCardResource,
  type Permissions,
  type SerializedError,
} from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common/loader';

import type { CardDef as CardDefType } from 'https://cardstack.com/base/card-api';
import type * as FieldSupportModule from 'https://cardstack.com/base/field-support';

import {
  provideConsumeContext,
  setupCardLogs,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
  testRRI,
} from '../../helpers';
import {
  CardDef,
  contains,
  field,
  getDataBucket,
  linksTo,
  setupBaseRealm,
  StringField,
} from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

// The contract under test is the *userland* JS shape of `card.linkField`:
// strict-equality, optional-chain, and raw-access semantics across all five
// relationship states the singular `linksTo` getter can be in. `getRelationship`
// is the diagnostic surface — covered by get-relationship-test — and is
// deliberately not exercised here. Sentinels are inspected via the data bucket
// (where they live) rather than the getter, since the getter never returns one.
function bucketEntry(instance: CardDefType, fieldName: string): unknown {
  return getDataBucket(instance).get(fieldName);
}

function makeCards() {
  class Pet extends CardDef {
    @field firstName = contains(StringField);
  }
  class Person extends CardDef {
    @field firstName = contains(StringField);
    @field pet = linksTo(Pet);
    @field petName = contains(StringField, {
      // A computed that consumes the declared `linksTo` via optional-chaining.
      // For every non-Present state the getter returns `undefined`, so the
      // optional chain short-circuits and the computed resolves to `undefined`
      // — proving the getter's recognition flows through the compute pipeline.
      computeVia: function (this: Person) {
        return this.pet?.firstName;
      },
    });
  }
  return { Person, Pet };
}

async function createPerson(
  relationships: LooseCardResource['relationships'],
): Promise<CardDefType & { pet: unknown; petName: string | undefined }> {
  let store = getService('store');
  let resource: LooseCardResource = {
    attributes: { firstName: 'Hassan' },
    relationships,
    meta: { adoptsFrom: { module: testRRI('test-cards'), name: 'Person' } },
  };
  return (await store.__dangerousCreateFromSerialized(
    resource,
    { data: resource },
    new URL(testRealmURL),
  )) as CardDefType & { pet: unknown; petName: string | undefined };
}

let loader: Loader;
let isLinkError: (typeof FieldSupportModule)['isLinkError'];
let isLinkNotFound: (typeof FieldSupportModule)['isLinkNotFound'];

module('Integration | linksTo singular JS-access contract', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });

  hooks.beforeEach(async function () {
    let permissions: Permissions = { canWrite: true, canRead: true };
    provideConsumeContext(PermissionsContextName, permissions);
    loader = getService('loader-service').loader;
    let fieldSupport = await loader.import<typeof FieldSupportModule>(
      `${baseRealm.url}field-support`,
    );
    isLinkError = fieldSupport.isLinkError;
    isLinkNotFound = fieldSupport.isLinkNotFound;
  });

  setupCardLogs(
    hooks,
    async () => await loader.import(`${baseRealm.url}card-api`),
  );

  // Realm holds the Person/Pet module and one real Pet (`Pet/mango`). Links to
  // any other URL (e.g. `Pet/ghost`) lazy-load into a 404.
  async function setupRealm() {
    let { Person, Pet } = makeCards();
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Person, Pet },
        'Pet/mango.json': {
          data: {
            attributes: { firstName: 'Mango' },
            meta: {
              adoptsFrom: { module: testRRI('test-cards'), name: 'Pet' },
            },
          },
        },
      },
    });
  }

  test("kind 'present': card.linkField is strictly equal to the linked card", async function (assert) {
    await setupRealm();
    let person = await createPerson({
      pet: { links: { self: `${testRealmURL}Pet/mango` } },
    });

    // Reading the field kicks off the lazy load; once it resolves, the bucket
    // holds the loaded Pet instance and `card.pet` returns it directly.
    person.pet;
    await waitUntil(() => {
      let entry = bucketEntry(person, 'pet');
      return entry != null && typeof entry === 'object' && 'id' in entry;
    });

    let resolved = bucketEntry(person, 'pet') as CardDefType;
    assert.strictEqual(
      person.pet,
      resolved,
      'card.pet is strictly equal to the resolved Pet',
    );
    assert.notStrictEqual(
      person.pet,
      undefined,
      'card.pet is not undefined for a present link',
    );
    assert.notStrictEqual(
      person.pet,
      null,
      'card.pet is never null for a present link',
    );
  });

  test("kind 'not-loaded' (transient): card.linkField === undefined and lazilyLoadLink fires", async function (assert) {
    await setupRealm();
    let person = await createPerson({
      pet: { links: { self: `${testRealmURL}Pet/mango` } },
    });

    // Before reading, the deserializer planted a `not-loaded` sentinel; the
    // synchronous getter reads as `undefined` while the load is in flight.
    assert.strictEqual(
      person.pet,
      undefined,
      'a not-yet-resolved link reads as undefined',
    );

    // Optional-chain semantics on a transient not-loaded surface match
    // ordinary `undefined`: short-circuit returns `undefined`, raw access
    // throws TypeError. The platform does not wrap either.
    assert.strictEqual((person.pet as any)?.firstName, undefined);
    assert.throws(
      () => (person.pet as any).firstName,
      /undefined/,
      'raw property access on a not-loaded link throws TypeError per JS semantics',
    );

    // The getter handed the in-flight load off to lazilyLoadLink, which
    // resolves the link and swaps the bucket entry to the loaded card.
    await waitUntil(() => {
      let entry = bucketEntry(person, 'pet');
      return entry != null && typeof entry === 'object' && 'id' in entry;
    });
    assert.strictEqual(
      (person.pet as any).id,
      `${testRealmURL}Pet/mango`,
      'lazilyLoadLink resolves the link and the getter then returns the loaded Pet',
    );
  });

  test("kind 'error': card.linkField === undefined and the terminal sentinel is not retried", async function (assert) {
    await setupRealm();
    let person = await createPerson({});

    let sentinel = {
      type: 'link-error' as const,
      reference: `${testRealmURL}Pet/exploded`,
      errorDoc: {
        status: 500,
        message: 'upstream exploded',
        additionalErrors: null,
      } satisfies SerializedError,
    };
    getDataBucket(person).set('pet', sentinel);

    assert.strictEqual(
      person.pet,
      undefined,
      'a link-error sentinel surfaces as undefined to userland',
    );
    // Loose `== null` is the contract under test; `assert.strictEqual(_, null)`
    // would assert the wrong thing (passes for actual null but not undefined).
    // eslint-disable-next-line qunit/no-ok-equality
    assert.true(
      person.pet == null,
      'card.pet == null evaluates true (loose equality)',
    );
    assert.strictEqual(
      (person.pet as any)?.firstName,
      undefined,
      'optional chain returns undefined',
    );
    assert.throws(
      () => (person.pet as any).firstName,
      /undefined/,
      'raw property access throws TypeError',
    );

    // Repeated reads must keep the same sentinel object in the bucket — any
    // refetch attempt would replace the entry with a fresh in-flight load.
    person.pet;
    person.pet;
    person.pet;
    assert.strictEqual(
      bucketEntry(person, 'pet'),
      sentinel,
      'the same sentinel object is in the bucket — no refetch was kicked off',
    );
    assert.true(isLinkError(bucketEntry(person, 'pet')));
  });

  test("kind 'not-found': card.linkField === undefined and a real 404 lazy-load is not retried", async function (assert) {
    await setupRealm();
    let person = await createPerson({
      pet: { links: { self: `${testRealmURL}Pet/ghost` } },
    });

    // First read drives the 404 and plants the terminal sentinel.
    person.pet;
    await waitUntil(() => isLinkNotFound(bucketEntry(person, 'pet')));
    let plantedSentinel = bucketEntry(person, 'pet');

    assert.strictEqual(
      person.pet,
      undefined,
      'a link-not-found sentinel surfaces as undefined to userland',
    );
    // Loose `== null` is the contract under test; `assert.strictEqual(_, null)`
    // would assert the wrong thing (passes for actual null but not undefined).
    // eslint-disable-next-line qunit/no-ok-equality
    assert.true(
      person.pet == null,
      'card.pet == null evaluates true (loose equality)',
    );
    assert.strictEqual(
      (person.pet as any)?.firstName,
      undefined,
      'optional chain returns undefined',
    );
    assert.throws(
      () => (person.pet as any).firstName,
      /undefined/,
      'raw property access throws TypeError',
    );

    // Three further reads must not replace the sentinel — a terminal state
    // never retriggers lazilyLoadLink.
    person.pet;
    person.pet;
    person.pet;
    await new Promise((r) => setTimeout(r, 50));
    assert.strictEqual(
      bucketEntry(person, 'pet'),
      plantedSentinel,
      'the same sentinel object is in the bucket after repeated reads',
    );
  });

  test("kind 'not-set': card.linkField === undefined when no link has been assigned", async function (assert) {
    await setupRealm();
    let person = await createPerson({});

    assert.strictEqual(
      person.pet,
      undefined,
      'an unassigned link reads as undefined',
    );
    // Loose `== null` is the contract under test; `assert.strictEqual(_, null)`
    // would assert the wrong thing (passes for actual null but not undefined).
    // eslint-disable-next-line qunit/no-ok-equality
    assert.true(
      person.pet == null,
      'card.pet == null evaluates true (loose equality)',
    );
    assert.strictEqual(
      (person.pet as any)?.firstName,
      undefined,
      'optional chain returns undefined',
    );
    assert.throws(
      () => (person.pet as any).firstName,
      /undefined/,
      'raw property access throws TypeError',
    );
    // The bucket may cache `null` (from LinksTo.emptyValue()) after the first
    // read, but it must never be a sentinel object — userland sees only the
    // unified nullish surface, and the field getter is responsible for the
    // normalization rather than the bucket.
    let entry = bucketEntry(person, 'pet');
    assert.false(
      isLinkError(entry),
      'no link-error sentinel was planted for an unassigned link',
    );
    assert.false(
      isLinkNotFound(entry),
      'no link-not-found sentinel was planted for an unassigned link',
    );
  });

  test('a computed deriving from a broken declared linksTo evaluates to undefined', async function (assert) {
    // The Person card declares `petName = contains(StringField, { computeVia: this.pet?.firstName })`.
    // When `this.pet` is a terminal sentinel, the getter returns `undefined`,
    // the optional chain short-circuits, and the computed pipeline carries
    // the `undefined` out — proving the getter's recognition flows through
    // computeds rather than leaking the sentinel object.
    await setupRealm();
    let person = await createPerson({});
    getDataBucket(person).set('pet', {
      type: 'link-not-found',
      reference: `${testRealmURL}Pet/missing`,
      errorDoc: {
        status: 404,
        message: 'not found',
        additionalErrors: null,
      } satisfies SerializedError,
    });

    assert.strictEqual(
      person.petName,
      undefined,
      'computed deriving from a broken linksTo resolves to undefined',
    );
  });
});
