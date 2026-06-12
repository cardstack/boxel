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

import type {
  CardDef as CardDefType,
  RelationshipState as RelationshipStateType,
} from 'https://cardstack.com/base/card-api';

import {
  provideConsumeContext,
  saveCard,
  setupCardLogs,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
  testRRI,
} from '../../helpers';
import {
  CardDef,
  FieldDef,
  contains,
  field,
  getDataBucket,
  getRelationshipMembershipState,
  linksToMany,
  setupBaseRealm,
  StringField,
} from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

const MANGO_URL = `${testRealmURL}Pet/mango`;
const VANGOGH_URL = `${testRealmURL}Pet/vangogh`;
const GHOST_URL = `${testRealmURL}Pet/ghost`;
const EXPLODED_URL = `${testRealmURL}Pet/exploded`;

function errorDoc(message: string, status = 500): SerializedError {
  return { status, message, additionalErrors: null };
}

function notFoundSentinel(reference: string) {
  return {
    type: 'link-not-found' as const,
    reference,
    errorDoc: errorDoc(`missing file ${reference}`, 404),
  };
}

function linkErrorSentinel(reference: string) {
  return {
    type: 'link-error' as const,
    reference,
    errorDoc: errorDoc('upstream exploded', 500),
  };
}

module(
  'Integration | linksToMany per-slot JS-access contract',
  function (hooks) {
    let loader: Loader;

    setupRenderingTest(hooks);
    setupBaseRealm(hooks);
    setupLocalIndexing(hooks);

    let mockMatrixUtils = setupMockMatrix(hooks, {
      loggedInAs: '@testuser:localhost',
      activeRealms: [testRealmURL],
      autostart: true,
    });

    hooks.beforeEach(function () {
      let permissions: Permissions = { canWrite: true, canRead: true };
      provideConsumeContext(PermissionsContextName, permissions);
      loader = getService('loader-service').loader;
    });

    setupCardLogs(
      hooks,
      async () => await loader.import(`${baseRealm.url}card-api`),
    );

    // Build a Person whose `pets` array holds two present cards (Mango, Van Gogh)
    // and one broken slot wedged between them, so the "siblings render normally"
    // claim is about the middle slot, not an edge. The broken slot is planted
    // directly as a terminal sentinel (assigned through the field setter, the
    // real userland write path) so the test never depends on lazy-load timing.
    async function makeMixedPerson(brokenSlot: object) {
      class Pet extends CardDef {
        static displayName = 'Pet';
        @field firstName = contains(StringField);
      }
      class Person extends CardDef {
        static displayName = 'Person';
        @field firstName = contains(StringField);
        @field pets = linksToMany(Pet);
      }
      loader.shimModule(`${testRealmURL}test-cards`, { Person, Pet });

      let mango = new Pet({ firstName: 'Mango' });
      let vangogh = new Pet({ firstName: 'Van Gogh' });
      await saveCard(mango, MANGO_URL, loader);
      await saveCard(vangogh, VANGOGH_URL, loader);

      let person = new Person({ firstName: 'Hassan' });
      (person as any).pets = [mango, brokenSlot, vangogh];
      return { person, mango, vangogh };
    }

    test('present slots are the card, a not-found slot is undefined, length includes the broken slot', async function (assert) {
      let { person, mango, vangogh } = await makeMixedPerson(
        notFoundSentinel(GHOST_URL),
      );
      let pets = (person as any).pets;

      assert.strictEqual(pets.length, 3, 'length counts the broken slot');
      assert.strictEqual(pets[0], mango, 'present slot 0 is the card');
      assert.strictEqual(pets[2], vangogh, 'present slot 2 is the card');
      assert.strictEqual(
        pets[1],
        undefined,
        'the not-found slot reads as undefined, never the sentinel',
      );
    });

    test('a link-error slot is also undefined per-slot', async function (assert) {
      let { person, mango, vangogh } = await makeMixedPerson(
        linkErrorSentinel(EXPLODED_URL),
      );
      let pets = (person as any).pets;

      assert.strictEqual(pets[0], mango);
      assert.strictEqual(pets[2], vangogh);
      assert.strictEqual(
        pets[1],
        undefined,
        'the error slot reads as undefined, never the sentinel',
      );
    });

    test('repeated reads of a terminal slot return undefined consistently', async function (assert) {
      let { person } = await makeMixedPerson(notFoundSentinel(GHOST_URL));
      let pets = (person as any).pets;

      assert.strictEqual(pets[1], undefined, 'first read');
      assert.strictEqual(pets[1], undefined, 'second read');
      assert.strictEqual(pets[1], undefined, 'third read');
      // The slot never re-triggers a load, so its structured failure is still
      // readable through the typed surface — it is hidden, not erased.
      let states = getRelationshipMembershipState(person, 'pets')
        .membership as RelationshipStateType[];
      assert.strictEqual(states[1].kind, 'not-found');
      assert.strictEqual(states[1].reference, GHOST_URL);
    });

    test('iteration with a c == null guard skips the broken slot and keeps the siblings', async function (assert) {
      let { person } = await makeMixedPerson(notFoundSentinel(GHOST_URL));
      let pets = (person as any).pets;

      let names: string[] = [];
      for (let c of pets) {
        if (c == null) {
          continue;
        }
        names.push((c as CardDefType & { firstName: string }).firstName);
      }
      assert.deepEqual(
        names,
        ['Mango', 'Van Gogh'],
        'one broken element does not break iteration over its siblings',
      );
    });

    test('map with optional chaining yields undefined for the broken slot; map without it throws', async function (assert) {
      let { person } = await makeMixedPerson(notFoundSentinel(GHOST_URL));
      let pets = (person as any).pets as ({ firstName: string } | undefined)[];

      assert.deepEqual(
        pets.map((c) => c?.firstName),
        ['Mango', undefined, 'Van Gogh'],
        'optional chaining surfaces undefined for the broken slot',
      );
      assert.throws(
        () => pets.map((c) => (c as { firstName: string }).firstName),
        /Cannot read properties of undefined/,
        'a non-optional read throws on the broken slot per ordinary JS semantics',
      );
    });

    test('a broken slot nested in a contained FieldDef surfaces as undefined; siblings render', async function (assert) {
      class Tag extends CardDef {
        static displayName = 'Tag';
        @field name = contains(StringField);
      }
      class TagSet extends FieldDef {
        static displayName = 'TagSet';
        @field items = linksToMany(Tag);
      }
      class Post extends CardDef {
        static displayName = 'Post';
        @field tags = contains(TagSet);
      }
      loader.shimModule(`${testRealmURL}nested-cards`, { Post, TagSet, Tag });

      let red = new Tag({ name: 'red' });
      let blue = new Tag({ name: 'blue' });
      await saveCard(red, `${testRealmURL}Tag/red`, loader);
      await saveCard(blue, `${testRealmURL}Tag/blue`, loader);

      let post = new Post();
      (post as any).tags.items = [red, notFoundSentinel(GHOST_URL), blue];

      let items = (post as any).tags.items;
      assert.strictEqual(items.length, 3, 'length counts the broken slot');
      assert.strictEqual(items[0], red, 'present nested slot 0 is the card');
      assert.strictEqual(items[2], blue, 'present nested slot 2 is the card');
      assert.strictEqual(
        items[1],
        undefined,
        'the broken nested slot surfaces as undefined in card.tags.items[i]',
      );
    });

    // The seeded tests above prove the hiding contract for terminal slots
    // deterministically. This one drives the real `lazilyLoadLink` failure path
    // end to end: an unresolved reference starts as `not-loaded` (also hidden),
    // the read kicks off the fetch, it 404s, and the slot settles to a terminal
    // not-found — staying `undefined` throughout, with the sibling resolving.
    test('a not-loaded slot reads undefined, drives the load, and stays undefined once it fails', async function (assert) {
      class Pet extends CardDef {
        static displayName = 'Pet';
        @field firstName = contains(StringField);
      }
      class Person extends CardDef {
        static displayName = 'Person';
        @field firstName = contains(StringField);
        @field pets = linksToMany(Pet);
      }
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

      let store = getService('store');
      let resource: LooseCardResource = {
        attributes: { firstName: 'Hassan' },
        relationships: {
          'pets.0': { links: { self: MANGO_URL } },
          'pets.1': { links: { self: GHOST_URL } },
        },
        meta: { adoptsFrom: { module: testRRI('test-cards'), name: 'Person' } },
      };
      let person = (await store.__dangerousCreateFromSerialized(
        resource,
        { data: resource },
        new URL(testRealmURL),
      )) as CardDefType & { pets: ({ firstName: string } | undefined)[] };

      // First read returns the array (length 2) with both slots hidden while the
      // loads are in flight, and kicks off lazilyLoadLink for each.
      assert.strictEqual(person.pets.length, 2, 'length includes both slots');
      assert.strictEqual(
        person.pets[1],
        undefined,
        'a not-loaded slot reads as undefined',
      );

      // Wait until the broken reference settles to a terminal not-found and the
      // present sibling has resolved to its card.
      await waitUntil(() => {
        let states = getRelationshipMembershipState(person, 'pets')
          .membership as RelationshipStateType[];
        return states[0]?.kind === 'present' && states[1]?.kind === 'not-found';
      });

      assert.strictEqual(
        person.pets[0]?.firstName,
        'Mango',
        'the present sibling resolves to its card',
      );
      assert.strictEqual(
        person.pets[1],
        undefined,
        'the failed slot stays undefined — terminal, never the sentinel',
      );

      // The data bucket still holds the terminal sentinel even though per-slot
      // access hides it, so the structured failure remains readable.
      let bucket = getDataBucket(person).get('pets');
      assert.strictEqual(
        bucket.length,
        2,
        'the backing array still has both slots',
      );
    });

    test('a list of only present links exposes every slot as its card', async function (assert) {
      class Pet extends CardDef {
        static displayName = 'Pet';
        @field firstName = contains(StringField);
      }
      class Person extends CardDef {
        static displayName = 'Person';
        @field firstName = contains(StringField);
        @field pets = linksToMany(Pet);
      }
      loader.shimModule(`${testRealmURL}test-cards`, { Person, Pet });

      let mango = new Pet({ firstName: 'Mango' });
      let vangogh = new Pet({ firstName: 'Van Gogh' });
      await saveCard(mango, MANGO_URL, loader);
      await saveCard(vangogh, VANGOGH_URL, loader);
      let person = new Person({ firstName: 'Hassan', pets: [mango, vangogh] });

      let pets = (person as any).pets;
      assert.strictEqual(pets.length, 2);
      assert.strictEqual(pets[0], mango);
      assert.strictEqual(pets[1], vangogh);
      assert.deepEqual(
        pets.map((c: any) => c.firstName),
        ['Mango', 'Van Gogh'],
        'a healthy list reads cleanly with a non-optional map',
      );
    });
  },
);
