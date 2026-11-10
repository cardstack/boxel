import { click, settled, waitFor, waitUntil } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import type { Realm } from '@cardstack/runtime-common/realm';

import { testRealmURL, visitOperatorMode } from '../helpers';
import { setupInteractSubmodeTests } from '../helpers/interact-submode-setup';

function recentCardIds() {
  return getService('recent-cards-service').recentCardIds;
}

module('Acceptance | recent cards', function (hooks) {
  let realm: Realm;
  setupInteractSubmodeTests(hooks, {
    setRealm(value) {
      realm = value;
    },
  });

  test('the top cards of stacks opened from a link appear in Recents', async function (assert) {
    await visitOperatorMode({
      stacks: [
        [
          { id: `${testRealmURL}Person/fadhlan`, format: 'isolated' },
          { id: `${testRealmURL}Pet/mango`, format: 'isolated' },
        ],
        [{ id: `${testRealmURL}Pet/vangogh`, format: 'isolated' }],
      ],
    });

    assert.deepEqual(
      recentCardIds(),
      [`${testRealmURL}Pet/vangogh`, `${testRealmURL}Pet/mango`],
      'only the top cards are recorded, the rightmost most recent',
    );

    await click('[data-test-open-search-field]');
    await waitFor(`[data-test-search-result="${testRealmURL}Pet/mango"]`);
    assert
      .dom(`[data-test-search-result="${testRealmURL}Pet/mango"]`)
      .exists('the search bar lists the card under Recents');
  });

  test('a card opened in code mode appears in Recents', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}Pet/mango.json`,
      openDirs: { [testRealmURL]: ['Pet/'] },
    });
    assert.deepEqual(recentCardIds(), [`${testRealmURL}Pet/mango`]);

    await click('[data-test-file-browser-toggle]');
    await click('[data-test-file="Pet/vangogh.json"]');
    assert.deepEqual(recentCardIds(), [
      `${testRealmURL}Pet/vangogh`,
      `${testRealmURL}Pet/mango`,
    ]);
  });

  test('a nested card opened in interact mode appears in Recents', async function (assert) {
    await visitOperatorMode({
      stacks: [[{ id: `${testRealmURL}Person/fadhlan`, format: 'isolated' }]],
    });
    assert.deepEqual(recentCardIds(), [`${testRealmURL}Person/fadhlan`]);

    await click(
      `[data-test-stack-card="${testRealmURL}Person/fadhlan"] [data-test-view-pet]`,
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}Pet/mango"]`);

    assert.deepEqual(recentCardIds(), [
      `${testRealmURL}Pet/mango`,
      `${testRealmURL}Person/fadhlan`,
    ]);
  });

  test('a nested card opened in code mode appears in Recents', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}Person/fadhlan.json`,
    });
    assert.deepEqual(recentCardIds(), [`${testRealmURL}Person/fadhlan`]);

    await waitFor(
      '[data-test-code-mode-card-renderer-body] [data-test-view-pet]',
    );
    await click(
      '[data-test-code-mode-card-renderer-body] [data-test-view-pet]',
    );
    let operatorModeStateService = getService('operator-mode-state-service');
    await waitUntil(() =>
      operatorModeStateService.state.codePath?.endsWith('Pet/mango.json'),
    );
    await settled();

    assert.deepEqual(recentCardIds(), [
      `${testRealmURL}Pet/mango`,
      `${testRealmURL}Person/fadhlan`,
    ]);
  });

  test('a JSON file that is not a card stays out of Recents', async function (assert) {
    await realm.write('settings.json', JSON.stringify({ theme: 'dark' }));
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}Pet/mango.json`,
    });
    assert.deepEqual(recentCardIds(), [`${testRealmURL}Pet/mango`]);

    await click('[data-test-file-browser-toggle]');
    await click('[data-test-file="settings.json"]');
    assert.deepEqual(recentCardIds(), [`${testRealmURL}Pet/mango`]);
  });

  test('a card replaced in place on a stack appears in Recents', async function (assert) {
    await visitOperatorMode({
      stacks: [[{ id: `${testRealmURL}Pet/mango`, format: 'isolated' }]],
    });

    getService('operator-mode-state-service').replaceCardOnStack(
      `${testRealmURL}Pet/mango`,
      `${testRealmURL}Pet/vangogh`,
      0,
      'isolated',
    );
    await settled();

    assert.strictEqual(recentCardIds()[0], `${testRealmURL}Pet/vangogh`);
  });

  test('a card lower in one stack moves to the front when opened on another', async function (assert) {
    await visitOperatorMode({
      stacks: [
        [
          { id: `${testRealmURL}Person/fadhlan`, format: 'isolated' },
          { id: `${testRealmURL}Pet/mango`, format: 'isolated' },
        ],
        [{ id: `${testRealmURL}Pet/vangogh`, format: 'isolated' }],
      ],
    });

    let operatorModeStateService = getService('operator-mode-state-service');
    operatorModeStateService.addItemToStack(
      operatorModeStateService.createStackItem(
        `${testRealmURL}Person/fadhlan`,
        1,
      ),
    );
    await settled();

    assert.strictEqual(recentCardIds()[0], `${testRealmURL}Person/fadhlan`);
  });

  test('a card revealed by closing the card above it is not recorded', async function (assert) {
    await visitOperatorMode({
      stacks: [
        [
          { id: `${testRealmURL}Person/fadhlan`, format: 'isolated' },
          { id: `${testRealmURL}Pet/mango`, format: 'isolated' },
        ],
      ],
    });
    assert.deepEqual(recentCardIds(), [`${testRealmURL}Pet/mango`]);

    await click('[data-test-stack-card-index="1"] [data-test-close-button]');

    assert.deepEqual(recentCardIds(), [`${testRealmURL}Pet/mango`]);
  });

  test('going back to a card already on the stack is not recorded, and going forward is', async function (assert) {
    let fadhlan = `${testRealmURL}Person/fadhlan`;
    let mango = `${testRealmURL}Pet/mango`;
    await visitOperatorMode({
      stacks: [[{ id: fadhlan, format: 'isolated' }]],
    });
    await click(`[data-test-stack-card="${fadhlan}"] [data-test-view-pet]`);
    await waitFor(`[data-test-stack-card="${mango}"]`);
    assert.deepEqual(recentCardIds(), [mango, fadhlan]);

    // browser history navigation restores the state from the URL
    await visitOperatorMode({
      stacks: [[{ id: fadhlan, format: 'isolated' }]],
    });
    assert.dom(`[data-test-stack-card="${mango}"]`).doesNotExist();
    assert.deepEqual(recentCardIds(), [mango, fadhlan]);

    getService('recent-cards-service').add(fadhlan);
    await visitOperatorMode({
      stacks: [
        [
          { id: fadhlan, format: 'isolated' },
          { id: mango, format: 'isolated' },
        ],
      ],
    });
    assert.deepEqual(recentCardIds(), [mango, fadhlan]);
  });
});
