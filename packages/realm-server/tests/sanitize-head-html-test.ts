import { module, test } from 'qunit';
import { basename } from 'path';
import { JSDOM } from 'jsdom';
import {
  sanitizeHeadHTML,
  sanitizeHeadHTMLToString,
  findDisallowedHeadTags,
} from '@cardstack/runtime-common';

function makeDoc() {
  return new JSDOM().window.document;
}

module(basename(__filename), function () {
  module('sanitizeHeadHTML', function () {
    test('allows title, meta, and link tags', function (assert) {
      let doc = makeDoc();
      let html =
        '<title>Test</title><meta name="description" content="desc"><link rel="canonical" href="https://example.com">';
      let fragment = sanitizeHeadHTML(html, doc);
      assert.ok(fragment, 'returns a fragment');
      let container = doc.createElement('div');
      container.appendChild(fragment!);
      assert.ok(container.querySelector('title'), 'title tag is preserved');
      assert.ok(
        container.querySelector('meta[name="description"]'),
        'meta tag is preserved',
      );
      assert.ok(
        container.querySelector('link[rel="canonical"]'),
        'link tag is preserved',
      );
    });

    const strippedTags: { tag: string; html: string }[] = [
      { tag: 'script', html: '<script>alert("xss")</script>' },
      { tag: 'style', html: '<style>body { display: none }</style>' },
      { tag: 'noscript', html: '<noscript><p>No JS</p></noscript>' },
      { tag: 'base', html: '<base href="https://evil.com">' },
      { tag: 'div', html: '<div>bad</div>' },
      { tag: 'h1', html: '<h1>heading</h1>' },
      { tag: 'p', html: '<p>paragraph</p>' },
    ];

    for (let { tag, html: disallowedHtml } of strippedTags) {
      test(`strips ${tag} tags`, function (assert) {
        let doc = makeDoc();
        let html = `<title>Test</title>${disallowedHtml}`;
        let fragment = sanitizeHeadHTML(html, doc);
        assert.ok(fragment, 'returns a fragment');
        let container = doc.createElement('div');
        container.appendChild(fragment!);
        assert.ok(container.querySelector('title'), 'title is preserved');
        assert.notOk(container.querySelector(tag), `${tag} tag is stripped`);
      });
    }

    test('returns null when all content is disallowed', function (assert) {
      let doc = makeDoc();
      let html = '<script>alert("xss")</script><style>body{}</style>';
      let fragment = sanitizeHeadHTML(html, doc);
      assert.strictEqual(fragment, null, 'returns null');
    });

    test('returns null for empty string', function (assert) {
      let doc = makeDoc();
      let fragment = sanitizeHeadHTML('', doc);
      assert.strictEqual(fragment, null, 'returns null for empty string');
    });

    test('strips disallowed attributes from meta tags', function (assert) {
      let doc = makeDoc();
      let html =
        '<meta name="description" content="test" onclick="alert(1)" data-custom="bad">';
      let fragment = sanitizeHeadHTML(html, doc);
      assert.ok(fragment, 'returns a fragment');
      let container = doc.createElement('div');
      container.appendChild(fragment!);
      let meta = container.querySelector('meta');
      assert.ok(meta, 'meta tag is preserved');
      assert.strictEqual(
        meta!.getAttribute('name'),
        'description',
        'allowed attr preserved',
      );
      assert.strictEqual(
        meta!.getAttribute('content'),
        'test',
        'allowed attr preserved',
      );
      assert.notOk(meta!.hasAttribute('onclick'), 'onclick is stripped');
      assert.notOk(
        meta!.hasAttribute('data-custom'),
        'data-custom is stripped',
      );
    });

    test('strips link tags with unsafe rel values', function (assert) {
      let doc = makeDoc();
      let html =
        '<link rel="stylesheet" href="https://evil.com/style.css"><link rel="canonical" href="https://example.com">';
      let fragment = sanitizeHeadHTML(html, doc);
      assert.ok(fragment, 'returns a fragment');
      let container = doc.createElement('div');
      container.appendChild(fragment!);
      let links = container.querySelectorAll('link');
      assert.strictEqual(links.length, 1, 'only one link tag remains');
      assert.strictEqual(
        links[0].getAttribute('rel'),
        'canonical',
        'safe link is preserved',
      );
    });

    test('strips link tags with javascript: href', function (assert) {
      let doc = makeDoc();
      let html = '<link rel="icon" href="javascript:alert(1)">';
      let fragment = sanitizeHeadHTML(html, doc);
      assert.strictEqual(
        fragment,
        null,
        'returns null when link has unsafe href',
      );
    });
  });

  module('sanitizeHeadHTMLToString', function () {
    test('returns sanitized HTML as a string', function (assert) {
      let doc = makeDoc();
      let html =
        '<title>Test</title><script>alert("xss")</script><meta name="description" content="desc">';
      let result = sanitizeHeadHTMLToString(html, doc);
      assert.ok(result, 'returns a string');
      assert.ok(result!.includes('<title>'), 'title is in output');
      assert.ok(result!.includes('<meta'), 'meta is in output');
      assert.notOk(result!.includes('<script'), 'script is not in output');
      assert.notOk(
        result!.includes('alert'),
        'script content is not in output',
      );
    });

    test('returns null when all content is disallowed', function (assert) {
      let doc = makeDoc();
      let result = sanitizeHeadHTMLToString('<script>alert(1)</script>', doc);
      assert.strictEqual(result, null, 'returns null');
    });

    test('returns null for empty string', function (assert) {
      let doc = makeDoc();
      let result = sanitizeHeadHTMLToString('', doc);
      assert.strictEqual(result, null, 'returns null');
    });
  });

  module('findDisallowedHeadTags', function () {
    test('returns empty array for valid content', function (assert) {
      let doc = makeDoc();
      let html =
        '<title>Test</title><meta name="description" content="desc"><link rel="canonical" href="https://example.com">';
      let result = findDisallowedHeadTags(html, doc);
      assert.deepEqual(result, [], 'no disallowed tags');
    });

    const detectedTags: { tag: string; html: string }[] = [
      { tag: 'script', html: '<script>alert(1)</script>' },
      { tag: 'style', html: '<style>body{}</style>' },
      { tag: 'noscript', html: '<noscript>fallback</noscript>' },
      { tag: 'base', html: '<base href="https://evil.com">' },
    ];

    for (let { tag, html: disallowedHtml } of detectedTags) {
      test(`detects ${tag} tags`, function (assert) {
        let doc = makeDoc();
        let html = `<title>Test</title>${disallowedHtml}`;
        let result = findDisallowedHeadTags(html, doc);
        assert.deepEqual(result, [tag], `detects ${tag}`);
      });
    }

    test('detects multiple disallowed tag types', function (assert) {
      let doc = makeDoc();
      let html =
        '<script>x</script><style>y</style><noscript>z</noscript><base href="/">';
      let result = findDisallowedHeadTags(html, doc);
      assert.ok(result.includes('script'), 'detects script');
      assert.ok(result.includes('style'), 'detects style');
      assert.ok(result.includes('noscript'), 'detects noscript');
      assert.ok(result.includes('base'), 'detects base');
    });

    test('deduplicates repeated disallowed tags', function (assert) {
      let doc = makeDoc();
      let html = '<script>a</script><script>b</script><script>c</script>';
      let result = findDisallowedHeadTags(html, doc);
      assert.deepEqual(result, ['script'], 'script appears only once');
    });

    test('returns empty array for empty string', function (assert) {
      let doc = makeDoc();
      let result = findDisallowedHeadTags('', doc);
      assert.deepEqual(result, [], 'empty array for empty input');
    });

    test('detects arbitrary HTML elements', function (assert) {
      let doc = makeDoc();
      let html = '<div>bad</div><h1>heading</h1>';
      let result = findDisallowedHeadTags(html, doc);
      assert.ok(result.includes('div'), 'detects div');
      assert.ok(result.includes('h1'), 'detects h1');
    });
  });
});
