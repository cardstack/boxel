import { waitUntil } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import {
  baseRealm,
  PermissionsContextName,
  type LooseCardResource,
  type Permissions,
} from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common/loader';

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
  FieldDef,
  getDataBucket,
  getRelationship,
  linksTo,
  linksToMany,
  serializeCard,
  setupBaseRealm,
  StringField,
} from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

// A terminal sentinel never escapes the field getter — userland reads
// `undefined` — so tests read the raw bucket entry to observe the planted shape.
function bucketEntry(instance: any, fieldName: string): any {
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

const GHOST = `${testRealmURL}Pet/ghost`;
const MANGO = `${testRealmURL}Pet/mango`;
const PUBLISHER_GHOST = `${testRealmURL}Publisher/ghost`;

// The base-realm helpers (CardDef, field, …) are only populated once
// `setupBaseRealm` has run, so cards must be declared inside a test rather than
// at module scope.
function makeCards() {
  class Pet extends CardDef {
    @field firstName = contains(StringField);
  }
  class Publisher extends CardDef {
    @field name = contains(StringField);
  }
  // A FieldDef that itself links to a CardDef — exercises the contained-nesting
  // serialize/deserialize path for a broken nested link.
  class Author extends FieldDef {
    @field name = contains(StringField);
    @field publisher = linksTo(Publisher);
  }
  class Person extends CardDef {
    @field firstName = contains(StringField);
    @field pet = linksTo(Pet);
    @field pets = linksToMany(Pet);
    @field author = contains(Author);
  }
  return { Person, Pet, Publisher, Author };
}

// Build a Person instance attached to the realm-backed store *without* indexing
// it, so reading a relationship drives the real lazilyLoadLink fetch (and its
// failure path) rather than surfacing a persisted error doc. State is always
// planted through this producer path — never by direct bucket writes.
async function createPerson(
  relationships: LooseCardResource['relationships'],
  attributes: LooseCardResource['attributes'] = { firstName: 'Hassan' },
): Promise<any> {
  let store = getService('store');
  let resource: LooseCardResource = {
    attributes,
    relationships,
    meta: { adoptsFrom: { module: testRRI('test-cards'), name: 'Person' } },
  };
  return await store.__dangerousCreateFromSerialized(
    resource,
    { data: resource },
    new URL(testRealmURL),
  );
}

let loader: Loader;
let isLinkNotFound: (typeof FieldSupportModule)['isLinkNotFound'];
let isNotLoadedValue: (typeof FieldSupportModule)['isNotLoadedValue'];

module(
  'Integration | linksTo sentinel serialization round-trip',
  function (hooks) {
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
      isLinkNotFound = fieldSupport.isLinkNotFound;
      isNotLoadedValue = fieldSupport.isNotLoadedValue;
    });

    setupCardLogs(
      hooks,
      async () => await loader.import(`${baseRealm.url}card-api`),
    );

    // Realm holds the module and one real Pet (`Pet/mango`), but never
    // `Pet/ghost` or `Publisher/ghost` — links to those resolve to a 404.
    async function setupRealm() {
      let { Person, Pet, Publisher, Author } = makeCards();
      await setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {
          'test-cards.gts': { Person, Pet, Publisher, Author },
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

    // Drive a broken singular link to its terminal link-not-found sentinel.
    async function brokenPet(): Promise<any> {
      let person = await createPerson({ pet: { links: { self: GHOST } } });
      person.pet; // triggers the lazy load that 404s
      await waitUntil(() => isLinkNotFound(bucketEntry(person, 'pet')));
      return person;
    }

    test('a card carrying a link-not-found sentinel serializes to the not-loaded wire shape', async function (assert) {
      await setupRealm();
      let person = await brokenPet();

      let serialized = serializeCard(person, {
        includeUnrenderedFields: true,
        useAbsoluteURL: true,
      });

      // No errorDoc, no discriminator — the broken reference is preserved as a
      // plain relationship link, identical to a not-loaded link.
      assert.deepEqual(serialized.data.relationships?.pet, {
        links: { self: GHOST },
        data: { type: 'card', id: GHOST },
      });
    });

    test('broken-link wire is byte-for-byte identical to a not-yet-loaded link', async function (assert) {
      await setupRealm();

      let broken = await brokenPet();
      // A second Person points at the same broken reference but is never read,
      // so its `pet` stays a not-loaded value in the bucket.
      let notLoaded = await createPerson({ pet: { links: { self: GHOST } } });
      assert.true(
        isNotLoadedValue(bucketEntry(notLoaded, 'pet')),
        'the unread link is a not-loaded value',
      );

      let opts = {
        includeUnrenderedFields: true,
        useAbsoluteURL: true,
      } as const;
      assert.deepEqual(
        serializeCard(broken, opts).data.relationships?.pet,
        serializeCard(notLoaded, opts).data.relationships?.pet,
        'a saved broken link and a not-yet-loaded link produce identical wire JSON',
      );
    });

    test('round-trip: a serialized broken link deserializes to a not-loaded value and reproduces not-found on read', async function (assert) {
      await setupRealm();
      let person = await brokenPet();

      let serialized = serializeCard(person, {
        includeUnrenderedFields: true,
        useAbsoluteURL: true,
      });

      // Reload in a fresh instance from the wire the save produced.
      let reloaded = await createPerson(serialized.data.relationships);
      assert.true(
        isNotLoadedValue(bucketEntry(reloaded, 'pet')),
        'deserialize plants a not-loaded value — no sentinel is persisted',
      );

      // Target is still broken, so the lazy-load failure path reproduces the
      // typed sentinel.
      reloaded.pet;
      await waitUntil(() => isLinkNotFound(bucketEntry(reloaded, 'pet')));

      let state = singularState(getRelationship(reloaded, 'pet'));
      assert.strictEqual(state.kind, 'not-found', 'not-found state reproduces');
      assert.strictEqual(
        state.reference,
        GHOST,
        'reference survives the round-trip',
      );
    });

    test('round-trip: a present link reproduces present', async function (assert) {
      await setupRealm();
      let person = await createPerson({ pet: { links: { self: MANGO } } });
      await waitUntil(() => person.pet != null);
      assert.strictEqual(
        singularState(getRelationship(person, 'pet')).kind,
        'present',
        'the live link is present',
      );

      let serialized = serializeCard(person, {
        includeUnrenderedFields: true,
        useAbsoluteURL: true,
      });

      let reloaded = await createPerson(serialized.data.relationships);
      reloaded.pet; // drive the lazy load against the still-present target
      await waitUntil(() => reloaded.pet != null);
      assert.strictEqual(
        singularState(getRelationship(reloaded, 'pet')).kind,
        'present',
        'present state reproduces after reload',
      );
    });

    test('plural: a slot holding a link-not-found sentinel serializes identically to a not-loaded slot', async function (assert) {
      await setupRealm();

      let broken = await createPerson({
        'pets.0': { links: { self: MANGO } },
        'pets.1': { links: { self: GHOST } },
      });
      broken.pets; // triggers lazy loads for both slots
      await waitUntil(() => {
        let arr = bucketEntry(broken, 'pets');
        return Array.isArray(arr) && arr.some((e: any) => isLinkNotFound(e));
      });

      let notLoaded = await createPerson({
        'pets.0': { links: { self: MANGO } },
        'pets.1': { links: { self: GHOST } },
      });

      let opts = {
        includeUnrenderedFields: true,
        useAbsoluteURL: true,
      } as const;
      let brokenSlot = serializeCard(broken, opts).data.relationships?.[
        'pets.1'
      ];
      assert.deepEqual(
        brokenSlot,
        { links: { self: GHOST }, data: { type: 'card', id: GHOST } },
        'the broken slot serializes to the not-loaded shape',
      );
      assert.deepEqual(
        brokenSlot,
        serializeCard(notLoaded, opts).data.relationships?.['pets.1'],
        'broken slot wire matches the not-yet-loaded slot wire',
      );
    });

    test('contained FieldDef: a broken nested linksTo round-trips through the outer card', async function (assert) {
      await setupRealm();

      let person = await createPerson(
        { 'author.publisher': { links: { self: PUBLISHER_GHOST } } },
        { firstName: 'Hassan', author: { name: 'Ann' } },
      );
      let author = person.author;
      author.publisher; // nested lazy load that 404s
      await waitUntil(() => isLinkNotFound(bucketEntry(author, 'publisher')));

      let serialized = serializeCard(person, {
        includeUnrenderedFields: true,
        useAbsoluteURL: true,
      });
      assert.deepEqual(
        serialized.data.relationships?.['author.publisher'],
        {
          links: { self: PUBLISHER_GHOST },
          data: { type: 'card', id: PUBLISHER_GHOST },
        },
        'the nested broken link serializes to the not-loaded shape under the dotted key',
      );

      // Reload nests through Contains on deserialize; reading the nested link
      // reproduces the failure.
      let reloaded = await createPerson(serialized.data.relationships, {
        firstName: 'Hassan',
        author: { name: 'Ann' },
      });
      let reloadedAuthor = reloaded.author;
      assert.true(
        isNotLoadedValue(bucketEntry(reloadedAuthor, 'publisher')),
        'nested deserialize plants a not-loaded value',
      );
      reloadedAuthor.publisher;
      await waitUntil(() =>
        isLinkNotFound(bucketEntry(reloadedAuthor, 'publisher')),
      );
      assert.true(
        isLinkNotFound(bucketEntry(reloadedAuthor, 'publisher')),
        'nested not-found state reproduces after the round-trip',
      );
    });
  },
);
