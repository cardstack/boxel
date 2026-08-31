import type { RenderingTestContext } from '@ember/test-helpers';
import { render } from '@ember/test-helpers';

import { module, test } from 'qunit';

import CardError from '@cardstack/host/components/operator-mode/card-error';
import type { CardErrorJSONAPI } from '@cardstack/host/services/store';

import { setupRenderingTest } from '../../helpers/setup';

const CARD_URL = 'https://example.com/realm/Person/just-written';

function cardError(
  overrides: Partial<CardErrorJSONAPI> = {},
): CardErrorJSONAPI {
  return {
    id: CARD_URL,
    status: 404,
    title: 'Not Found',
    message: `Could not find ${CARD_URL}`,
    realm: 'https://example.com/realm/',
    meta: {
      lastKnownGoodHtml: null,
      cardTitle: null,
      scopedCssUrls: [],
      stack: null,
    },
    ...overrides,
  };
}

async function renderError(error: CardErrorJSONAPI) {
  await render(<template><CardError @error={{error}} /></template>);
}

module('Integration | Component | card-error awaiting index', function (hooks) {
  setupRenderingTest(hooks);

  test('a 404 the realm marked as awaiting indexing renders as work in progress, not as a failure', async function (this: RenderingTestContext, assert) {
    await renderError(cardError({ awaitingIndex: true }));

    assert
      .dom(`[data-test-card-awaiting-index="${CARD_URL}"]`)
      .exists('the pending placeholder stands in for the card')
      .containsText('Preparing this card');
    assert.dom('[data-test-card-error]').doesNotExist('no error body is shown');
    assert
      .dom('[data-test-error-display]')
      .doesNotExist('no error detail is offered — nothing has failed');
  });

  test('a plain 404 still renders as a card error', async function (this: RenderingTestContext, assert) {
    await renderError(cardError());

    assert
      .dom(`[data-test-card-error="${CARD_URL}"]`)
      .exists('the error body is shown');
    assert
      .dom('[data-test-card-awaiting-index]')
      .doesNotExist('nothing suggests the card is on its way');
  });
});
