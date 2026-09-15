import { render } from '@ember/test-helpers';

import { module, test } from 'qunit';

import { htmlComponent } from '@cardstack/host/lib/html-component';

import { setupRenderingTest } from '../../helpers/setup';

module('Integration | Component | html-component', function (hooks) {
  setupRenderingTest(hooks);

  test('one component mounted twice renders its content in both places', async function (assert) {
    let Inert = htmlComponent(
      `<div class='card'><span data-test-inert-body>Body</span></div>`,
    );

    await render(
      <template>
        <div data-test-first-mount><Inert /></div>
        <div data-test-second-mount><Inert /></div>
      </template>,
    );

    assert
      .dom('[data-test-first-mount] [data-test-inert-body]')
      .hasText('Body', 'the first mount keeps its content');
    assert
      .dom('[data-test-second-mount] [data-test-inert-body]')
      .hasText('Body', 'the second mount has its own content');
  });

  // Prerendered atom HTML arrives wrapped in the route template's whitespace.
  // It must still resolve to a single root so splatted attributes land on it.
  test('surrounding whitespace does not stop the root element from taking attributes', async function (assert) {
    let Inert = htmlComponent(
      `\n    \n  <div class='card'><span>Body</span></div>\n\n  `,
    );

    await render(<template><Inert data-test-root /></template>);

    assert
      .dom('[data-test-root]')
      .exists('the splatted attribute reached the root')
      .hasClass('card', 'the root is the prerendered element')
      .hasText('Body');
  });

  test('transformRoot edits the parsed root before it is rendered', async function (assert) {
    let Inert = htmlComponent(
      `<div class='card ring'><span>Body</span></div>`,
      {},
      (root) => root.classList.replace('ring', 'plain'),
    );

    await render(<template><Inert data-test-root /></template>);

    assert
      .dom('[data-test-root]')
      .hasClass('plain', 'the replacement class is rendered')
      .doesNotHaveClass('ring', 'the original class is gone');
  });

  test('transformRoot is skipped when the HTML has no single root', async function (assert) {
    let calls = 0;
    let Inert = htmlComponent(`<span>One</span><span>Two</span>`, {}, () => {
      calls++;
    });

    await render(
      <template>
        <div data-test-wrap><Inert /></div>
      </template>,
    );

    assert.strictEqual(calls, 0, 'the hook never ran');
    assert.dom('[data-test-wrap]').hasText('OneTwo', 'the HTML still renders');
  });
});
