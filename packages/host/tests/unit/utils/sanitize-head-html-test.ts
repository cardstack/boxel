import { module, test } from 'qunit';

import { sanitizeHeadHTML } from '@cardstack/host/utils/sanitize-head-html';

module('Unit | Utils | sanitizeHeadHTML', function () {
  test('filters head markup to allowed elements and attributes', function (assert) {
    let input = `
      <title data-test-title="ok" onclick="alert(1)">Hello</title>
      <meta name="description" content="desc" charset="utf-8" onload="bad">
      <link rel="canonical" href="https://example.com" onclick="bad" data-test-link="ok">
      <link rel="preload" href="https://example.com/app.js" as="script">
      <link rel="icon" href="javascript:alert(1)">
      <script>alert(1)</script>
      <style>.x{}</style>
      <div>nope</div>
    `;

    let fragment = sanitizeHeadHTML(input, document);
    assert.ok(fragment, 'returns a fragment when allowed elements exist');

    let container = document.createElement('div');
    if (fragment) {
      container.appendChild(fragment);
    }

    let elements = Array.from(container.children);
    assert.strictEqual(elements.length, 3, 'only allowed elements remain');

    let title = container.querySelector('title');
    assert.ok(title, 'title is preserved');
    assert.strictEqual(title?.textContent, 'Hello');
    assert.false(
      title?.hasAttribute('data-test-title') ?? false,
      'data attributes are removed',
    );
    assert.false(
      title?.hasAttribute('onclick') ?? false,
      'event handler attributes are removed',
    );

    let meta = container.querySelector('meta[name="description"]');
    assert.ok(meta, 'meta element is preserved');
    assert.strictEqual(meta?.getAttribute('content'), 'desc');
    assert.false(
      meta?.hasAttribute('charset') ?? false,
      'disallowed meta attributes are removed',
    );
    assert.false(
      meta?.hasAttribute('onload') ?? false,
      'disallowed meta attributes are removed',
    );

    let link = container.querySelector('link[rel="canonical"]');
    assert.ok(link, 'safe link rel is preserved');
    assert.strictEqual(link?.getAttribute('href'), 'https://example.com');
    assert.false(
      link?.hasAttribute('data-test-link') ?? false,
      'data attributes are removed',
    );
    assert.false(
      link?.hasAttribute('onclick') ?? false,
      'disallowed link attributes are removed',
    );
    assert.strictEqual(
      container.querySelector('link[rel="preload"]'),
      null,
      'unsafe link rel is removed',
    );
    assert.strictEqual(
      container.querySelector('link[rel="icon"]'),
      null,
      'unsafe link href is removed',
    );
    assert.strictEqual(
      container.querySelector('script'),
      null,
      'script tags are removed',
    );
    assert.strictEqual(
      container.querySelector('style'),
      null,
      'style tags are removed',
    );
    assert.strictEqual(
      container.querySelector('div'),
      null,
      'disallowed tags are removed',
    );
  });

  test('returns null when no allowed head elements remain', function (assert) {
    let fragment = sanitizeHeadHTML('<script>alert(1)</script>', document);
    assert.strictEqual(fragment, null);
  });

  test('ignores text nodes, comments, and whitespace-only input', function (assert) {
    let fragment = sanitizeHeadHTML(
      '  \n<!-- comment --><title>Ok</title>\nText node\n',
      document,
    );
    assert.ok(fragment, 'fragment is returned when allowed elements exist');

    let container = document.createElement('div');
    if (fragment) {
      container.appendChild(fragment);
    }

    assert.strictEqual(
      container.querySelectorAll('title').length,
      1,
      'title element preserved',
    );
    assert.strictEqual(
      container.childNodes.length,
      1,
      'non-element nodes are filtered out',
    );

    let empty = sanitizeHeadHTML('   \n\t', document);
    assert.strictEqual(empty, null, 'whitespace-only input returns null');
  });

  test('preserves multiple title tags and filters nested disallowed elements', function (assert) {
    let fragment = sanitizeHeadHTML(
      '<title>First</title><title>Second</title><div><meta name="a" content="b"></div>',
      document,
    );
    assert.ok(fragment, 'fragment is returned when allowed elements exist');

    let container = document.createElement('div');
    if (fragment) {
      container.appendChild(fragment);
    }

    assert.strictEqual(
      container.querySelectorAll('title').length,
      2,
      'multiple title tags are preserved',
    );
    assert.strictEqual(
      container.querySelectorAll('meta').length,
      0,
      'nested disallowed elements are removed',
    );
  });

  test('drops encoded javascript in link hrefs', function (assert) {
    let fragment = sanitizeHeadHTML(
      '<link rel="icon" href="java&#x73;cript:alert(1)">',
      document,
    );
    assert.strictEqual(
      fragment,
      null,
      'encoded javascript href is rejected',
    );
  });
});
