import { click, render } from '@ember/test-helpers';
import { module, test } from 'qunit';
import { setupRenderingTest } from 'test-app/tests/helpers';
import {
  BrokenLinkTemplate,
  type BrokenLinkErrorDoc,
} from '@cardstack/boxel-ui/components';

const BROKEN_URL = 'https://example.com/realm/Author/exploded-card-id';

const notFoundDoc: BrokenLinkErrorDoc = {
  status: 404,
  title: 'Not Found',
  message: `Could not find ${BROKEN_URL}`,
  additionalErrors: null,
};

const errorDoc: BrokenLinkErrorDoc = {
  status: 500,
  title: 'Internal Server Error',
  message: 'TypeError: Cannot read properties of undefined (reading "name")',
  stack: 'Error: kaboom\n    at Author.render (author.gts:42:7)',
  additionalErrors: null,
};

module('Integration | Component | broken-link', function (hooks) {
  setupRenderingTest(hooks);

  test('renders the placeholder box with the caller-supplied type name', async function (assert) {
    await render(
      <template>
        <BrokenLinkTemplate
          @brokenUrl={{BROKEN_URL}}
          @errorDoc={{notFoundDoc}}
          @state='not-found'
          @format='embedded'
          @typeName='Author'
        />
      </template>,
    );

    assert.dom('[data-test-broken-link-template="embedded"]').exists();
    assert.dom('[data-test-broken-link-state="not-found"]').exists();
    assert.dom('[data-test-broken-link-type]').hasText('Author');
    // The failure reason lives only in the (hidden) overlay.
    assert.dom('[data-test-broken-link-url]').isNotVisible();
  });

  test('type name falls back to "Card" when none is supplied', async function (assert) {
    await render(
      <template>
        <BrokenLinkTemplate
          @brokenUrl={{BROKEN_URL}}
          @errorDoc={{notFoundDoc}}
          @state='not-found'
          @format='embedded'
        />
      </template>,
    );
    assert.dom('[data-test-broken-link-type]').hasText('Card');
  });

  test('the reveal toggle opens the overlay with the URL and a copy button', async function (assert) {
    await render(
      <template>
        <BrokenLinkTemplate
          @brokenUrl={{BROKEN_URL}}
          @errorDoc={{errorDoc}}
          @state='error'
          @format='isolated'
          @typeName='Author'
        />
      </template>,
    );

    assert.dom('[data-test-broken-link-overlay]').isNotVisible();
    await click('[data-test-broken-link-reveal]');
    assert.dom('[data-test-broken-link-overlay]').isVisible();
    assert.dom('[data-test-broken-link-url]').isVisible().hasText(BROKEN_URL);
    assert.dom('[data-test-broken-link-copy]').exists();

    await click('[data-test-broken-link-overlay-close]');
    assert.dom('[data-test-broken-link-overlay]').isNotVisible();
  });

  test('the overlay headline distinguishes not-found from error', async function (assert) {
    await render(
      <template>
        <BrokenLinkTemplate
          @brokenUrl={{BROKEN_URL}}
          @errorDoc={{notFoundDoc}}
          @state='not-found'
          @format='embedded'
          @typeName='Author'
        />
      </template>,
    );
    assert
      .dom('[data-test-broken-link-headline]')
      .hasText('Linked card not found');

    await render(
      <template>
        <BrokenLinkTemplate
          @brokenUrl={{BROKEN_URL}}
          @errorDoc={{errorDoc}}
          @state='error'
          @format='embedded'
          @typeName='Author'
        />
      </template>,
    );
    assert
      .dom('[data-test-broken-link-headline]')
      .hasText('Linked card failed to load');
    assert
      .dom('[data-test-broken-link-status]')
      .includesText('500')
      .includesText('Internal Server Error');
  });
});
