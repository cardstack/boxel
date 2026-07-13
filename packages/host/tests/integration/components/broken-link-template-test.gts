import type { RenderingTestContext } from '@ember/test-helpers';
import { click, render } from '@ember/test-helpers';

import { module, test } from 'qunit';

import { BrokenLinkTemplate } from '@cardstack/boxel-ui/components';

import type { SerializedError } from '@cardstack/runtime-common';

import { cardTypeName } from '@cardstack/runtime-common/bfm-card-references';

import { setupRenderingTest } from '../../helpers/setup';

const NOT_FOUND_URL = 'https://example.com/realm/Pet/broken-card-id';
const ERROR_URL = 'https://example.com/realm/Author/exploded-card-id';

function notFoundErrorDoc(): SerializedError {
  return {
    status: 404,
    title: 'Not Found',
    message: `Could not find ${NOT_FOUND_URL}`,
    additionalErrors: null,
  };
}

function genericErrorDoc(): SerializedError {
  return {
    status: 500,
    title: 'Internal Server Error',
    message: 'TypeError: Cannot read properties of undefined (reading "name")',
    stack: 'Error: kaboom\n    at PetCard.render (pet.gts:42:7)',
    additionalErrors: [
      {
        status: 500,
        message: 'inner dependency exploded',
        stack: 'Error: inner\n    at Dep.evaluate (dep.gts:9:3)',
      },
    ],
  };
}

type Scenario = {
  brokenUrl: string;
  errorDoc: SerializedError;
  state: 'error' | 'not-found';
  format: 'isolated' | 'fitted' | 'embedded' | 'atom';
};

async function renderTemplate(scenario: Scenario) {
  // The display-name label is now a caller-supplied prop; base card sites pass
  // `cardTypeName(reference)`, so derive it the same way here.
  let displayName = cardTypeName(scenario.brokenUrl);
  await render(
    <template>
      <BrokenLinkTemplate
        @brokenUrl={{scenario.brokenUrl}}
        @errorDoc={{scenario.errorDoc}}
        @state={{scenario.state}}
        @format={{scenario.format}}
        @displayName={{displayName}}
      />
    </template>,
  );
}

module('Integration | Component | broken-link-template', function (hooks) {
  setupRenderingTest(hooks);

  test('the visible box is identical across states — only the type name shows; the failure reason is not surfaced inline', async function (this: RenderingTestContext, assert) {
    for (let state of ['not-found', 'error'] as const) {
      await renderTemplate({
        brokenUrl: state === 'not-found' ? NOT_FOUND_URL : ERROR_URL,
        errorDoc:
          state === 'not-found' ? notFoundErrorDoc() : genericErrorDoc(),
        state,
        format: 'embedded',
      });

      assert
        .dom('[data-test-broken-link-template="embedded"]')
        .exists('root carries the format data attribute');
      assert
        .dom(`[data-test-broken-link-state="${state}"]`)
        .exists('root carries the state data attribute');
      assert
        .dom('[data-test-broken-link-type]')
        .hasText(state === 'not-found' ? 'Pet' : 'Author');
      // The detail lives only in the (hidden) overlay — nothing about the
      // failure should be visible in the box itself.
      assert.dom('[data-test-broken-link-url]').isNotVisible();
      assert.dom('[data-test-broken-link-headline]').isNotVisible();
    }
  });

  test('detail stays in the DOM but is visually hidden until the reveal is triggered', async function (this: RenderingTestContext, assert) {
    await renderTemplate({
      brokenUrl: ERROR_URL,
      errorDoc: genericErrorDoc(),
      state: 'error',
      format: 'isolated',
    });

    // Reveal affordance + overlay scaffolding are present.
    assert
      .dom('[data-test-broken-link-reveal]')
      .exists('reveal trigger exists');
    assert
      .dom('[data-test-broken-link-overlay]')
      .exists('overlay node is in the DOM')
      .isNotVisible('overlay is hidden until the reveal is triggered');
    assert
      .dom('[data-test-broken-link-overlay-close]')
      .exists('close trigger exists');

    // Full detail is recoverable from the DOM for AI consumers even while the
    // overlay is closed.
    assert.dom('[data-test-broken-link-url]').hasText(ERROR_URL).isNotVisible();
    assert
      .dom('[data-test-broken-link-message]')
      .hasText(genericErrorDoc().message)
      .isNotVisible();
    assert
      .dom('[data-test-broken-link-stack]')
      .includesText('PetCard.render')
      .isNotVisible();
    assert
      .dom('[data-test-broken-link-additional-error="0"]')
      .includesText('inner dependency exploded')
      .isNotVisible();
  });

  test('triggering the reveal opens the overlay; closing it hides the overlay again', async function (this: RenderingTestContext, assert) {
    await renderTemplate({
      brokenUrl: ERROR_URL,
      errorDoc: genericErrorDoc(),
      state: 'error',
      format: 'isolated',
    });

    assert.dom('[data-test-broken-link-overlay]').isNotVisible();
    await click('[data-test-broken-link-reveal]');
    assert
      .dom('[data-test-broken-link-overlay]')
      .isVisible('overlay opens when the reveal is triggered');
    assert.dom('[data-test-broken-link-url]').isVisible();

    await click('[data-test-broken-link-overlay-close]');
    assert
      .dom('[data-test-broken-link-overlay]')
      .isNotVisible('overlay closes when the close affordance is triggered');
  });

  test('the overlay headline reflects the state — the one place not-found and error differ', async function (this: RenderingTestContext, assert) {
    await renderTemplate({
      brokenUrl: NOT_FOUND_URL,
      errorDoc: notFoundErrorDoc(),
      state: 'not-found',
      format: 'embedded',
    });
    assert
      .dom('[data-test-broken-link-headline]')
      .hasText('Linked card not found');
    // not-found's message is just "Could not find <url>" — redundant with the
    // URL line, so it is suppressed.
    assert
      .dom('[data-test-broken-link-message]')
      .doesNotExist('not-found suppresses the redundant "Could not find" line');

    await renderTemplate({
      brokenUrl: ERROR_URL,
      errorDoc: genericErrorDoc(),
      state: 'error',
      format: 'embedded',
    });
    assert
      .dom('[data-test-broken-link-headline]')
      .hasText('Linked card failed to load');
    assert.dom('[data-test-broken-link-message]').exists();
  });

  test('the overlay carries status, message, stack, and additional errors regardless of format', async function (this: RenderingTestContext, assert) {
    let errorDoc = genericErrorDoc();
    for (let format of ['isolated', 'fitted', 'embedded', 'atom'] as const) {
      await renderTemplate({
        brokenUrl: ERROR_URL,
        errorDoc,
        state: 'error',
        format,
      });

      assert
        .dom('[data-test-broken-link-status]')
        .includesText('500')
        .includesText('Internal Server Error');
      assert.dom('[data-test-broken-link-message]').hasText(errorDoc.message);
      assert
        .dom('[data-test-broken-link-stack]')
        .includesText('PetCard.render')
        .includesText('pet.gts:42:7');
      assert
        .dom('[data-test-broken-link-additional-error="0"]')
        .includesText('inner dependency exploded');
    }
  });

  test('the overlay keeps the prose message visible when it differs from the stack, and hides the visual duplicate when the stack repeats it', async function (this: RenderingTestContext, assert) {
    // The fixture's stack ("Error: kaboom ...") does not carry the message, so
    // the message is distinct information and must stay visible.
    await renderTemplate({
      brokenUrl: ERROR_URL,
      errorDoc: genericErrorDoc(),
      state: 'error',
      format: 'isolated',
    });
    await click('[data-test-broken-link-reveal]');
    assert
      .dom('[data-test-broken-link-message]')
      .isVisible('message stays visible when the stack header differs from it');

    // When the stack's first line already carries the message, the prose is a
    // visual duplicate — hidden, but still recoverable from the DOM.
    let redundant = genericErrorDoc();
    redundant.stack = `Error: ${redundant.message}\n    at PetCard.render (pet.gts:42:7)`;
    await renderTemplate({
      brokenUrl: ERROR_URL,
      errorDoc: redundant,
      state: 'error',
      format: 'isolated',
    });
    await click('[data-test-broken-link-reveal]');
    assert
      .dom('[data-test-broken-link-message]')
      .hasText(redundant.message)
      .isNotVisible(
        'the redundant message stays in the DOM but is visually hidden',
      );
  });

  test('atom format renders an inline placeholder with the type name and a reveal trigger', async function (this: RenderingTestContext, assert) {
    await renderTemplate({
      brokenUrl: NOT_FOUND_URL,
      errorDoc: notFoundErrorDoc(),
      state: 'not-found',
      format: 'atom',
    });

    assert.dom('[data-test-broken-link-template="atom"]').exists();
    assert.dom('[data-test-broken-link-type]').hasText('Pet');
    assert.dom('[data-test-broken-link-reveal]').exists();
    assert.dom('[data-test-broken-link-overlay]').isNotVisible();
  });

  test('renders without crashing when errorDoc is minimal', async function (this: RenderingTestContext, assert) {
    let bareDoc: SerializedError = {
      status: 500,
      message: '',
      additionalErrors: null,
    };
    await renderTemplate({
      brokenUrl: ERROR_URL,
      errorDoc: bareDoc,
      state: 'error',
      format: 'embedded',
    });

    assert.dom('[data-test-broken-link-url]').hasText(ERROR_URL);
    assert
      .dom('[data-test-broken-link-message]')
      .doesNotExist('no message in DOM when the doc has none');
  });

  test('renders unsafe URLs as plain text rather than an anchor (defence against corrupted card data)', async function (this: RenderingTestContext, assert) {
    let evilUrl = 'javascript:alert(1)';
    await renderTemplate({
      brokenUrl: evilUrl,
      errorDoc: notFoundErrorDoc(),
      state: 'not-found',
      format: 'embedded',
    });

    assert
      .dom('[data-test-broken-link-url]')
      .exists('the URL is still recoverable in the DOM')
      .hasText(evilUrl)
      .hasTagName(
        'span',
        'rendered as plain text — clicking it cannot navigate',
      );
  });
});
