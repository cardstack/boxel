import { MarkdownContentShell } from '@cardstack/boxel-ui/components';
import { htmlSafe } from '@ember/template';
import { render } from '@ember/test-helpers';
import { module, test } from 'qunit';

import { setupRenderingTest } from '../../helpers';

// Stands in for a renderer's markdownToHtml() output; the shell only ever
// receives already-rendered HTML.
const SAMPLE_HTML = htmlSafe(
  '<h1>Field Notes</h1><p>Prose with <a href="#">a link</a>.</p><h2>Later</h2>',
);

const ANCESTOR_TOKENS = htmlSafe('--markdown-link-color: rgb(17, 34, 51);');

function computedOf(selector: string, property: string): string {
  let el = document.querySelector(selector);
  if (!el) {
    throw new Error(`expected to find element: ${selector}`);
  }
  return window.getComputedStyle(el).getPropertyValue(property).trim();
}

module('Integration | Component | markdown-content-shell', function (hooks) {
  setupRenderingTest(hooks);

  test('renders yielded HTML inside the markdown-content surface', async function (assert) {
    await render(
      <template>
        <MarkdownContentShell>{{SAMPLE_HTML}}</MarkdownContentShell>
      </template>,
    );
    assert
      .dom('[data-test-markdown-content-shell]')
      .hasClass('markdown-content');
    assert.dom('[data-test-markdown-content-shell] h1').hasText('Field Notes');
    assert.dom('[data-test-markdown-content-shell] a').hasText('a link');
  });

  test('a --markdown-* token set on an ancestor customizes the render', async function (assert) {
    // The token must be readable from an ancestor, not just from the shell
    // element itself: a default declared as the public token on
    // `.markdown-content` would shadow this inherited value.
    await render(
      <template>
        <div style={{ANCESTOR_TOKENS}} data-test-token-ancestor>
          <MarkdownContentShell>{{SAMPLE_HTML}}</MarkdownContentShell>
        </div>
      </template>,
    );
    assert.strictEqual(
      computedOf('[data-test-markdown-content-shell] a', 'color'),
      'rgb(17, 34, 51)',
      'the ancestor-set link color reaches the rendered content',
    );
  });

  test('a heading that opens the render has no top margin', async function (assert) {
    await render(
      <template>
        <MarkdownContentShell>{{SAMPLE_HTML}}</MarkdownContentShell>
      </template>,
    );
    assert.strictEqual(
      computedOf('[data-test-markdown-content-shell] h1', 'margin-top'),
      '0px',
      'the first heading sits flush with the top of the surface',
    );
    assert.notStrictEqual(
      computedOf('[data-test-markdown-content-shell] h2', 'margin-top'),
      '0px',
      'a later heading keeps its block margin',
    );
  });
});
