import { waitFor, click, fillIn } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';

import OperatorMode from '@cardstack/host/components/operator-mode/container';

import {
  testRealmURL,
  setupLocalIndexing,
  setupIntegrationTestRealm,
  setupOperatorModeStateCleanup,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { renderComponent } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

const realmName = 'Local Workspace';
const noop = () => {};

module(
  'Integration | realm-config | routing rule instance editor',
  function (hooks) {
    setupRenderingTest(hooks);
    setupOperatorModeStateCleanup(hooks);
    setupLocalIndexing(hooks);

    let mockMatrixUtils = setupMockMatrix(hooks, {
      loggedInAs: '@testuser:localhost',
      activeRealms: [baseRealm.url, testRealmURL],
      autostart: true,
    });

    async function renderRealmConfigEdit(
      hostRoutingRules: Array<Record<string, unknown>>,
    ) {
      let loader = getService('loader-service').loader;
      let cardApi: typeof import('https://cardstack.com/base/card-api') =
        await loader.import(`${baseRealm.url}card-api`);
      let string: typeof import('https://cardstack.com/base/string') =
        await loader.import(`${baseRealm.url}string`);
      let cardsGrid: typeof import('https://cardstack.com/base/cards-grid') =
        await loader.import(`${baseRealm.url}cards-grid`);

      let { field, contains, CardDef } = cardApi;
      let { default: StringField } = string;
      let { CardsGrid } = cardsGrid;

      class Pet extends CardDef {
        static displayName = 'Pet';
        @field name = contains(StringField);
      }

      await setupIntegrationTestRealm({
        mockMatrixUtils,
        permissions: {
          '@testuser:localhost': ['read', 'write', 'realm-owner'],
        },
        contents: {
          'pet.gts': { Pet },
          '.realm.json': `{ "name": "${realmName}" }`,
          'Pet/mango.json': new Pet({ name: 'Mango' }),
          'index.json': new CardsGrid(),
          'realm.json': {
            data: {
              type: 'card',
              attributes: { hostRoutingRules },
              meta: {
                adoptsFrom: {
                  module: 'https://cardstack.com/base/realm-config',
                  name: 'RealmConfig',
                },
              },
            },
          },
        },
      });

      let operatorModeStateService = getService('operator-mode-state-service');
      operatorModeStateService.restore({
        stacks: [[{ id: `${testRealmURL}realm`, format: 'edit' }]],
      });

      await renderComponent(
        class TestDriver extends GlimmerComponent {
          <template><OperatorMode @onClose={{noop}} /></template>
        },
      );
      await waitFor(`[data-test-stack-card="${testRealmURL}realm"]`);
    }

    test('the card chooser is locked to the consuming realm', async function (assert) {
      await renderRealmConfigEdit([{ path: '/docs' }]);

      await click('[data-test-add-new="instance"]');
      await waitFor('[data-test-card-catalog-modal]');
      // Wait on `data-test-realm-url` (always present) rather than
      // `data-test-realm` (the user-visible name, which races
      // `realm.info()` and may show the "Unknown Workspace"
      // placeholder during initial render — search-result-section.gts
      // documents the race).
      await waitFor(
        `[data-test-card-catalog-modal] [data-test-realm-url="${testRealmURL}"]`,
      );
      // The realm picker is wrapped in WithKnownRealmsLoaded, which
      // renders a `<:loading>` block (no `data-test-realm-picker-locked`
      // attribute) until the realms list resolves. Wait for the loaded
      // state so the picker-locked assertion has something to match.
      // Scoped to `[data-test-card-catalog-modal]` because the
      // operator-mode SearchSheet renders its own (unscoped, unlocked)
      // SearchPanel + RealmPicker — without scoping, the assertions
      // pick up that picker instead of the modal's.
      await waitFor(
        '[data-test-card-catalog-modal] [data-test-realm-picker-locked]',
      );

      assert
        .dom('[data-test-card-catalog-modal] [data-test-realm-picker-locked]')
        .hasAttribute(
          'data-test-realm-picker-locked',
          'true',
          'the realm picker is locked',
        );
      assert
        .dom(
          '[data-test-card-catalog-modal] [data-test-realm-picker-locked="true"] [data-test-boxel-picker-remove-button]',
        )
        .doesNotExist(
          'the consuming-realm pill does not offer a remove affordance when the picker is locked',
        );
      assert
        .dom(
          `[data-test-card-catalog-modal] [data-test-realm-url="${testRealmURL}"]`,
        )
        .exists('candidates from the consuming realm are shown');
      assert
        .dom(
          `[data-test-card-catalog-modal] [data-test-realm-url="${baseRealm.url}"]`,
        )
        .doesNotExist('cross-realm candidates are excluded by the lock');
    });

    test('renders a per-rule warning when a path is malformed', async function (assert) {
      await renderRealmConfigEdit([
        { path: 'docs' }, // missing leading slash
        { path: '/foo bar' }, // disallowed character
      ]);

      let warningTexts = [
        ...document.querySelectorAll('[data-test-path-warning]'),
      ].map((el) => el.textContent?.trim() ?? '');

      assert.strictEqual(
        warningTexts.length,
        2,
        'one warning per malformed rule',
      );
      assert.ok(
        warningTexts.some((t) => t.includes('Path must start with /')),
        'missing-slash warning is rendered',
      );
      assert.ok(
        warningTexts.some((t) =>
          t.includes('Path may only contain letters, numbers'),
        ),
        'invalid-characters warning is rendered',
      );
    });

    test('renders the aggregate duplicate-path warning when paths repeat', async function (assert) {
      await renderRealmConfigEdit([
        { path: '/docs' },
        { path: '/docs' },
        { path: '/pricing' },
      ]);

      assert
        .dom('[data-test-duplicate-path-warning]')
        .exists('the duplicate banner is shown');
      assert
        .dom('[data-test-duplicate-path-warning]')
        .containsText('/docs', 'the duplicate banner names the repeated path');
    });

    test('rules with unset paths warn as duplicates of explicit "/" rules', async function (assert) {
      // A rule with no path stored is rendered exactly like one with
      // path "/" (the slash accessory is always present and the input
      // is empty for both), so the duplicate-path warning should treat
      // them as the conflict the user sees. The edit component is
      // expected to normalize unset paths to "/" on mount.
      await renderRealmConfigEdit([{ path: '/' }, {}]);

      assert
        .dom('[data-test-duplicate-path-warning]')
        .exists('the duplicate banner is shown for visually-equal "/" rules');
      assert
        .dom('[data-test-duplicate-path-warning]')
        .containsText('/', 'the duplicate banner names the conflicting path');
    });

    test('typing into the path input always stores a leading slash', async function (assert) {
      await renderRealmConfigEdit([{}]);

      assert
        .dom('[data-test-path-warning]')
        .doesNotExist('no warning before any input');

      await fillIn('[data-test-path-input] input', 'docs');
      assert
        .dom('[data-test-path-warning]')
        .doesNotExist(
          'typed text is stored with a leading slash, so the missing-slash warning does not fire',
        );

      await fillIn('[data-test-path-input] input', '/foo');
      assert
        .dom('[data-test-path-warning]')
        .doesNotExist(
          'a typed leading slash is not doubled — the accessory remains the only slash',
        );

      await fillIn('[data-test-path-input] input', '//foo');
      assert
        .dom('[data-test-path-warning]')
        .doesNotExist('multiple leading slashes collapse to one');
    });
  },
);
