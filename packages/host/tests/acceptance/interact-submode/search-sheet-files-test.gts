import { click, fillIn, waitFor } from '@ember/test-helpers';

import { module, test } from 'qunit';

import { baseRealm, specRef } from '@cardstack/runtime-common';

import {
  setupLocalIndexing,
  setupRealmCacheTeardown,
  testRealmURL,
  setupOnSave,
  setupAcceptanceTestRealm,
  SYSTEM_CARD_FIXTURE_CONTENTS,
  visitOperatorMode,
  setupAuthEndpoints,
  setupUserSubscription,
  withCachedRealmSetup,
  realmConfigCardJSON,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupApplicationTest } from '../../helpers/setup';

const testRealmFiles: Record<string, any> = {
  'realm.json': realmConfigCardJSON({
    name: 'Test Workspace',
    iconURL: 'https://boxel-images.boxel.ai/icons/Letter-t.png',
  }),
  'pet.gts': `
    import { CardDef, Component, StringField, field, contains } from "@cardstack/base/card-api";
    export default class Pet extends CardDef {
      static displayName = 'Pet';
      @field name = contains(StringField);
      @field cardTitle = contains(StringField, {
        computeVia: function (this: Pet) {
          return this.name;
        },
      });
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <span data-test-pet><@fields.cardTitle /></span>
        </template>
      }
    }
  `,
  'spec/pet.json': {
    data: {
      type: 'card',
      attributes: {
        cardTitle: 'Pet Spec',
        cardDescription: 'Spec for Pet',
        specType: 'card',
        ref: { module: `../pet`, name: 'default' },
      },
      meta: { adoptsFrom: specRef },
    },
  },
  'Pet/mango.json': {
    data: {
      attributes: { name: 'Mango' },
      meta: {
        adoptsFrom: {
          module: `../pet`,
          name: 'default',
        },
      },
    },
  },
  'mango-care-notes.md': `# Mango Care Notes

Feed twice a day. No couch privileges.
`,
  'garden-tips.md': `# Garden Tips

Water the blueberries weekly.
`,
};

module(
  'Acceptance | interact submode | search sheet files tests',
  function (hooks) {
    setupApplicationTest(hooks);
    setupLocalIndexing(hooks);
    setupOnSave(hooks);
    setupRealmCacheTeardown(hooks);

    let mockMatrixUtils = setupMockMatrix(hooks, {
      loggedInAs: '@testuser:localhost',
      activeRealms: [baseRealm.url, testRealmURL],
    });
    let { setRealmPermissions, createAndJoinRoom } = mockMatrixUtils;

    hooks.beforeEach(async function () {
      await withCachedRealmSetup(async () => {
        await setupAcceptanceTestRealm({
          mockMatrixUtils,
          realmURL: testRealmURL,
          contents: {
            ...SYSTEM_CARD_FIXTURE_CONTENTS,
            ...testRealmFiles,
          },
        });
      });

      createAndJoinRoom({
        sender: '@testuser:localhost',
        name: 'room-test',
      });
      setupUserSubscription();
      setupAuthEndpoints();

      setRealmPermissions({
        [baseRealm.url]: ['read'],
        [testRealmURL]: ['read', 'write'],
      });
    });

    test('searching by term returns matching files alongside cards', async function (assert) {
      await visitOperatorMode({});

      await click('[data-test-open-search-field]');
      await fillIn('[data-test-search-field]', 'mango');

      await waitFor(
        `[data-test-search-result="${testRealmURL}mango-care-notes.md"]`,
      );
      assert
        .dom(`[data-test-search-result="${testRealmURL}mango-care-notes.md"]`)
        .exists(
          'the .md file matching the term by name is a search result, under its extension-bearing id',
        );
      assert
        .dom(`[data-test-search-result="${testRealmURL}Pet/mango"]`)
        .exists(
          { count: 1 },
          'the card appears exactly once (its dual-indexed .json file row is deduped)',
        );
    });

    test('a term matching only a file name returns the file', async function (assert) {
      await visitOperatorMode({});

      await click('[data-test-open-search-field]');
      await fillIn('[data-test-search-field]', 'garden-tips');

      await waitFor(
        `[data-test-search-result="${testRealmURL}garden-tips.md"]`,
      );
      assert
        .dom(`[data-test-search-result="${testRealmURL}garden-tips.md"]`)
        .exists('the file is found by its name');
      assert
        .dom(`[data-test-search-result="${testRealmURL}Pet/mango"]`)
        .doesNotExist('unrelated cards do not match');
    });

    test('clicking a file result opens the file in the stack', async function (assert) {
      await visitOperatorMode({});

      await click('[data-test-open-search-field]');
      await fillIn('[data-test-search-field]', 'garden-tips');

      await waitFor(
        `[data-test-search-result="${testRealmURL}garden-tips.md"]`,
      );
      await click(`[data-test-search-result="${testRealmURL}garden-tips.md"]`);

      await waitFor(`[data-test-stack-card="${testRealmURL}garden-tips.md"]`);
      assert
        .dom(`[data-test-stack-card="${testRealmURL}garden-tips.md"]`)
        .exists('the file opens as a file stack item under its full URL');
      assert
        .dom(`[data-test-stack-card="${testRealmURL}garden-tips.md"]`)
        .containsText('Garden Tips', 'the markdown content renders');
    });

    test('specs still match by title', async function (assert) {
      await visitOperatorMode({});

      await click('[data-test-open-search-field]');
      await fillIn('[data-test-search-field]', 'Pet Spec');

      await waitFor(`[data-test-search-result="${testRealmURL}spec/pet"]`);
      assert
        .dom(`[data-test-search-result="${testRealmURL}spec/pet"]`)
        .exists('spec cards remain searchable in the sheet');
    });
  },
);
