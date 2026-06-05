import { render, waitUntil } from '@ember/test-helpers';

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
import type { RelationshipState } from 'https://cardstack.com/base/card-api';
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
  getBrokenLinks,
  getDataBucket,
  getRelationship,
  linksTo,
  linksToMany,
  setupBaseRealm,
  StringField,
  subscribeToChanges,
  unsubscribeFromChanges,
} from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

// A terminal sentinel never escapes the field getter — userland reads
// `undefined` — so tests read the raw bucket entry to observe the planted
// shape, and `getRelationship` to observe the structured failure.
function bucketEntry(instance: CardDefType, fieldName: string): any {
  return getDataBucket(instance).get(fieldName);
}

function singularState(
  state: RelationshipState | RelationshipState[],
): RelationshipState {
  if (Array.isArray(state)) {
    throw new Error('expected a singular relationship state');
  }
  return state;
}

// The base-realm helpers (CardDef, field, …) are only populated once
// `setupBaseRealm` has run, so cards must be declared inside a test rather than
// at module scope.
function makeCards() {
  class Pet extends CardDef {
    @field firstName = contains(StringField);
  }
  class Person extends CardDef {
    @field firstName = contains(StringField);
    @field pet = linksTo(Pet);
    @field pets = linksToMany(Pet);
  }
  return { Person, Pet };
}

// Build a Person instance attached to the realm-backed store *without*
// indexing it, so reading a relationship drives the real lazilyLoadLink fetch
// (and its failure path) rather than surfacing a persisted error doc.
async function createPerson(
  relationships: LooseCardResource['relationships'],
): Promise<CardDefType & { pet: unknown; pets: unknown }> {
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
  )) as CardDefType & { pet: unknown; pets: unknown };
}

let loader: Loader;
let isLinkError: (typeof FieldSupportModule)['isLinkError'];
let isLinkNotFound: (typeof FieldSupportModule)['isLinkNotFound'];

module('Integration | linksTo error sentinel producer', function (hooks) {
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

  // Realm holds the Person/Pet module and one real Pet, but never `Pet/ghost`
  // — links to it resolve to a 404.
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

  test('a 404 lazy-load failure plants a link-not-found sentinel in the data bucket', async function (assert) {
    await setupRealm();

    let person = await createPerson({
      pet: { links: { self: `${testRealmURL}Pet/ghost` } },
    });

    // reading the field kicks off the lazy load
    assert.strictEqual(
      person.pet,
      undefined,
      'a not-yet-resolved broken link reads as undefined',
    );

    await waitUntil(() => isLinkNotFound(bucketEntry(person, 'pet')));

    let sentinel = bucketEntry(person, 'pet');
    assert.true(
      isLinkNotFound(sentinel),
      'bucket holds a link-not-found sentinel after the 404',
    );
    assert.strictEqual(
      sentinel.reference,
      `${testRealmURL}Pet/ghost`,
      'sentinel preserves the broken reference',
    );
    assert.strictEqual(
      (sentinel.errorDoc as SerializedError).status,
      404,
      'errorDoc status is 404',
    );

    // `undefined` is the same nullish surface a not-loaded link produces, so
    // existing `== null` consumer checks keep working unchanged.
    assert.strictEqual(
      person.pet,
      undefined,
      'the field getter surfaces the terminal sentinel as undefined',
    );

    let state = singularState(getRelationship(person, 'pet'));
    assert.strictEqual(state.kind, 'not-found', 'getRelationship kind');
    if (state.kind === 'not-found') {
      assert.strictEqual(
        state.reference,
        `${testRealmURL}Pet/ghost`,
        'getRelationship reference',
      );
      assert.true(state.isError, 'getRelationship marks the state as an error');
      assert.strictEqual(
        state.errorDoc.status,
        404,
        'getRelationship carries the errorDoc',
      );
    }
  });

  test('reading a broken link repeatedly does not refetch (terminal sentinel)', async function (assert) {
    await setupRealm();
    let person = await createPerson({
      pet: { links: { self: `${testRealmURL}Pet/ghost` } },
    });

    person.pet;
    await waitUntil(() => isLinkNotFound(bucketEntry(person, 'pet')));
    let firstSentinel = bucketEntry(person, 'pet');

    // Three more reads must not replace the sentinel — a terminal state never
    // retriggers lazilyLoadLink.
    person.pet;
    person.pet;
    person.pet;
    await new Promise((r) => setTimeout(r, 50));

    assert.strictEqual(
      bucketEntry(person, 'pet'),
      firstSentinel,
      'bucket entry is the same sentinel object — no refetch was kicked off',
    );
  });

  test('a permanently-broken link converges in at most two renders', async function (assert) {
    await setupRealm();
    let person = await createPerson({
      pet: { links: { self: `${testRealmURL}Pet/ghost` } },
    });

    let renderCount = 0;
    let bump = () => {
      renderCount++;
      return '';
    };
    // Reading `person.pet` drives the lazy load (and entangles card tracking),
    // so the template re-renders once when the sentinel lands. `getRelationship`
    // reports the resulting state without itself scheduling a render.
    let petKind = () => {
      void person.pet;
      return singularState(getRelationship(person, 'pet')).kind;
    };

    await render(
      <template>
        <span>{{bump}}</span>
        <span data-test-kind>{{petKind}}</span>
      </template>,
    );
    await waitUntil(() => isLinkNotFound(bucketEntry(person, 'pet')));

    assert.dom('[data-test-kind]').hasText('not-found');
    assert.ok(
      renderCount <= 2,
      `card with a permanently-broken linksTo converged in ${renderCount} render(s) (initial + post-lazy-load)`,
    );
  });

  test('the singular getter recognizes a hand-planted link-error sentinel and returns undefined', async function (assert) {
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
    assert.strictEqual(
      bucketEntry(person, 'pet'),
      sentinel,
      'reading the field does not retrigger the loader for a link-error',
    );
    assert.true(isLinkError(bucketEntry(person, 'pet')));

    let state = singularState(getRelationship(person, 'pet'));
    assert.strictEqual(state.kind, 'error');
    if (state.kind === 'error') {
      assert.strictEqual(state.reference, `${testRealmURL}Pet/exploded`);
    }
  });

  test('a failed singular lazy load notifies change subscribers with the sentinel', async function (assert) {
    await setupRealm();
    let person = await createPerson({
      pet: { links: { self: `${testRealmURL}Pet/ghost` } },
    });

    let changes: Array<{ fieldName: string; value: unknown }> = [];
    let subscriber = (_instance: unknown, fieldName: string, value: unknown) =>
      changes.push({ fieldName, value });
    subscribeToChanges(person, subscriber);

    try {
      // trigger the lazy load that will fail
      person.pet;
      await waitUntil(() => isLinkNotFound(bucketEntry(person, 'pet')));

      let petChange = changes.find(
        (c) => c.fieldName === 'pet' && isLinkNotFound(c.value),
      );
      assert.ok(
        petChange,
        'subscribeToChanges listeners observe the failed lazy load — change propagation matches a successful load',
      );
    } finally {
      unsubscribeFromChanges(person, subscriber);
    }
  });

  test('getBrokenLinks reports a real 404 lazy-load failure read through getRelationship', async function (assert) {
    await setupRealm();
    let person = await createPerson({
      pet: { links: { self: `${testRealmURL}Pet/ghost` } },
    });

    // reading the field kicks off the lazy load that 404s and plants the sentinel
    person.pet;
    await waitUntil(() => isLinkNotFound(bucketEntry(person, 'pet')));

    let findings = getBrokenLinks(person);
    assert.strictEqual(
      findings.length,
      1,
      'the broken declared field is found',
    );
    assert.strictEqual(findings[0].fieldName, 'pet');
    assert.strictEqual(findings[0].kind, 'not-found');
    assert.strictEqual(
      findings[0].reference,
      `${testRealmURL}Pet/ghost`,
      'the finding carries the broken reference the producer planted',
    );
    assert.strictEqual(
      (findings[0].errorDoc as SerializedError).status,
      404,
      'the finding carries the upstream errorDoc',
    );
  });

  test('a plural lazy-load failure swaps the sentinel into the failed slot in place', async function (assert) {
    await setupRealm();
    let person = await createPerson({
      'pets.0': { links: { self: `${testRealmURL}Pet/mango` } },
      'pets.1': { links: { self: `${testRealmURL}Pet/ghost` } },
    });

    // reading the field kicks off the lazy loads for both slots
    person.pets;
    let arrayBefore = getDataBucket(person).get('pets');

    // Both slots load concurrently; wait until neither is still in-flight so
    // the good slot has resolved to a card and the broken one to a sentinel.
    // Per-slot index access is masked to `Card | undefined`, so settle on the
    // typed `getRelationship` surface rather than probing the array for shapes.
    await waitUntil(() => {
      let states = getRelationship(person, 'pets');
      if (!Array.isArray(states)) {
        return false;
      }
      let kinds = states.map((s) => s.kind);
      return !kinds.includes('not-loaded') && kinds.includes('not-found');
    });

    let arrayAfter = getDataBucket(person).get('pets');
    assert.strictEqual(
      arrayBefore,
      arrayAfter,
      'WatchedArray identity is preserved — the sentinel was swapped in place',
    );

    let states = getRelationship(person, 'pets');
    if (!Array.isArray(states)) {
      throw new Error('expected plural relationship states');
    }
    let kinds = states.map((s) => s.kind).sort();
    assert.deepEqual(
      kinds,
      ['not-found', 'present'],
      'the good slot stays present while the broken slot becomes not-found',
    );
  });
});
