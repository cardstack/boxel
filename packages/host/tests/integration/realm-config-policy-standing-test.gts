import { waitFor, type RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import {
  rri,
  type LooseSingleCardDocument,
  type Realm,
} from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common/loader';

import type StoreService from '@cardstack/host/services/store';

import {
  testRealmURL,
  realmConfigCardJSON,
  setupCardLogs,
  setupLocalIndexing,
  setupIntegrationTestRealm,
} from '../helpers';
import { setupBaseRealm } from '../helpers/base-realm';
import { setupCatalogTestSubset } from '../helpers/catalog-test-subset';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { renderCard } from '../helpers/render-component';
import { setupRenderingTest } from '../helpers/setup';

import type { CardDef } from '@cardstack/base/card-api';

const POLICY = `${testRealmURL}policies/education`;
const MISSING = `${testRealmURL}policies/no-such-card`;
const NOTE = `${testRealmURL}notes/n1`;

const CARD_DEF = { module: rri('@cardstack/base/card-api'), name: 'CardDef' };

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

// The realm's config card shows whether the policy its pointer names is in
// force, beside the pointer, including the problems with the pointer itself.
module('Integration | realm config policy standing', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  setupCatalogTestSubset(hooks);
  setupLocalIndexing(hooks);

  let loader: Loader;
  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });

  hooks.beforeEach(function (this: RenderingTestContext) {
    loader = getService('loader-service').loader;
  });

  setupCardLogs(
    hooks,
    async () => await loader.import('@cardstack/base/card-api'),
  );

  // The in-browser realm serves the test's requests without vouching for a
  // session, so the card's validate is asked by nobody, and nobody is told a
  // policy's standing only in a realm anyone may read.
  async function renderConfig(
    pointer: string | undefined,
    format: 'isolated' | 'edit' = 'isolated',
  ): Promise<Realm> {
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
    let store = getService('store') as StoreService;
    let config = (await store.get(`${testRealmURL}realm`)) as CardDef;
    await renderCard(loader, config, format);
    await waitFor('[data-test-realm-policy-standing="answered"]', {
      timeout: 10_000,
    });
    return realm;
  }

  function issuesShown() {
    return [...document.querySelectorAll('[data-test-realm-policy-issue]')].map(
      (el) => el.getAttribute('data-test-realm-policy-issue'),
    );
  }

  test('a pointer to a card the index does not hold shows policy-card-missing', async function (assert) {
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
  });

  test('a pointer to a card that is not a policy shows not-a-policy', async function (assert) {
    await renderConfig(NOTE);
    assert
      .dom('[data-test-realm-policy-status="not-in-force"]')
      .exists('the policy is shown as not in force');
    assert.deepEqual(issuesShown(), ['not-a-policy']);
  });

  test('the problem shows beside the pointer where it is edited', async function (assert) {
    await renderConfig(MISSING, 'edit');
    assert
      .dom(
        '[data-test-field="policy"] [data-test-realm-policy-issue="policy-card-missing"]',
      )
      .exists('the issue is shown in the policy field’s row');
  });

  test('fixing the pointer clears the issue', async function (assert) {
    let realm = await renderConfig(MISSING);
    assert.deepEqual(issuesShown(), ['policy-card-missing']);

    await realm.write(
      'realm.json',
      realmConfigCardJSON({ name: 'Education', policy: POLICY }),
    );
    await waitFor('[data-test-realm-policy-status="in-force"]', {
      timeout: 10_000,
    });
    assert.deepEqual(issuesShown(), [], 'the issue is gone');
    assert
      .dom('[data-test-realm-policy-status="not-in-force"]')
      .doesNotExist('and the policy is no longer shown as not in force');
  });

  test('a policy that compiles shows as in force with no issue affordance', async function (assert) {
    await renderConfig(POLICY);
    assert
      .dom('[data-test-realm-policy-status="in-force"]')
      .hasText('In force.');
    assert.deepEqual(issuesShown(), [], 'no issue is listed');
    assert.dom('[data-test-realm-policy-status="not-in-force"]').doesNotExist();
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
  });

  test('a pointer the realm cannot read as a card id says the realm names no policy', async function (assert) {
    await renderConfig('policies/education');
    assert
      .dom('[data-test-realm-policy-status="unread-pointer"]')
      .exists('the realm dropped a relative pointer, and the card says so');
    assert.deepEqual(issuesShown(), []);
  });
});
