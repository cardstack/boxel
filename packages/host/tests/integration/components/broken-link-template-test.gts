import type { RenderingTestContext } from '@ember/test-helpers';
import { render } from '@ember/test-helpers';

import { module, test } from 'qunit';

import type { SerializedError } from '@cardstack/runtime-common';

// Relative import (not the `https://cardstack.com/base/…` realm URL): test
// runner files are part of the host bundle, not loaded by the realm-loader,
// so they need a real file-system path the bundler can resolve at build time.
// @ts-ignore — bundler resolves this; TS lookup runs through the tsconfig
// path map and the relative path is from .gts source.
import BrokenLinkTemplate from '../../../../base/default-templates/broken-link-template';

import { setupRenderingTest } from '../../helpers/setup';

const NOT_FOUND_URL = 'https://example.com/realm/broken-card-id';
const ERROR_URL = 'https://example.com/realm/exploded-card-id';

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
  await render(
    <template>
      <BrokenLinkTemplate
        @brokenUrl={{scenario.brokenUrl}}
        @errorDoc={{scenario.errorDoc}}
        @state={{scenario.state}}
        @format={{scenario.format}}
      />
    </template>,
  );
}

module('Integration | Component | broken-link-template', function (hooks) {
  setupRenderingTest(hooks);

  test('not-found / isolated: shows headline, URL, and status; suppresses redundant "Could not find ..." message', async function (this: RenderingTestContext, assert) {
    await renderTemplate({
      brokenUrl: NOT_FOUND_URL,
      errorDoc: notFoundErrorDoc(),
      state: 'not-found',
      format: 'isolated',
    });

    assert
      .dom('[data-test-broken-link-template="isolated"]')
      .exists('root carries the format data attribute');
    assert
      .dom('[data-test-broken-link-state="not-found"]')
      .exists('root carries the state data attribute');
    assert
      .dom('[data-test-broken-link-headline]')
      .hasText('Linked card not found');
    assert.dom('[data-test-broken-link-url]').hasText(NOT_FOUND_URL);
    assert
      .dom('[data-test-broken-link-url]')
      .hasAttribute('href', NOT_FOUND_URL);
    assert
      .dom('[data-test-broken-link-status]')
      .includesText('404')
      .includesText('Not Found');
    assert
      .dom('[data-test-broken-link-message]')
      .doesNotExist(
        'message is suppressed for not-found — the URL above already says it',
      );
  });

  test('error / isolated: surfaces message, stack, and additional errors so AI consumers can read them', async function (this: RenderingTestContext, assert) {
    let errorDoc = genericErrorDoc();
    await renderTemplate({
      brokenUrl: ERROR_URL,
      errorDoc,
      state: 'error',
      format: 'isolated',
    });

    assert
      .dom('[data-test-broken-link-headline]')
      .hasText('Linked card failed to load');
    assert.dom('[data-test-broken-link-message]').hasText(errorDoc.message);
    assert
      .dom('[data-test-broken-link-stack]')
      .includesText('PetCard.render')
      .includesText('pet.gts:42:7');
    assert
      .dom('[data-test-broken-link-additional-error="0"]')
      .includesText('inner dependency exploded');
  });

  test('not-found / embedded: shows headline + URL but suppresses message and stack', async function (this: RenderingTestContext, assert) {
    await renderTemplate({
      brokenUrl: NOT_FOUND_URL,
      errorDoc: notFoundErrorDoc(),
      state: 'not-found',
      format: 'embedded',
    });

    assert.dom('[data-test-broken-link-template="embedded"]').exists();
    assert
      .dom('[data-test-broken-link-headline]')
      .hasText('Linked card not found');
    assert.dom('[data-test-broken-link-url]').hasText(NOT_FOUND_URL);
    assert
      .dom('[data-test-broken-link-message]')
      .doesNotExist('not-found suppresses the redundant "Could not find" line');
    assert
      .dom('[data-test-broken-link-stack]')
      .doesNotExist('stack panel is isolated-format only');
  });

  test('error / embedded: shows headline + URL + message but suppresses the stack panel', async function (this: RenderingTestContext, assert) {
    await renderTemplate({
      brokenUrl: ERROR_URL,
      errorDoc: genericErrorDoc(),
      state: 'error',
      format: 'embedded',
    });

    assert.dom('[data-test-broken-link-template="embedded"]').exists();
    assert.dom('[data-test-broken-link-headline]').exists();
    assert.dom('[data-test-broken-link-url]').hasText(ERROR_URL);
    assert.dom('[data-test-broken-link-message]').exists();
    assert
      .dom('[data-test-broken-link-stack]')
      .doesNotExist('stack panel is isolated-format only');
    assert
      .dom('[data-test-broken-link-additional-error="0"]')
      .doesNotExist('additional-errors panel is isolated-format only');
  });

  test('not-found / fitted: keeps URL prominent and drops the verbose message', async function (this: RenderingTestContext, assert) {
    await renderTemplate({
      brokenUrl: NOT_FOUND_URL,
      errorDoc: notFoundErrorDoc(),
      state: 'not-found',
      format: 'fitted',
    });

    assert.dom('[data-test-broken-link-template="fitted"]').exists();
    assert.dom('[data-test-broken-link-headline]').exists();
    assert.dom('[data-test-broken-link-url]').hasText(NOT_FOUND_URL);
    assert
      .dom('[data-test-broken-link-message]')
      .doesNotExist('fitted suppresses the prose error message');
  });

  test('error / fitted: still suppresses the message even with a real error reason', async function (this: RenderingTestContext, assert) {
    await renderTemplate({
      brokenUrl: ERROR_URL,
      errorDoc: genericErrorDoc(),
      state: 'error',
      format: 'fitted',
    });

    assert.dom('[data-test-broken-link-template="fitted"]').exists();
    assert
      .dom('[data-test-broken-link-headline]')
      .hasText('Linked card failed to load');
    assert.dom('[data-test-broken-link-url]').hasText(ERROR_URL);
    assert
      .dom('[data-test-broken-link-status]')
      .includesText('500')
      .includesText('Internal Server Error');
    assert
      .dom('[data-test-broken-link-message]')
      .doesNotExist('fitted is too small to render the prose message at all');
    assert
      .dom('[data-test-broken-link-stack]')
      .doesNotExist('stack panel is isolated-format only');
  });

  test('not-found / atom: renders an inline compact line carrying the URL', async function (this: RenderingTestContext, assert) {
    await renderTemplate({
      brokenUrl: NOT_FOUND_URL,
      errorDoc: notFoundErrorDoc(),
      state: 'not-found',
      format: 'atom',
    });

    assert.dom('[data-test-broken-link-template="atom"]').exists();
    assert
      .dom('[data-test-broken-link-headline]')
      .doesNotExist('atom format omits the full headline');
    assert.dom('[data-test-broken-link-url]').hasText(NOT_FOUND_URL);
  });

  test('error / atom: still surfaces the URL for diagnostics', async function (this: RenderingTestContext, assert) {
    await renderTemplate({
      brokenUrl: ERROR_URL,
      errorDoc: genericErrorDoc(),
      state: 'error',
      format: 'atom',
    });

    assert.dom('[data-test-broken-link-state="error"]').exists();
    assert.dom('[data-test-broken-link-url]').hasText(ERROR_URL);
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
      .exists('the URL is still visible to the reviewer')
      .hasText(evilUrl)
      .hasTagName(
        'span',
        'rendered as plain text — clicking it cannot navigate',
      );
  });
});
