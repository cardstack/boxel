import {
  click,
  rerender,
  waitFor,
  type RenderingTestContext,
} from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import {
  baseRealm,
  rri,
  type LooseSingleCardDocument,
  type Realm,
} from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common/loader';

import OperatorMode from '@cardstack/host/components/operator-mode/container';
import type StoreService from '@cardstack/host/services/store';

import {
  testRealmURL,
  realmConfigCardJSON,
  setupCardLogs,
  setupLocalIndexing,
  setupIntegrationTestRealm,
  setupOperatorModeStateCleanup,
} from '../helpers';
import { setupBaseRealm } from '../helpers/base-realm';
import { setupCatalogTestSubset } from '../helpers/catalog-test-subset';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { renderComponent } from '../helpers/render-component';
import { setupRenderingTest } from '../helpers/setup';

import type { CardDef } from '@cardstack/base/card-api';

const CONFIG = `${testRealmURL}realm`;
const POLICY = `${testRealmURL}policies/education`;
const MISSING = `${testRealmURL}policies/no-such-card`;
const NOTE = `${testRealmURL}notes/n1`;

const CARD_DEF = { module: rri('@cardstack/base/card-api'), name: 'CardDef' };

const noop = () => {};

// Anyone may read every card in the realm, and every grant compiles.
const policy: LooseSingleCardDocument = {
  data: {
    type: 'card',
    attributes: {
      cardInfo: { name: 'Education' },
      rules: [{ targetType: CARD_DEF, grants: [{ operation: 'read' }] }],
    },
    meta: {
      adoptsFrom: {
        module: rri('@cardstack/catalog/realm-policy/realm-policy'),
        name: 'RealmPolicy',
      },
    },
  },
};

const note: LooseSingleCardDocument = {
  data: {
    type: 'card',
    attributes: { cardInfo: { name: 'A note' } },
    meta: { adoptsFrom: CARD_DEF },
  },
};

type RealmConfig = CardDef & { policy?: string };

// The realm's config card shows the policy card its pointer names, and
// whether that policy is in force, beside the pointer, including the problems
// with the pointer itself.
module('Integration | realm config policy standing', function (hooks) {
  setupRenderingTest(hooks);
  setupOperatorModeStateCleanup(hooks);
  setupBaseRealm(hooks);
  setupCatalogTestSubset(hooks);
  setupLocalIndexing(hooks);

  let loader: Loader;
  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [baseRealm.url, testRealmURL],
    autostart: true,
  });

  hooks.beforeEach(function (this: RenderingTestContext) {
    loader = getService('loader-service').loader;
  });

  setupCardLogs(
    hooks,
    async () => await loader.import('@cardstack/base/card-api'),
  );

  // Rendered in operator mode, which is where a realm owner reads and edits
  // the config card: it provides the session's permissions, its capability
  // checks, and the stack a clicked card opens in. The in-browser realm
  // serves the test's requests without vouching for a session, so the card's
  // validate is asked by nobody, and nobody is told a policy's standing only
  // in a realm anyone may read.
  async function renderConfig(
    pointer: string | undefined,
    format: 'isolated' | 'edit' = 'isolated',
  ): Promise<{ realm: Realm; config: RealmConfig }> {
    let { realm } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      permissions: {
        '*': ['read'],
        '@testuser:localhost': ['read', 'write', 'realm-owner'],
      },
      contents: {
        'realm.json': realmConfigCardJSON({
          name: 'Education',
          ...(pointer !== undefined ? { policy: pointer } : {}),
        }),
        'policies/education.json': policy,
        'notes/n1.json': note,
      },
    });
    await getService('realm').login(testRealmURL);
    // Looking the service up arms the transport the card's own
    // `operations()` call sends its validate through.
    getService('operations');
    getService('operator-mode-state-service').restore({
      stacks: [[{ id: CONFIG, format }]],
    });
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    await waitFor(`[data-test-stack-card="${CONFIG}"]`);
    await waitFor('[data-test-realm-policy-standing="answered"]', {
      timeout: 10_000,
    });
    let store = getService('store') as StoreService;
    let config = (await store.get(CONFIG)) as RealmConfig;
    return { realm, config };
  }

  function issuesShown() {
    return [...document.querySelectorAll('[data-test-realm-policy-issue]')].map(
      (el) => el.getAttribute('data-test-realm-policy-issue'),
    );
  }

  test('the policy card the pointer names renders in its fitted view, and opens in a stack of its own', async function (assert) {
    await renderConfig(POLICY);
    await waitFor('[data-test-realm-config-policy-card="shown"]');
    assert
      .dom('[data-test-realm-config-policy-card-fitted]')
      .containsText('Education', "the policy card's own fitted view renders");
    assert
      .dom('[data-test-realm-config-policy-pointer]')
      .hasText(POLICY, 'with the pointer beneath it');
    assert
      .dom('[data-test-realm-policy-status="in-force"]')
      .hasText('In force');
    assert.deepEqual(issuesShown(), [], 'and no issue is listed');

    await click('[data-test-realm-config-policy-card-fitted]');
    await waitFor('[data-test-stack-card-index="1"]');
    assert
      .dom(`[data-test-stack-card-index="1"][data-test-stack-card="${POLICY}"]`)
      .exists('clicking the card opens the policy in a new stack item');
  });

  test('a pointer to a card the index does not hold shows policy-card-missing, and no card', async function (assert) {
    await renderConfig(MISSING);
    assert
      .dom('[data-test-realm-config-policy-pointer]')
      .hasText(MISSING, 'the pointer is shown as written');
    assert
      .dom('[data-test-realm-policy-status="not-in-force"]')
      .exists('the policy is shown as not in force');
    assert.deepEqual(issuesShown(), ['policy-card-missing']);
    assert
      .dom('[data-test-realm-policy-issue="policy-card-missing"]')
      .includesText(MISSING, 'the issue names the card the pointer names');
    await waitFor('[data-test-realm-config-policy-card]');
    assert
      .dom('[data-test-realm-config-policy-card]')
      .hasAttribute(
        'data-test-realm-config-policy-card',
        'missing',
        'a reader of the realm is told there is no card at the URL',
      );
    assert
      .dom('[data-test-realm-config-policy-card-fitted]')
      .doesNotExist('there is no card to render');
  });

  test('a pointer to a card that is not a policy shows not-a-policy, beside that card', async function (assert) {
    await renderConfig(NOTE);
    assert
      .dom('[data-test-realm-policy-status="not-in-force"]')
      .exists('the policy is shown as not in force');
    assert.deepEqual(issuesShown(), ['not-a-policy']);
    await waitFor('[data-test-realm-config-policy-card="shown"]');
    assert
      .dom('[data-test-realm-config-policy-card-fitted]')
      .containsText('A note', 'the card the pointer names is the one shown');
  });

  test('the problem shows beside the pointer where it is edited', async function (assert) {
    await renderConfig(MISSING, 'edit');
    assert
      .dom(
        '[data-test-field="policy"] [data-test-realm-policy-issue="policy-card-missing"]',
      )
      .exists('the issue is shown in the policy field’s row');
  });

  test('choosing a policy from the card chooser clears the issue once the save lands', async function (assert) {
    await renderConfig(MISSING, 'edit');
    assert.deepEqual(issuesShown(), ['policy-card-missing']);

    await click('[data-test-realm-config-policy-remove]');
    await click('[data-test-realm-config-policy-choose]');
    await waitFor(`[data-test-item-button="${POLICY}"]`, { timeout: 10_000 });
    await click(`[data-test-item-button="${POLICY}"]`);
    await click('[data-test-card-chooser-go-button]');

    await waitFor('[data-test-realm-policy-status="in-force"]', {
      timeout: 10_000,
    });
    assert.deepEqual(issuesShown(), [], 'the issue is gone');
    await waitFor('[data-test-realm-config-policy-card="shown"]');
    assert
      .dom(
        '[data-test-field="policy"] [data-test-realm-config-policy-card-fitted]',
      )
      .containsText('Education', 'and the chosen card renders in its place');
    assert
      .dom('[data-test-field="policy"] [data-test-realm-config-policy-pointer]')
      .hasText(POLICY, 'with its id beneath it, which is what is stored');
  });

  test('a policy created from the card chooser is named at once, and shows as being created until it is saved', async function (assert) {
    let { config } = await renderConfig(undefined, 'edit');

    await click('[data-test-realm-config-policy-choose]');
    await waitFor(`[data-test-item-button-create-new="${testRealmURL}"]`, {
      timeout: 10_000,
    });
    // Not awaited, since a click waits for everything it sets going, the
    // card's save included, and what shows while the save is in flight is
    // what this looks at.
    let created = click(`[data-test-item-button-create-new="${testRealmURL}"]`);

    await waitFor('[data-test-realm-config-policy-card="creating"]', {
      timeout: 10_000,
    });
    assert
      .dom('[data-test-card-chooser-modal]')
      .doesNotExist('the chooser is dismissed without waiting for the save');
    let expected = config.policy!;
    assert.true(
      new RegExp(`^${testRealmURL}RealmPolicy/[0-9a-f-]{36}$`).test(expected),
      `the pointer names the id the realm will give the new card: ${expected}`,
    );
    assert
      .dom('[data-test-field="policy"] [data-test-realm-config-policy-pointer]')
      .hasText(expected, 'and shows it');
    assert
      .dom('[data-test-realm-config-policy-card-busy]')
      .hasText('Creating the policy…', 'the card shows as being created');
    assert
      .dom('[data-test-realm-config-policy-card-fitted]')
      .doesNotExist('there is no card to render yet');
    assert
      .dom('[data-test-realm-policy-standing]')
      .doesNotExist('nor a standing to report');
    assert
      .dom('[data-test-realm-config-policy-remove]')
      .exists('and it can be removed like any chosen policy');

    await created;
    await waitFor('[data-test-realm-config-policy-card="shown"]', {
      timeout: 10_000,
    });
    assert
      .dom('[data-test-realm-config-policy-card-busy]')
      .doesNotExist('once saved, the card is no longer being created');
    assert
      .dom(
        '[data-test-field="policy"] [data-test-realm-config-policy-card-fitted]',
      )
      .exists('and its fitted view renders in its place');
    assert.strictEqual(
      config.policy,
      expected,
      'the realm gave the card the id the pointer names',
    );
    assert
      .dom(`[data-test-stack-card="${expected}"]`)
      .exists('the new policy opens in a stack item of its own to be written');

    await waitFor('[data-test-realm-policy-status="in-force"]', {
      timeout: 10_000,
    });
    assert
      .dom('[data-test-realm-policy-status="in-force"]')
      .hasText('In force', 'and the policy it names is in force');
  });

  test('a policy removed while it is being created stays removed once it is saved', async function (assert) {
    let { config } = await renderConfig(undefined, 'edit');

    await click('[data-test-realm-config-policy-choose]');
    await waitFor(`[data-test-item-button-create-new="${testRealmURL}"]`, {
      timeout: 10_000,
    });
    let created = click(`[data-test-item-button-create-new="${testRealmURL}"]`);
    await waitFor('[data-test-realm-config-policy-card="creating"]', {
      timeout: 10_000,
    });

    await click('[data-test-realm-config-policy-remove]');
    assert
      .dom('[data-test-realm-config-policy-card-busy]')
      .doesNotExist('the card no longer shows as being created');
    assert
      .dom('[data-test-field="policy"] [data-test-realm-config-policy-choose]')
      .exists('and the chooser is offered again');

    await created;
    assert.notOk(
      config.policy,
      'the save landing afterwards does not name the card again',
    );
    assert
      .dom('[data-test-field="policy"] [data-test-realm-config-policy-choose]')
      .exists('and the chooser is still offered');
  });

  test('a realm with no policy offers the card chooser where the pointer is edited', async function (assert) {
    await renderConfig(undefined, 'edit');
    assert
      .dom('[data-test-field="policy"] [data-test-realm-config-policy-choose]')
      .hasText('Link Realm Policy');
    assert.dom('[data-test-realm-config-policy-remove]').doesNotExist();
  });

  test('an answer about the saved pointer is not shown beside a different one', async function (assert) {
    let { config } = await renderConfig(MISSING, 'edit');
    assert.deepEqual(issuesShown(), ['policy-card-missing']);

    config.policy = POLICY;
    await rerender();
    assert
      .dom('[data-test-realm-policy-status]')
      .doesNotExist(
        'the standing of the saved pointer is not shown beside a pointer typed since',
      );

    await waitFor('[data-test-realm-policy-status="in-force"]', {
      timeout: 10_000,
    });
    assert.deepEqual(
      issuesShown(),
      [],
      'once the save lands, the realm reports the fixed pointer in force',
    );
  });

  test('removing a policy in force clears the pointer, and the realm names no policy once the save lands', async function (assert) {
    let { realm, config } = await renderConfig(POLICY, 'edit');
    await waitFor('[data-test-realm-config-policy-card="shown"]');
    assert.dom('[data-test-realm-policy-status="in-force"]').exists();

    await click('[data-test-realm-config-policy-remove]');
    assert.notOk(config.policy, 'the pointer is cleared');
    assert
      .dom('[data-test-realm-config-policy-card-fitted]')
      .doesNotExist('the policy card is no longer shown');
    assert.dom('[data-test-realm-config-policy-remove]').doesNotExist();
    assert
      .dom('[data-test-realm-config-policy-choose]')
      .exists('and another policy can be chosen');
    assert
      .dom('[data-test-realm-policy-status]')
      .doesNotExist('a realm that names no policy has no standing');

    let named: unknown = await realm.getRealmPolicy();
    for (let tries = 0; named !== undefined && tries < 50; tries++) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      named = await realm.getRealmPolicy();
    }
    assert.strictEqual(
      named,
      undefined,
      'once the save lands, the realm reads no policy from realm.json',
    );
  });

  test('removing the policy takes its standing away at once, and offers the chooser', async function (assert) {
    await renderConfig(MISSING, 'edit');
    assert.deepEqual(issuesShown(), ['policy-card-missing']);

    await click('[data-test-realm-config-policy-remove]');
    assert
      .dom('[data-test-realm-policy-status]')
      .doesNotExist('an empty pointer is not shown the old pointer’s problem');
    assert.dom('[data-test-realm-config-policy-choose]').exists();
  });

  test('creating the card the pointer names clears the issue', async function (assert) {
    let { realm } = await renderConfig(MISSING);
    assert.deepEqual(issuesShown(), ['policy-card-missing']);

    await realm.write('policies/no-such-card.json', JSON.stringify(policy));
    await waitFor('[data-test-realm-policy-status="in-force"]', {
      timeout: 10_000,
    });
    assert.deepEqual(
      issuesShown(),
      [],
      'the realm reports the policy in force',
    );
  });

  test('a realm with no policy shows no issue affordance', async function (assert) {
    await renderConfig(undefined);
    assert
      .dom('[data-test-realm-config-policy-none]')
      .hasText(
        "No policy. The realm's permissions alone decide who may do what.",
      );
    assert
      .dom('[data-test-realm-policy-status]')
      .doesNotExist('nothing is said about a policy the realm does not name');
    assert.dom('[data-test-realm-config-policy-card]').doesNotExist();
  });

  test('a pointer the realm cannot read as a card id says the realm names no policy', async function (assert) {
    await renderConfig('policies/education');
    assert
      .dom('[data-test-realm-policy-status="unread-pointer"]')
      .exists('the realm dropped a relative pointer, and the card says so');
    assert.deepEqual(issuesShown(), []);
  });
});
