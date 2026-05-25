import type { RenderingTestContext } from '@ember/test-helpers';
import { render } from '@ember/test-helpers';

import { module, test } from 'qunit';

// @ts-ignore — Glint cannot follow the realm URL alias to the .gts source
import BrokenLinkTemplate from 'https://cardstack.com/base/default-templates/broken-link-template';

import type { SerializedError } from '@cardstack/runtime-common';

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

module(
  'Integration | Component | broken-link-template',
  function (hooks) {
    setupRenderingTest(hooks);

    type Args = {
      brokenUrl: string;
      errorDoc: SerializedError;
      state: 'error' | 'not-found';
      format: 'isolated' | 'fitted' | 'embedded' | 'atom';
    };

    async function renderTemplate(args: Args) {
      await render(
        <template>
          <BrokenLinkTemplate
            @brokenUrl={{args.brokenUrl}}
            @errorDoc={{args.errorDoc}}
            @state={{args.state}}
            @format={{args.format}}
          />
        </template>,
      );
    }

    test('not-found / isolated: shows headline, URL, and status, suppresses redundant "Could not find ..." message', async function (this: RenderingTestContext, assert) {
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
      assert
        .dom('[data-test-broken-link-message]')
        .hasText(errorDoc.message);
      assert
        .dom('[data-test-broken-link-stack]')
        .includesText('PetCard.render')
        .includesText('pet.gts:42:7');
      assert
        .dom('[data-test-broken-link-additional-error="0"]')
        .includesText('inner dependency exploded');
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
  },
);
