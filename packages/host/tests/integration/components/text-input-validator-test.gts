import { fillIn, typeIn, focus, settled } from '@ember/test-helpers';

import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import { type Realm } from '@cardstack/runtime-common';

import OperatorMode from '@cardstack/host/components/operator-mode/container';

import {
  testRealmURL,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupOnSave,
  type TestContextWithSave,
  setupOperatorModeStateCleanup,
} from '../../helpers';
import {
  BigIntegerField,
  NumberField,
  field,
  contains,
  CardDef,
  setupBaseRealm,
} from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { renderComponent } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

module('Integration | text-input-validator', function (hooks) {
  let realm: Realm;
  setupRenderingTest(hooks);
  setupOperatorModeStateCleanup(hooks);
  setupBaseRealm(hooks);
  setupLocalIndexing(hooks);
  setupOnSave(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });

  hooks.beforeEach(async function () {
    let operatorModeStateService = getService('operator-mode-state-service');

    class Sample extends CardDef {
      static displayName = 'Sample';
      @field someBigInt = contains(BigIntegerField);
      @field anotherBigInt = contains(BigIntegerField);
      @field someNumber = contains(NumberField);
    }

    ({ realm } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'sample.gts': { Sample },
        'Sample/1.json': new Sample({
          someBigInt: null,
          anotherBigInt: '123',
          someNumber: 0,
        }),
      },
    }));

    operatorModeStateService.restore({
      stacks: [[{ id: `${testRealmURL}Sample/1`, format: 'edit' }]],
    });

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        noop = () => {};
        <template>
          <OperatorMode @onClose={{this.noop}} />
        </template>
      },
    );
  });

  test('when user fills field with invalid values, the input box should show invalid state', async function (assert) {
    await fillIn(
      '[data-test-field="someBigInt"] [data-test-boxel-input]',
      'a-string-text',
    );
    assert
      .dom(
        '[data-test-field="someBigInt"] [data-test-boxel-input-error-message]',
      )
      .hasText('Not a valid big int');
    assert
      .dom('[data-test-field="someBigInt"] input[aria-invalid="true"]')
      .exists();
  });

  test('when user starts typing adding wrong input to the correct input, the input box should show invalid state and error message', async function (assert) {
    await fillIn(
      '[data-test-field="someBigInt"] [data-test-boxel-input]',
      '1000000',
    );
    await typeIn(
      '[data-test-field="someBigInt"] [data-test-boxel-input]',
      'extra',
    );
    assert
      .dom(
        '[data-test-field="someBigInt"] [data-test-boxel-input-error-message]',
      )
      .hasText('Not a valid big int');
    assert
      .dom('[data-test-field="someBigInt"] input[aria-invalid="true"]')
      .exists();
  });

  test('if json contains undeserializable values, the input box should show empty input box', async function (assert) {
    assert
      .dom('[data-test-field="anotherBigInt"] [data-test-boxel-input]')
      .hasText('');
    assert
      .dom(
        '[data-test-field="anotherBigInt"] [data-test-boxel-input-error-message]',
      )
      .doesNotExist();
    assert
      .dom('[data-test-field="anotherBigInt"] input[aria-invalid="true"]')
      .doesNotExist();
  });

  test<TestContextWithSave>('when a user inserts wrong input and saves, it should not save the value', async function (assert) {
    assert.expect(2); // expect 2 instead of 3 because this should not run `onSave`
    this.onSave(() => {
      assert.ok(false, 'does not save wrong input');
    });
    await fillIn(
      '[data-test-field="anotherBigInt"] [data-test-boxel-input]',
      'invalid-big-int',
    );
    assert
      .dom(
        '[data-test-field="anotherBigInt"] [data-test-boxel-input-error-message]',
      )
      .hasText('Not a valid big int');
    assert
      .dom('[data-test-field="anotherBigInt"] input[aria-invalid="true"]')
      .exists();
  });

  // -- below here are happy path test --
  test<TestContextWithSave>('when user inserts field with correct values and saves, the saved document should insert a serialized value into the field', async function (assert) {
    assert.expect(4);
    this.onSave((_url, json) => {
      if (typeof json === 'string') {
        throw new Error('expected JSON save data');
      }
      assert.strictEqual(json.data.attributes?.someBigInt, '333');
    });
    await fillIn(
      '[data-test-field="someBigInt"] [data-test-boxel-input]',
      '333',
    );
    assert.dom('[data-test-field="someBigInt"] input').hasValue('333');
    assert
      .dom(
        '[data-test-field="someBigInt"] [data-test-boxel-input-error-message]',
      )
      .doesNotExist();
    assert
      .dom('[data-test-field="someBigInt"] input[aria-invalid="true"]')
      .doesNotExist();
  });

  test('when user starts with empty field, the input box should NOT show invalid state', async function (assert) {
    // 'when user starts typing inserting correct input, the input box should show valid state',
    await focus('[data-test-field="someBigInt"] [data-test-boxel-input]');
    assert
      .dom('[data-test-field="someBigInt"] input[aria-invalid="true"]')
      .doesNotExist();
  });

  test<TestContextWithSave>('if we modify a model from outside the input box, the input box should update with new value', async function (assert) {
    //a use case for this test is for exmplae, populating the fields with valid values once the user hits a button "fill in"
    const cardId = `${testRealmURL}Sample/1`;
    assert
      .dom('[data-test-field="someBigInt"] [data-test-boxel-input]')
      .hasNoValue();
    let card = await realm.realmIndexQueryEngine.cardDocument(new URL(cardId));
    if (card?.type !== 'doc' || !card.doc.data.attributes) {
      throw new Error('Search result did not return expected card doc');
    }
    assert.strictEqual(card.doc.data.attributes.someBigInt, null);
    card.doc.data.attributes.someBigInt = '444';

    await realm.write('Sample/1.json', JSON.stringify(card.doc));
    await settled();
    assert
      .dom('[data-test-field="someBigInt"] [data-test-boxel-input]')
      .hasValue('444');

    card = await realm.realmIndexQueryEngine.cardDocument(new URL(cardId));
    if (card?.type !== 'doc') {
      throw new Error('Search result for card is not type doc');
    }
    assert.strictEqual(card.doc.data.attributes?.someBigInt, '444');
    assert
      .dom('[data-test-field="someBigInt"] [data-test-boxel-input]')
      .hasValue('444');
  });

  test('number input validation gymnastics', async function (assert) {
    await fillIn('[data-test-field="someNumber"] [data-test-boxel-input]', '');
    assert
      .dom(
        '[data-test-field="someNumber"] [data-test-boxel-input-error-message]',
      )
      .doesNotExist();
    assert
      .dom('[data-test-field="someNumber"] [data-test-boxel-input]')
      .hasText('');

    await fillIn('[data-test-field="someNumber"] [data-test-boxel-input]', '-');
    assert
      .dom(
        '[data-test-field="someNumber"] [data-test-boxel-input-error-message]',
      )
      .hasText('Input must be a valid number.');

    await fillIn(
      '[data-test-field="someNumber"] [data-test-boxel-input]',
      '-3',
    );
    assert
      .dom(
        '[data-test-field="someNumber"] [data-test-boxel-input-error-message]',
      )
      .doesNotExist();

    await fillIn(
      '[data-test-field="someNumber"] [data-test-boxel-input]',
      '-3.',
    );
    assert
      .dom(
        '[data-test-field="someNumber"] [data-test-boxel-input-error-message]',
      )
      .hasText('Input cannot end with a decimal point.');
    await fillIn(
      '[data-test-field="someNumber"] [data-test-boxel-input]',
      '-3.6',
    );
    assert
      .dom(
        '[data-test-field="someNumber"] [data-test-boxel-input-error-message]',
      )
      .doesNotExist();
    await fillIn('[data-test-field="someNumber"] [data-test-boxel-input]', '');
    assert
      .dom(
        '[data-test-field="someNumber"] [data-test-boxel-input-error-message]',
      )
      .doesNotExist();
    await fillIn('[data-test-field="someNumber"] [data-test-boxel-input]', '1');
    assert
      .dom(
        '[data-test-field="someNumber"] [data-test-boxel-input-error-message]',
      )
      .doesNotExist();
  });
});
