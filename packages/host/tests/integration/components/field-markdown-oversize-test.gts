import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import {
  type Loader,
  MAX_MARKDOWN_RENDER_LENGTH,
} from '@cardstack/runtime-common';
import { OVERSIZED_MARKDOWN_PREVIEW_LENGTH } from '@cardstack/runtime-common/marked-sync';

import {
  CardDef,
  contains,
  field,
  MarkdownField,
  setupBaseRealm,
} from '../../helpers/base-realm';
import { renderCard } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

// A bare CardDef subclass with a MarkdownField renders through the default
// isolated template, which drives the field's embedded format ->
// `default-templates/markdown.gts`. Content past MAX_MARKDOWN_RENDER_LENGTH
// must skip the synchronous markdown parse and fall back to a bounded notice
// so a multi-MB field can never block the render thread.
module('Integration | field markdown oversize', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);

  let loader: Loader;

  hooks.beforeEach(function (this: RenderingTestContext) {
    loader = getService('loader-service').loader;
  });

  test('over-limit content renders a notice instead of parsing markdown', async function (this: RenderingTestContext, assert) {
    class Doc extends CardDef {
      @field body = contains(MarkdownField);
    }

    // A markdown heading up front proves the parser never ran: an `<h1>` would
    // exist if `# Heading` had been parsed.
    let body = '# Heading\n\n' + 'a'.repeat(MAX_MARKDOWN_RENDER_LENGTH);
    assert.true(
      body.length > MAX_MARKDOWN_RENDER_LENGTH,
      'test content exceeds the render bound',
    );
    let doc = new Doc({ body });

    await renderCard(loader, doc, 'isolated');

    assert
      .dom('[data-test-markdown-oversized]')
      .exists('over-limit content renders the notice');
    assert
      .dom('.markdown-content h1')
      .doesNotExist('markdown was not parsed into HTML');
    assert
      .dom('.markdown-oversized-notice')
      .hasTextContaining('too large to render as Markdown');
    // The size label is derived from the content length (~512 KB here).
    assert.dom('.markdown-oversized-notice').hasTextContaining('KB');
    assert
      .dom('.markdown-oversized-preview')
      .hasTextContaining(
        '# Heading',
        'the preview shows the raw content start',
      );
  });

  test('the preview is truncated and escaped, not the full content', async function (this: RenderingTestContext, assert) {
    class Doc extends CardDef {
      @field body = contains(MarkdownField);
    }

    // Leading `<script>` proves the preview is escaped (rendered as text, not
    // executed/parsed as an element).
    let body =
      '<script>alert(1)</script>' + 'b'.repeat(MAX_MARKDOWN_RENDER_LENGTH);
    let doc = new Doc({ body });

    await renderCard(loader, doc, 'isolated');

    let preview = this.element.querySelector('.markdown-oversized-preview');
    assert.ok(preview, 'preview element renders');
    assert
      .dom('.markdown-oversized-preview script')
      .doesNotExist('raw script tag is escaped, not injected as an element');
    // The preview is the leading OVERSIZED_MARKDOWN_PREVIEW_LENGTH characters
    // plus a trailing ellipsis, decoded back to text — not the whole field.
    let previewLength = preview?.textContent?.length ?? 0;
    assert.strictEqual(
      previewLength,
      OVERSIZED_MARKDOWN_PREVIEW_LENGTH + 1,
      'preview is truncated to the preview length plus an ellipsis',
    );
  });

  test('content at or below the bound renders normally', async function (this: RenderingTestContext, assert) {
    class Doc extends CardDef {
      @field body = contains(MarkdownField);
    }

    let doc = new Doc({ body: '# Heading\n\nSome **bold** text.' });

    await renderCard(loader, doc, 'isolated');

    assert
      .dom('[data-test-markdown-oversized]')
      .doesNotExist('in-bounds content is not clamped');
    assert.dom('.markdown-content h1').hasText('Heading');
    assert.dom('.markdown-content strong').hasText('bold');
  });

  test('content exactly at the bound still renders as markdown', async function (this: RenderingTestContext, assert) {
    class Doc extends CardDef {
      @field body = contains(MarkdownField);
    }

    // The clamp is strict `>`, so content of exactly the bound length parses.
    // `# ` + filler adds up to exactly MAX_MARKDOWN_RENDER_LENGTH characters.
    let heading = '# Heading\n\n';
    let body =
      heading + 'a'.repeat(MAX_MARKDOWN_RENDER_LENGTH - heading.length);
    assert.strictEqual(
      body.length,
      MAX_MARKDOWN_RENDER_LENGTH,
      'test content is exactly at the bound',
    );
    let doc = new Doc({ body });

    await renderCard(loader, doc, 'isolated');

    assert
      .dom('[data-test-markdown-oversized]')
      .doesNotExist('content exactly at the bound is not clamped');
    assert.dom('.markdown-content h1').hasText('Heading');
  });
});
