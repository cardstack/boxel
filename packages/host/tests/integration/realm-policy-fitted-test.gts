import type { RenderingTestContext } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { rri, type LooseSingleCardDocument } from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common/loader';

import type StoreService from '@cardstack/host/services/store';

import {
  testRealmURL,
  setupCardLogs,
  setupLocalIndexing,
  setupIntegrationTestRealm,
} from '../helpers';
import { setupBaseRealm } from '../helpers/base-realm';
import { setupCatalogTestSubset } from '../helpers/catalog-test-subset';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { renderComponent } from '../helpers/render-component';
import { setupRenderingTest } from '../helpers/setup';

import type * as CardAPI from '@cardstack/base/card-api';

const CLASSROOM = { module: '../classroom', name: 'Classroom' };
const SCHEDULE = { module: '../schedule', name: 'Schedule' };

function policyDocument(
  rules: Record<string, unknown>[],
): LooseSingleCardDocument {
  return {
    data: {
      type: 'card',
      attributes: { cardInfo: { name: 'Education' }, rules },
      meta: {
        adoptsFrom: {
          module: rri('@cardstack/catalog/realm-policy/realm-policy'),
          name: 'RealmPolicy',
        },
      },
    },
  };
}

// A policy card's fitted view, which a card that shows the policy it names,
// such as a realm's config card, renders: the policy's title, how many rules
// and grants it holds, and, where there is room, each rule's type with the
// operations it grants.
module('Integration | realm policy fitted view', function (hooks) {
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

  async function renderFitted(
    rules: Record<string, unknown>[],
    size: { width: number; height: number },
  ) {
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: { 'policies/education.json': policyDocument(rules) },
    });
    let store = getService('store') as StoreService;
    let policy = (await store.get(
      `${testRealmURL}policies/education`,
    )) as CardAPI.CardDef;
    let api = await loader.import<typeof CardAPI>('@cardstack/base/card-api');
    let Policy = api.getComponent(policy);
    let style = `width: ${size.width}px; height: ${size.height}px`;
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <div style={{style}}>
            <Policy @format='fitted' @displayContainer={{true}} />
          </div>
        </template>
      },
    );
  }

  function ruleLines() {
    return [
      ...document.querySelectorAll('[data-test-realm-policy-fitted-rules] li'),
    ].map((el) => el.textContent?.replace(/\s+/g, ' ').trim());
  }

  const TWO_RULES = [
    {
      targetType: CLASSROOM,
      grants: [{ operation: 'read' }, { operation: 'update' }],
    },
    {
      targetType: SCHEDULE,
      grants: [{ operation: 'read' }, { operation: 'delete' }],
    },
  ];

  test('it summarizes the rules and grants, and lists each rule where there is room', async function (assert) {
    await renderFitted(TWO_RULES, { width: 250, height: 170 });
    assert.dom('[data-test-realm-policy-fitted]').containsText('Education');
    assert
      .dom('[data-test-realm-policy-fitted-summary]')
      .hasText('2 rules · 4 grants');
    assert.deepEqual(
      ruleLines(),
      ['Classroom read, update', 'Schedule read, delete'],
      'each rule names the type it governs and the operations it grants',
    );
    assert
      .dom('[data-test-realm-policy-fitted-rules]')
      .isVisible('a tile has room for the rules');
  });

  test('as a strip, the rules give way to the summary beside the title', async function (assert) {
    await renderFitted(TWO_RULES, { width: 400, height: 65 });
    assert
      .dom('[data-test-realm-policy-fitted-summary]')
      .isVisible()
      .hasText('2 rules · 4 grants');
    assert
      .dom('[data-test-realm-policy-fitted-rules]')
      .isNotVisible('a strip has no room for the rules');
  });

  test('as a badge, only the title shows', async function (assert) {
    await renderFitted(TWO_RULES, { width: 150, height: 65 });
    assert.dom('[data-test-realm-policy-fitted]').containsText('Education');
    assert.dom('[data-test-realm-policy-fitted-summary]').isNotVisible();
    assert.dom('[data-test-realm-policy-fitted-rules]').isNotVisible();
  });

  test('an operation granted twice by one rule is listed once', async function (assert) {
    await renderFitted(
      [
        {
          targetType: CLASSROOM,
          grants: [
            { operation: 'read', where: '.teacherIds | any(. == actor())' },
            { operation: 'read' },
          ],
        },
      ],
      { width: 250, height: 170 },
    );
    assert
      .dom('[data-test-realm-policy-fitted-summary]')
      .hasText('1 rule · 2 grants');
    assert.deepEqual(ruleLines(), ['Classroom read']);
  });

  test('a policy with no rules says it grants nothing', async function (assert) {
    await renderFitted([], { width: 250, height: 170 });
    assert
      .dom('[data-test-realm-policy-fitted-summary]')
      .hasText('No rules, so it grants nothing');
    assert.dom('[data-test-realm-policy-fitted-rules]').doesNotExist();
  });
});
