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

  // Whether the policy's title shows in full: rendered, with room for all of
  // its text.
  function titleShowsInFull(): boolean {
    let title = document.querySelector(
      '[data-test-realm-policy-fitted-title]',
    ) as HTMLElement | null;
    return Boolean(
      title &&
      title.getBoundingClientRect().width > 0 &&
      title.scrollWidth <= title.clientWidth,
    );
  }

  // How many rule lines show whole, and how many show only in part, within
  // what the list leaves visible inside the card's padding.
  function ruleLinesShown(): { whole: number; partial: number } {
    let fit = document.querySelector(
      '[data-test-realm-policy-fitted]',
    ) as HTMLElement;
    let card = fit.getBoundingClientRect();
    // The test container may be scaled; the padding is in unscaled pixels.
    let scale = card.width / fit.offsetWidth;
    let style = getComputedStyle(fit);
    let padding = (side: string) =>
      parseFloat(style.getPropertyValue(`padding-${side}`)) * scale;
    let list = document
      .querySelector('[data-test-realm-policy-fitted-rules]')!
      .getBoundingClientRect();
    let top = Math.max(card.top + padding('top'), list.top);
    let bottom = Math.min(card.bottom - padding('bottom'), list.bottom);
    let left = Math.max(card.left + padding('left'), list.left);
    let right = Math.min(card.right - padding('right'), list.right);
    let whole = 0;
    let partial = 0;
    for (let li of document.querySelectorAll(
      '[data-test-realm-policy-fitted-rules] li',
    )) {
      let line = li.getBoundingClientRect();
      let inside =
        line.top >= top - 0.5 &&
        line.bottom <= bottom + 0.5 &&
        line.left >= left - 0.5 &&
        line.right <= right + 0.5;
      let outside =
        line.bottom <= top + 0.5 ||
        line.top >= bottom - 0.5 ||
        line.right <= left + 0.5 ||
        line.left >= right - 0.5;
      if (inside) {
        whole++;
      } else if (!outside) {
        partial++;
      }
    }
    return { whole, partial };
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
    assert.true(titleShowsInFull(), 'the title shows in full');
    assert.dom('[data-test-realm-policy-fitted-title]').hasText('Education');
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
    assert.true(titleShowsInFull(), 'the title shows in full');
    assert
      .dom('[data-test-realm-policy-fitted-summary]')
      .isVisible()
      .hasText('2 rules · 4 grants');
    assert
      .dom('[data-test-realm-policy-fitted-rules]')
      .isNotVisible('a strip has no room for the rules');
  });

  test('a strip three lines tall is still one row', async function (assert) {
    await renderFitted(TWO_RULES, { width: 250, height: 105 });
    assert.true(titleShowsInFull(), 'the title shows in full');
    assert.dom('[data-test-realm-policy-fitted-summary]').isVisible();
    assert.dom('[data-test-realm-policy-fitted-rules]').isNotVisible();
  });

  test('in a narrow strip, a long summary gives way to the title', async function (assert) {
    // The narrowest strip a realm's config card renders the policy in, with
    // the longest summary there is.
    await renderFitted([], { width: 200, height: 65 });
    assert.true(titleShowsInFull(), 'the title shows in full');
    assert
      .dom('[data-test-realm-policy-fitted-summary]')
      .isVisible('the summary shows beside it, cut short where it must be');
  });

  test('as a badge, only the title shows', async function (assert) {
    await renderFitted(TWO_RULES, { width: 150, height: 65 });
    assert.true(titleShowsInFull(), 'the title shows in full');
    assert.dom('[data-test-realm-policy-fitted-summary]').isNotVisible();
    assert.dom('[data-test-realm-policy-fitted-rules]').isNotVisible();
  });

  test('where not every rule fits, the lines that show are whole', async function (assert) {
    let rules = Array.from({ length: 9 }, (_, i) => ({
      targetType: { module: '../classroom', name: `Type${i}` },
      grants: [{ operation: 'read' }],
    }));
    await renderFitted(rules, { width: 250, height: 170 });
    let { whole, partial } = ruleLinesShown();
    assert.strictEqual(
      partial,
      0,
      'no line is cut short or runs into the padding at the foot of the card',
    );
    assert.true(whole > 0, `some lines show: ${whole} of 9`);
    assert.true(whole < 9, 'and the rest are left out');
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

  test('a grant that names no operation is neither counted nor listed, and a rule with no type says so', async function (assert) {
    await renderFitted(
      [
        { targetType: CLASSROOM, grants: [{ operation: 'read' }, {}] },
        { grants: [{ operation: 'update' }] },
      ],
      { width: 250, height: 170 },
    );
    assert
      .dom('[data-test-realm-policy-fitted-summary]')
      .hasText('2 rules · 2 grants');
    assert.deepEqual(ruleLines(), ['Classroom read', 'No target type update']);
  });

  test('a policy with no rules says it grants nothing', async function (assert) {
    await renderFitted([], { width: 250, height: 170 });
    assert
      .dom('[data-test-realm-policy-fitted-summary]')
      .hasText('No rules, so it grants nothing');
    assert.dom('[data-test-realm-policy-fitted-rules]').doesNotExist();
  });
});
