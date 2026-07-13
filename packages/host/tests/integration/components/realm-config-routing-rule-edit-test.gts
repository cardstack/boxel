import { waitFor, click, fillIn } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import {
  baseRealm,
  PermissionsContextName,
  type Permissions,
} from '@cardstack/runtime-common';

import OperatorMode from '@cardstack/host/components/operator-mode/container';

import {
  testRealmURL,
  provideConsumeContext,
  setupLocalIndexing,
  setupIntegrationTestRealm,
  setupOperatorModeStateCleanup,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { renderCard, renderComponent } from '../../helpers/render-component';
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
      relationships?: Record<string, unknown>,
    ) {
      let loader = getService('loader-service').loader;
      let cardApi: typeof import('@cardstack/base/card-api') =
        await loader.import('@cardstack/base/card-api');
      let string: typeof import('@cardstack/base/string') = await loader.import(
        '@cardstack/base/string',
      );
      let cardsGrid: typeof import('@cardstack/base/cards-grid') =
        await loader.import('@cardstack/base/cards-grid');

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
              ...(relationships ? { relationships } : {}),
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
      await waitFor('[data-test-card-chooser-modal]');
      // Wait on `data-test-realm-url` (always present) rather than
      // `data-test-realm` (the user-visible name, which races
      // `realm.info()` and may show the "Unknown Workspace"
      // placeholder during initial render — search-result-section.gts
      // documents the race).
      await waitFor(
        `[data-test-card-chooser-modal] [data-test-realm-url="${testRealmURL}"]`,
      );
      // The realm picker is wrapped in WithKnownRealmsLoaded, which
      // renders a `<:loading>` block until the realms list resolves;
      // the actual picker trigger is only present in the `<:default>`
      // block. Wait for it. Scoping to `[data-test-card-chooser-modal]`
      // dodges the operator-mode SearchSheet, which renders its own
      // (unlocked) RealmPicker alongside the modal's.
      await waitFor('[data-test-card-chooser-modal] [data-test-realm-picker]');

      // power-select reflects `@disabled` on the trigger as
      // `aria-disabled="true"` — this is the reliable signal for
      // "the realm picker is locked". A custom dynamic data-test
      // attribute bound through Picker's `...attributes` does not
      // round-trip its reactivity through the BoxelMultiSelectBasic →
      // PowerSelect → ember-basic-dropdown chain.
      assert
        .dom('[data-test-card-chooser-modal] [data-test-realm-picker]')
        .hasAttribute('aria-disabled', 'true', 'the realm picker is locked');
      // The picker's selected pill must NOT be the "All" / "Select All"
      // option. If `consumingRealm` doesn't reach the chooser,
      // `initialSelectedRealmsForPanel` returns undefined,
      // `selectedRealms` stays empty, and `pickerSelected` falls back
      // to the `Select All (...)` option (labeled "All") — meaning
      // search is unscoped (the original code-submode bug).
      // Check the selected-pill's own `data-test-boxel-picker-selected-item`
      // value rather than the realm name, because the user-visible
      // realm name comes from `realm.info()` and shows the
      // "Unnamed Workspace" placeholder until that async fetch resolves.
      assert
        .dom(
          '[data-test-card-chooser-modal] [data-test-realm-picker] [data-test-boxel-picker-selected-item="All"]',
        )
        .doesNotExist(
          'the realm picker is scoped to a specific realm, not the unscoped "All" select-all pill',
        );
      assert
        .dom(
          '[data-test-card-chooser-modal] [data-test-realm-picker] [data-test-boxel-picker-remove-button]',
        )
        .doesNotExist(
          'the consuming-realm pill does not offer a remove affordance when the picker is locked',
        );
      assert
        .dom(
          `[data-test-card-chooser-modal] [data-test-realm-url="${testRealmURL}"]`,
        )
        .exists('candidates from the consuming realm are shown');
      assert
        .dom(
          `[data-test-card-chooser-modal] [data-test-realm-url="${baseRealm.url}"]`,
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

    test('warns when a routing rule points to a card that no longer exists', async function (assert) {
      // The rule links to a card that was never created in the realm, so
      // its `instance` linksTo resolves to a 404 (not-found) once the
      // editor tries to load it. The aggregate warning names the path so
      // the owner can repair or remove the rule before publishing.
      await renderRealmConfigEdit([{ path: '/gone' }], {
        'hostRoutingRules.0.instance': {
          links: { self: './does-not-exist' },
        },
      });

      await waitFor('[data-test-dangling-routing-warning]');
      assert
        .dom('[data-test-dangling-routing-warning]')
        .exists('the dangling-routing banner is shown');
      assert
        .dom('[data-test-dangling-routing-warning]')
        .containsText(
          '/gone',
          'the banner names the path with the dead target',
        );
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

    test('the chooser gets a consuming realm even when no RealmURLContext is provided (code submode)', async function (assert) {
      // The interact-submode test above renders the realm config
      // through an operator-mode stack item, which provides
      // `RealmURLContext` — so LinksToEditor could derive
      // `consumingRealm` either from that context or from the
      // explicit `@consumingRealm` arg threaded by RoutingRuleEdit.
      // In code submode the realm config renders through the
      // playground / spec preview, OUTSIDE any stack item, so
      // `RealmURLContext` is absent.
      //
      // Reproduce that condition directly: load the realm config from
      // the realm (so its FieldDef instances have `[realmContext]`
      // populated by `propagateRealmContext`) and render it via
      // `renderCard`, which does not provide any operator-mode
      // context. Then stub the global card-chooser registration to
      // capture the opts that `chooseCard()` was invoked with, so the
      // test can prove `consumingRealm` (and a derived
      // `lockConsumingRealm`) flow through the model-level derivation
      // rather than the context fallback.
      let cardApi: typeof import('@cardstack/base/card-api') = await getService(
        'loader-service',
      ).loader.import('@cardstack/base/card-api');

      await setupIntegrationTestRealm({
        mockMatrixUtils,
        permissions: {
          '@testuser:localhost': ['read', 'write', 'realm-owner'],
        },
        contents: {
          '.realm.json': `{ "name": "${realmName}" }`,
          'realm.json': {
            data: {
              type: 'card',
              attributes: { hostRoutingRules: [{ path: '/docs' }] },
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

      let store = getService('store');
      let realmConfig = await store.get(`${testRealmURL}realm`);

      let capturedOpts: any;
      let originalChooser = (globalThis as any)._CARDSTACK_CARD_CHOOSER;
      (globalThis as any)._CARDSTACK_CARD_CHOOSER = {
        chooseCard: async (_query: any, opts: any) => {
          capturedOpts = opts;
          return undefined;
        },
      };

      // LinksToEditor only renders its add-new affordance when
      // `permissions.canWrite` is truthy — that's normally provided by
      // the stack item (interact) or the playground panel (code) via
      // `PermissionsContext`. Without operator-mode mounted, the test
      // has to provide it explicitly, otherwise LinksToEditor renders
      // its "- Empty -" placeholder and `[data-test-add-new]` is
      // missing.
      let permissions: Permissions = { canRead: true, canWrite: true };
      provideConsumeContext(PermissionsContextName, permissions);

      try {
        await renderCard(
          getService('loader-service').loader,
          realmConfig as InstanceType<typeof cardApi.CardDef>,
          'edit',
        );
        await waitFor('[data-test-add-new="instance"]');
        await click('[data-test-add-new="instance"]');

        assert.ok(capturedOpts, 'chooseCard was invoked');
        assert.strictEqual(
          (capturedOpts?.consumingRealm as URL | undefined)?.href,
          testRealmURL,
          'consumingRealm reaches the chooser via @consumingRealm, not RealmURLContext',
        );
        assert.true(
          capturedOpts?.lockConsumingRealm,
          'lockConsumingRealm is honored when a consumingRealm is actually present',
        );
      } finally {
        (globalThis as any)._CARDSTACK_CARD_CHOOSER = originalChooser;
      }
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
