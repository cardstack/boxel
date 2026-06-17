import Service from '@ember/service';
import { settled, waitUntil } from '@ember/test-helpers';

import GlimmerComponent from '@glimmer/component';

import { module, test } from 'qunit';

import RenderedMarkdown from '@cardstack/host/components/operator-mode/preview-panel/rendered-markdown';

import { testRealmURL } from '../../helpers';
import { renderComponent } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

class MockLocalIndexer extends Service {
  url = new URL(testRealmURL);
}

module('Integration | rendered-markdown', function (hooks) {
  setupRenderingTest(hooks);

  hooks.beforeEach(function () {
    this.owner.register('service:local-indexer', MockLocalIndexer);
  });

  test('renders basic markdown as HTML', async function (assert) {
    let content = '# Hello World\n\nSome **bold** and _italic_ text.';

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><RenderedMarkdown @content={{content}} /></template>
      },
    );
    await settled();

    assert.dom('.markdown-content h1').hasText('Hello World');
    assert.dom('.markdown-content strong').hasText('bold');
    assert.dom('.markdown-content em').hasText('italic');
  });

  test('renders lists correctly', async function (assert) {
    let content = '- alpha\n- beta\n\n1. one\n2. two';

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><RenderedMarkdown @content={{content}} /></template>
      },
    );
    await settled();

    assert.dom('.markdown-content ul').exists('unordered list renders');
    assert.dom('.markdown-content ul li').exists({ count: 2 });
    assert.dom('.markdown-content ol').exists('ordered list renders');
    assert.dom('.markdown-content ol li').exists({ count: 2 });
  });

  test('renders links and code', async function (assert) {
    let content = 'Visit [example](https://example.com) and use `npm install`.';

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><RenderedMarkdown @content={{content}} /></template>
      },
    );
    await settled();

    assert
      .dom('.markdown-content a')
      .hasAttribute('href', 'https://example.com');
    assert.dom('.markdown-content a').hasText('example');
    assert.dom('.markdown-content code').hasText('npm install');
  });

  test('wraps tables in scrollable wrapper', async function (assert) {
    let content = '| Col A | Col B |\n| --- | --- |\n| 1 | 2 |';

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><RenderedMarkdown @content={{content}} /></template>
      },
    );
    await settled();

    assert
      .dom('.markdown-content .table-wrapper')
      .exists('table is inside scrollable wrapper');
    assert
      .dom('.markdown-content .table-wrapper table')
      .exists('table renders inside wrapper');
  });

  test('inline :card[URL] creates BFM placeholder element', async function (assert) {
    let cardUrl = 'http://example.com/Author/abc123';
    let content = `Written by :card[${cardUrl}].`;

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><RenderedMarkdown @content={{content}} /></template>
      },
    );
    await settled();

    assert
      .dom('.markdown-content [data-boxel-bfm-inline-ref]')
      .exists('inline BFM placeholder element is created');
    assert
      .dom(`.markdown-content [data-boxel-bfm-inline-ref="${cardUrl}"]`)
      .exists('placeholder has correct card URL in data attribute');
    assert
      .dom(
        '.markdown-content [data-boxel-bfm-inline-ref][data-boxel-bfm-type="card"]',
      )
      .exists('placeholder has card type attribute');
  });

  test('block ::card[URL] creates BFM placeholder element', async function (assert) {
    let cardUrl = 'http://example.com/Article/def456';
    let content = `# Summary\n\n::card[${cardUrl}]\n\nMore text.`;

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><RenderedMarkdown @content={{content}} /></template>
      },
    );
    await settled();

    assert
      .dom('.markdown-content [data-boxel-bfm-block-ref]')
      .exists('block BFM placeholder element is created');
    assert
      .dom(`.markdown-content [data-boxel-bfm-block-ref="${cardUrl}"]`)
      .exists('placeholder has correct card URL in data attribute');
    assert
      .dom(
        '.markdown-content [data-boxel-bfm-block-ref][data-boxel-bfm-type="card"]',
      )
      .exists('placeholder has card type attribute');
  });

  test('inline :file[URL] creates BFM placeholder element', async function (assert) {
    let fileUrl = 'http://example.com/docs/report.pdf';
    let content = `See :file[${fileUrl}] here.`;

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><RenderedMarkdown @content={{content}} /></template>
      },
    );
    await settled();

    assert
      .dom(`.markdown-content [data-boxel-bfm-inline-ref="${fileUrl}"]`)
      .exists('placeholder has correct file URL in data attribute');
    assert
      .dom(
        '.markdown-content [data-boxel-bfm-inline-ref][data-boxel-bfm-type="file"]',
      )
      .exists('placeholder has file type attribute');
  });

  test('block ::file[URL] creates BFM placeholder element', async function (assert) {
    let fileUrl = 'http://example.com/data/sample.csv';
    let content = `# Summary\n\n::file[${fileUrl}]\n\nMore text.`;

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><RenderedMarkdown @content={{content}} /></template>
      },
    );
    await settled();

    assert
      .dom(`.markdown-content [data-boxel-bfm-block-ref="${fileUrl}"]`)
      .exists('placeholder has correct file URL in data attribute');
    assert
      .dom(
        '.markdown-content [data-boxel-bfm-block-ref][data-boxel-bfm-type="file"]',
      )
      .exists('placeholder has file type attribute');
  });

  test('unresolved file reference shows fallback with the file name', async function (assert) {
    // When a file URL can't be loaded, the modifier creates an unresolved slot
    // labeled with the file name (last path segment), not a card type name.
    let fileUrl = 'http://nonexistent.example.com/docs/missing.pdf';
    let content = `See :file[${fileUrl}] here.`;

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><RenderedMarkdown @content={{content}} /></template>
      },
    );
    await settled();

    await waitUntil(
      () =>
        document.querySelector('[data-test-markdown-bfm-unresolved-inline]') !==
        null,
      {
        timeout: 5000,
        timeoutMessage: 'unresolved file fallback did not appear',
      },
    );

    assert
      .dom('[data-test-markdown-bfm-unresolved-inline]')
      .hasAttribute('title', fileUrl, 'fallback has URL as title');
    assert
      .dom('[data-test-markdown-bfm-unresolved-inline]')
      .containsText('missing.pdf', 'fallback shows the file name');
  });

  test('BFM card placeholders have URL text stripped', async function (assert) {
    // The renderedHtml getter strips text from BFM card elements to prevent
    // flashing raw URLs before cards load or pills render.
    let cardUrl = 'http://example.com/Pet/ghi789';
    let content = `See :card[${cardUrl}] here.`;

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><RenderedMarkdown @content={{content}} /></template>
      },
    );
    await settled();

    let el = document.querySelector(
      `.markdown-content [data-boxel-bfm-inline-ref="${cardUrl}"]`,
    );
    assert.ok(el, 'placeholder element exists');
    // Before the modifier runs and cards load, the element text is empty
    // (stripped in renderedHtml). After the modifier, it may contain a pill
    // or card component, but never the raw URL.
    assert.false(
      el?.textContent?.includes(cardUrl),
      'raw card URL is not shown as text content',
    );
  });

  test('unresolved card reference shows pill fallback', async function (assert) {
    // When a card URL can't be loaded, the modifier creates an unresolved
    // slot that renders a Pill with the type name extracted from the URL.
    let cardUrl = 'http://nonexistent.example.com/Pet/unknown';
    let content = `See :card[${cardUrl}] here.`;

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><RenderedMarkdown @content={{content}} /></template>
      },
    );
    await settled();

    // Wait for the card loading task to complete and the modifier to re-run.
    // The store.get() call will fail for a non-existent URL, triggering the
    // unresolved fallback path.
    await waitUntil(
      () =>
        document.querySelector('[data-test-markdown-bfm-unresolved-inline]') !==
        null,
      { timeout: 5000, timeoutMessage: 'unresolved pill did not appear' },
    );

    assert
      .dom('[data-test-markdown-bfm-unresolved-inline]')
      .exists('unresolved inline pill renders');
    assert
      .dom('[data-test-markdown-bfm-unresolved-inline]')
      .hasAttribute('title', cardUrl, 'pill has URL as title');
    // cardTypeName extracts "Pet" from the URL path
    assert
      .dom('[data-test-markdown-bfm-unresolved-inline]')
      .containsText('Pet', 'pill shows extracted type name');
  });

  test('unresolved block card reference shows pill fallback', async function (assert) {
    let cardUrl = 'http://nonexistent.example.com/BlogPost/unknown';
    let content = `# Title\n\n::card[${cardUrl}]\n\nEnd.`;

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><RenderedMarkdown @content={{content}} /></template>
      },
    );
    await settled();

    await waitUntil(
      () =>
        document.querySelector('[data-test-markdown-bfm-unresolved-block]') !==
        null,
      { timeout: 5000, timeoutMessage: 'unresolved block pill did not appear' },
    );

    assert
      .dom('[data-test-markdown-bfm-unresolved-block]')
      .exists('unresolved block pill renders');
    assert
      .dom('[data-test-markdown-bfm-unresolved-block]')
      .hasAttribute('title', cardUrl, 'pill has URL as title');
    assert
      .dom('[data-test-markdown-bfm-unresolved-block]')
      .containsText('BlogPost', 'pill shows extracted type name');
  });

  test('multiple card references create separate placeholders', async function (assert) {
    let url1 = 'http://example.com/Author/a1';
    let url2 = 'http://example.com/Article/a2';
    let content = `By :card[${url1}]\n\n::card[${url2}]`;

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><RenderedMarkdown @content={{content}} /></template>
      },
    );
    await settled();

    assert
      .dom('.markdown-content [data-boxel-bfm-inline-ref]')
      .exists({ count: 1 }, 'one inline placeholder');
    assert
      .dom('.markdown-content [data-boxel-bfm-block-ref]')
      .exists({ count: 1 }, 'one block placeholder');
    assert
      .dom(`[data-boxel-bfm-inline-ref="${url1}"]`)
      .exists('inline ref has correct URL');
    assert
      .dom(`[data-boxel-bfm-block-ref="${url2}"]`)
      .exists('block ref has correct URL');
  });

  test('card references inside code blocks are not converted', async function (assert) {
    let content =
      '```\n:card[http://example.com/Foo/1]\n```\n\nReal ref: :card[http://example.com/Bar/2]';

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><RenderedMarkdown @content={{content}} /></template>
      },
    );
    await settled();

    // Only one BFM placeholder should exist — the one outside the code block.
    assert
      .dom('.markdown-content [data-boxel-bfm-inline-ref]')
      .exists({ count: 1 }, 'only the non-code-block reference is converted');
    assert
      .dom('[data-boxel-bfm-inline-ref="http://example.com/Bar/2"]')
      .exists('the correct reference is converted');
  });

  test('block card reference with size spec sets data attributes', async function (assert) {
    let cardUrl = 'http://example.com/Card/1';
    let content = `::card[${cardUrl} | 400x200]`;

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><RenderedMarkdown @content={{content}} /></template>
      },
    );
    await settled();

    let el = document.querySelector(
      `.markdown-content [data-boxel-bfm-block-ref="${cardUrl}"]`,
    );
    assert.ok(el, 'block placeholder exists');
    assert.strictEqual(
      el?.getAttribute('data-boxel-bfm-format'),
      'fitted',
      'format is set to fitted',
    );
    assert.strictEqual(
      el?.getAttribute('data-boxel-bfm-width'),
      '400',
      'width is set',
    );
    assert.strictEqual(
      el?.getAttribute('data-boxel-bfm-height'),
      '200',
      'height is set',
    );
  });

  test('unresolved embedded block ref renders with embedded format class', async function (assert) {
    let cardUrl = 'http://nonexistent.example.com/Article/missing';
    let content = `::card[${cardUrl}]`;

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><RenderedMarkdown @content={{content}} /></template>
      },
    );

    await waitUntil(
      () =>
        document.querySelector('[data-test-markdown-bfm-unresolved-block]') !==
        null,
      { timeout: 5000, timeoutMessage: 'unresolved block did not appear' },
    );

    assert
      .dom('[data-test-markdown-bfm-unresolved-block]')
      .hasClass(
        'markdown-bfm-broken--embedded',
        'block ref defaults to the embedded footprint',
      );
    assert
      .dom('[data-test-markdown-bfm-unresolved-block]')
      .doesNotHaveAttribute(
        'style',
        'embedded broken-link box does not carry an inline width/height style',
      );
  });

  test('unresolved isolated block ref renders with isolated format class', async function (assert) {
    let cardUrl = 'http://nonexistent.example.com/Article/missing-isolated';
    let content = `::card[${cardUrl} | isolated]`;

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><RenderedMarkdown @content={{content}} /></template>
      },
    );

    await waitUntil(
      () =>
        document.querySelector('[data-test-markdown-bfm-unresolved-block]') !==
        null,
      { timeout: 5000, timeoutMessage: 'unresolved block did not appear' },
    );

    assert
      .dom('[data-test-markdown-bfm-unresolved-block]')
      .hasClass(
        'markdown-bfm-broken--isolated',
        'isolated ref carries the isolated footprint class',
      );
  });

  test('unresolved fitted block ref carries inline width/height matching the card footprint', async function (assert) {
    let cardUrl = 'http://nonexistent.example.com/Article/missing-fitted';
    let content = `::card[${cardUrl} | 400x200]`;

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><RenderedMarkdown @content={{content}} /></template>
      },
    );

    await waitUntil(
      () =>
        document.querySelector('[data-test-markdown-bfm-unresolved-block]') !==
        null,
      { timeout: 5000, timeoutMessage: 'unresolved block did not appear' },
    );

    let brokenBlock = document.querySelector(
      '[data-test-markdown-bfm-unresolved-block]',
    ) as HTMLElement | null;
    assert.ok(brokenBlock, 'broken-link block exists');
    assert
      .dom(brokenBlock)
      .hasClass(
        'markdown-bfm-broken--fitted',
        'fitted ref carries the fitted footprint class',
      );
    let style = brokenBlock?.getAttribute('style') ?? '';
    assert.true(
      /width:\s*400px/.test(style),
      `broken-link inline style includes width: 400px (got "${style}")`,
    );
    assert.true(
      /height:\s*200px/.test(style),
      `broken-link inline style includes height: 200px (got "${style}")`,
    );
  });

  test('block ::file with a size spec is honored the same way ::card is', async function (assert) {
    let fileUrl = 'http://example.com/images/photo.png';
    let content = `::file[${fileUrl} | 400x200]`;

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><RenderedMarkdown @content={{content}} /></template>
      },
    );
    await settled();

    let el = document.querySelector(
      `.markdown-content [data-boxel-bfm-block-ref="${fileUrl}"]`,
    );
    assert.ok(el, 'block file placeholder exists');
    assert.strictEqual(
      el?.getAttribute('data-boxel-bfm-format'),
      'fitted',
      'file size spec sets fitted format',
    );
    assert.strictEqual(el?.getAttribute('data-boxel-bfm-width'), '400');
    assert.strictEqual(el?.getAttribute('data-boxel-bfm-height'), '200');
  });

  test('unresolved fitted block ::file carries inline width/height matching the footprint', async function (assert) {
    let fileUrl = 'http://nonexistent.example.com/images/missing.png';
    let content = `::file[${fileUrl} | 400x200]`;

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><RenderedMarkdown @content={{content}} /></template>
      },
    );

    await waitUntil(
      () =>
        document.querySelector('[data-test-markdown-bfm-unresolved-block]') !==
        null,
      { timeout: 5000, timeoutMessage: 'unresolved file block did not appear' },
    );

    let brokenBlock = document.querySelector(
      '[data-test-markdown-bfm-unresolved-block]',
    ) as HTMLElement | null;
    assert.ok(brokenBlock, 'broken-link block exists');
    assert
      .dom(brokenBlock)
      .hasClass(
        'markdown-bfm-broken--fitted',
        'fitted file ref carries the fitted footprint class',
      );
    let style = brokenBlock?.getAttribute('style') ?? '';
    assert.true(
      /width:\s*400px/.test(style),
      `broken-link inline style includes width: 400px (got "${style}")`,
    );
    assert.true(
      /height:\s*200px/.test(style),
      `broken-link inline style includes height: 200px (got "${style}")`,
    );
  });

  test('loading placeholder appears before unresolved card ref settles', async function (assert) {
    // The modifier emits a loading shimmer on its first run (before
    // loadReferencedCards has settled) and only transitions to the broken-link
    // box afterwards. Observe the DOM to confirm the loading element actually
    // appears — the existing "no broken Pill flashed" tests only check absence
    // of the unresolved selector and would still pass if the loading element
    // never rendered.
    let cardUrl = 'http://nonexistent.example.com/Article/missing-loading';
    let content = `::card[${cardUrl} | 400x200]`;

    let loadingEverAppeared = false;
    let capturedLoadingStyle = '';
    let capturedLoadingClasses = '';
    let testRoot = document.querySelector('#ember-testing')!;
    let observer = new MutationObserver(() => {
      let loadingEl = testRoot.querySelector(
        '[data-test-markdown-bfm-loading-block]',
      ) as HTMLElement | null;
      if (loadingEl) {
        loadingEverAppeared = true;
        capturedLoadingStyle =
          loadingEl.getAttribute('style') ?? capturedLoadingStyle;
        capturedLoadingClasses = loadingEl.className || capturedLoadingClasses;
      }
    });
    observer.observe(testRoot, { childList: true, subtree: true });

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><RenderedMarkdown @content={{content}} /></template>
      },
    );

    await waitUntil(
      () =>
        document.querySelector('[data-test-markdown-bfm-unresolved-block]') !==
        null,
      { timeout: 5000, timeoutMessage: 'unresolved block did not appear' },
    );

    observer.disconnect();

    assert.true(
      loadingEverAppeared,
      'loading shimmer block appeared before the broken-link box',
    );
    assert.true(
      capturedLoadingClasses.includes('markdown-bfm-loading--fitted'),
      `loading block carries the fitted footprint class (got "${capturedLoadingClasses}")`,
    );
    assert.true(
      /width:\s*400px/.test(capturedLoadingStyle),
      `loading block inline style includes width: 400px (got "${capturedLoadingStyle}")`,
    );
    assert.true(
      /height:\s*200px/.test(capturedLoadingStyle),
      `loading block inline style includes height: 200px (got "${capturedLoadingStyle}")`,
    );
  });
});
