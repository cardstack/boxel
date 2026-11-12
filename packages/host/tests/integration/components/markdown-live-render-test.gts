import type { RenderingTestContext } from '@ember/test-helpers';
import { render, settled } from '@ember/test-helpers';

import {
  CardDef,
  contains,
  field,
  getComponent,
} from '@cardstack/base/card-api';
import MarkdownField from '@cardstack/base/markdown';
import { module, test } from 'qunit';

import { setupRenderingTest } from '../../helpers/setup';

// A host tab that renders a card for its own index sets the render context
// only while that render runs, scoped to the element the render mounts into.
// Markdown rendered anywhere else in the tab during that window is still
// someone's live view, so it loads KaTeX like any other live render; markdown
// inside the index render's element keeps the raw placeholders.

const INDEX_RENDER_SCOPE = 'test-index-render';

module('Integration | markdown live render', function (hooks) {
  setupRenderingTest(hooks);

  let originalLoadKatex: unknown;

  hooks.beforeEach(function (this: RenderingTestContext) {
    originalLoadKatex = (globalThis as any).__loadKatex;
    (globalThis as any).__loadKatex = async () => {
      let mod = await import('katex');
      return mod.default;
    };
  });

  hooks.afterEach(function () {
    (globalThis as any).__loadKatex = originalLoadKatex;
    delete (globalThis as any).__boxelRenderContext;
    delete (globalThis as any).__boxelRenderContextScope;
  });

  function mathDoc() {
    class Doc extends CardDef {
      @field body = contains(MarkdownField);
    }
    let doc = new Doc({ body: 'The formula $E = mc^2$ is famous.' });
    return getComponent(doc);
  }

  test('markdown outside a scoped index render renders math with KaTeX', async function (assert) {
    let DocComponent = mathDoc();
    (globalThis as any).__boxelRenderContext = true;
    (globalThis as any).__boxelRenderContextScope = INDEX_RENDER_SCOPE;

    await render(
      <template>
        <div id={{INDEX_RENDER_SCOPE}}></div>
        <DocComponent @format='isolated' />
      </template>,
    );

    assert
      .dom('.math-placeholder .katex')
      .exists('the live render loads KaTeX while the index render runs');

    delete (globalThis as any).__boxelRenderContext;
    delete (globalThis as any).__boxelRenderContextScope;
    await settled();

    assert
      .dom('.math-placeholder .katex')
      .exists('the rendered math survives the index render finishing');
    assert
      .dom('.math-placeholder')
      .doesNotIncludeText('$E = mc^2$', 'raw LaTeX source is replaced');
  });

  test('markdown inside a scoped index render keeps the raw math placeholders', async function (assert) {
    let DocComponent = mathDoc();
    (globalThis as any).__boxelRenderContext = true;
    (globalThis as any).__boxelRenderContextScope = INDEX_RENDER_SCOPE;

    await render(
      <template>
        <div id={{INDEX_RENDER_SCOPE}}>
          <DocComponent @format='isolated' />
        </div>
      </template>,
    );

    assert
      .dom('.math-placeholder')
      .exists('the index render emits the math placeholder');
    assert
      .dom('.math-placeholder .katex')
      .doesNotExist('the index render does not load KaTeX');
  });

  test('markdown rendered with no render context renders math with KaTeX', async function (assert) {
    let DocComponent = mathDoc();

    await render(<template><DocComponent @format='isolated' /></template>);

    assert
      .dom('.math-placeholder .katex')
      .exists('a plain live render loads KaTeX');
  });
});
