// The card chooser's mixed cards + files mode (CS-12205): with
// `includeFiles: true` the modal surfaces file rows alongside card instances
// and resolves each pick as a kind-tagged `{ id, kind }` (a `ChosenItem`)
// rather than a bare card id. Cards-only callers are unaffected — they keep
// getting plain id strings (covered by card-chooser-test).
//
// Runs under the host test-services stack / CI.

import { click, waitFor } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import { baseRealm, baseRef, chooseCard } from '@cardstack/runtime-common';

import OperatorMode from '@cardstack/host/components/operator-mode/container';

import {
  testRealmURL,
  setupLocalIndexing,
  setupIntegrationTestRealm,
  setupOperatorModeStateCleanup,
  realmConfigCardJSON,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { renderComponent } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

const noop = () => {};

// A plain markdown file indexes as a MarkdownDef (a FileDef, hence a BaseDef),
// so a `{ type: baseRef }` query — the same kind-spanning base filter the
// search sheet uses — returns it alongside card instances.
const README_MD = `# Readme

Some notes.
`;

const authorInstanceId = `${testRealmURL}Author/1`;
const fileId = `${testRealmURL}notes/readme.md`;

module(
  'Integration | card-chooser (mixed cards + files mode)',
  function (hooks) {
    setupRenderingTest(hooks);
    setupOperatorModeStateCleanup(hooks);
    setupLocalIndexing(hooks);

    let mockMatrixUtils = setupMockMatrix(hooks, {
      loggedInAs: '@testuser:localhost',
      activeRealms: [baseRealm.url, testRealmURL],
      autostart: true,
    });

    hooks.beforeEach(async function () {
      let loader = getService('loader-service').loader;
      let cardApi: typeof import('@cardstack/base/card-api');
      let string: typeof import('@cardstack/base/string');
      let cardsGrid: typeof import('@cardstack/base/cards-grid');
      cardApi = await loader.import('@cardstack/base/card-api');
      string = await loader.import('@cardstack/base/string');
      cardsGrid = await loader.import('@cardstack/base/cards-grid');

      let { field, contains, CardDef } = cardApi;
      let { default: StringField } = string;
      let { CardsGrid } = cardsGrid;

      class Author extends CardDef {
        static displayName = 'Author';
        @field firstName = contains(StringField);
      }

      await setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {
          'author.gts': { Author },
          'Author/1.json': new Author({ firstName: 'Alice' }),
          'notes/readme.md': README_MD,
          'realm.json': realmConfigCardJSON({
            name: 'Local Workspace',
            iconURL: 'https://example-icon.test',
          }),
          'index.json': new CardsGrid(),
        },
      });

      getService('operator-mode-state-service').restore({
        stacks: [[{ id: `${testRealmURL}index`, format: 'isolated' }]],
      });
      await renderComponent(
        class TestDriver extends GlimmerComponent {
          <template><OperatorMode @onClose={{noop}} /></template>
        },
      );
      await waitFor(`[data-test-stack-card="${testRealmURL}index"]`);
    });

    test('surfaces both a card instance and a file, and resolves kind-tagged picks', async function (assert) {
      let pending = chooseCard(
        { filter: { type: baseRef }, realms: [testRealmURL] },
        { includeFiles: true, multiSelect: true },
      );

      await waitFor('[data-test-card-chooser-modal]');
      // Both kinds surface: the card instance and the markdown file appear as
      // selectable result tiles in the one mixed list.
      await waitFor(`[data-test-item-button="${authorInstanceId}"]`);
      await waitFor(`[data-test-item-button="${fileId}"]`);
      assert
        .dom(`[data-test-item-button="${authorInstanceId}"]`)
        .exists('the card instance surfaces as a result tile');
      assert
        .dom(`[data-test-item-button="${fileId}"]`)
        .exists('the file surfaces as a result tile in the same mixed list');

      await click(`[data-test-item-button="${authorInstanceId}"]`);
      await click(`[data-test-item-button="${fileId}"]`);
      await click('[data-test-card-chooser-go-button]');

      let result = await pending;
      assert.ok(result, 'the chooser resolves with the picks');
      let byId = new Map((result ?? []).map((item) => [item.id, item.kind]));
      assert.strictEqual(
        byId.get(authorInstanceId),
        'card',
        'the card instance pick is tagged kind=card',
      );
      assert.strictEqual(
        byId.get(fileId),
        'file',
        'the file pick is tagged kind=file',
      );
      assert.strictEqual(
        result?.length,
        2,
        'exactly the two picks are returned',
      );
    });
  },
);
