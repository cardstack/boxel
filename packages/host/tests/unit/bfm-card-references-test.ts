import { module, test } from 'qunit';

import {
  extractCardReferenceUrls,
  extractBfmReferences,
  bfmCardReferenceExtensions,
  bfmExtensionsForKeyword,
} from '@cardstack/runtime-common/bfm-card-references';
import { markdownToHtml } from '@cardstack/runtime-common/marked-sync';

module('Unit | bfm-card-references', function () {
  module('extractCardReferenceUrls', function () {
    test('extracts inline card references', function (assert) {
      let markdown = 'See :card[https://example.com/cards/1] for details.';
      let urls = extractCardReferenceUrls(markdown, 'https://base.com/');
      assert.deepEqual(urls, ['https://example.com/cards/1']);
    });

    test('extracts block card references', function (assert) {
      let markdown = '::card[https://example.com/cards/1]\n';
      let urls = extractCardReferenceUrls(markdown, 'https://base.com/');
      assert.deepEqual(urls, ['https://example.com/cards/1']);
    });

    test('extracts both inline and block references', function (assert) {
      let markdown = [
        '::card[https://example.com/cards/1]',
        '',
        'Text with :card[https://example.com/cards/2] inline.',
      ].join('\n');
      let urls = extractCardReferenceUrls(markdown, 'https://base.com/');
      assert.deepEqual(urls, [
        'https://example.com/cards/1',
        'https://example.com/cards/2',
      ]);
    });

    test('resolves relative URLs against base', function (assert) {
      let markdown = ':card[./my-card]';
      let urls = extractCardReferenceUrls(
        markdown,
        'https://realm.example/docs/file.md',
      );
      assert.deepEqual(urls, ['https://realm.example/docs/my-card']);
    });

    test('deduplicates URLs', function (assert) {
      let markdown = [
        ':card[https://example.com/cards/1]',
        ':card[https://example.com/cards/1]',
      ].join('\n');
      let urls = extractCardReferenceUrls(markdown, 'https://base.com/');
      assert.deepEqual(urls, ['https://example.com/cards/1']);
    });

    test('ignores references inside fenced code blocks', function (assert) {
      let markdown = ['```', ':card[https://example.com/cards/1]', '```'].join(
        '\n',
      );
      let urls = extractCardReferenceUrls(markdown, 'https://base.com/');
      assert.deepEqual(urls, []);
    });

    test('ignores references inside inline code', function (assert) {
      let markdown = 'Use `:card[url]` syntax.';
      let urls = extractCardReferenceUrls(markdown, 'https://base.com/');
      assert.deepEqual(urls, []);
    });

    test('ignores references inside multi-backtick inline code', function (assert) {
      let markdown = 'Use ``:card[https://example.com/cards/1]`` syntax.';
      let urls = extractCardReferenceUrls(markdown, 'https://base.com/');
      assert.deepEqual(urls, []);
    });

    test('skips malformed URLs with empty base', function (assert) {
      let markdown = ':card[not a valid url at all]';
      let urls = extractCardReferenceUrls(markdown, '');
      assert.deepEqual(urls, []);
    });

    test('returns empty array for markdown without references', function (assert) {
      let markdown = '# Hello World\n\nNo card references here.';
      let urls = extractCardReferenceUrls(markdown, 'https://base.com/');
      assert.deepEqual(urls, []);
    });

    test('returns empty array for empty markdown', function (assert) {
      let urls = extractCardReferenceUrls('', 'https://base.com/');
      assert.deepEqual(urls, []);
    });
  });

  module('extractBfmReferences', function () {
    test('extracts references for multiple keywords', function (assert) {
      let markdown = [
        ':card[https://example.com/cards/1]',
        ':file[https://example.com/files/1]',
      ].join('\n');
      let refs = extractBfmReferences(markdown, 'https://base.com/', [
        'card',
        'file',
      ]);
      assert.deepEqual(refs, [
        { url: 'https://example.com/cards/1', keyword: 'card' },
        { url: 'https://example.com/files/1', keyword: 'file' },
      ]);
    });

    test('deduplicates across keywords by URL', function (assert) {
      let markdown = [
        ':card[https://example.com/thing]',
        ':file[https://example.com/thing]',
      ].join('\n');
      let refs = extractBfmReferences(markdown, 'https://base.com/', [
        'card',
        'file',
      ]);
      assert.strictEqual(refs.length, 1);
      assert.strictEqual(refs[0].url, 'https://example.com/thing');
    });
  });

  module('bfmCardReferenceExtensions', function () {
    test('returns two extensions for card keyword', function (assert) {
      let extensions = bfmCardReferenceExtensions();
      assert.strictEqual(extensions.length, 2);
      assert.strictEqual((extensions[0] as any).name, 'bfmCardBlock');
      assert.strictEqual((extensions[1] as any).name, 'bfmCardInline');
    });
  });

  module('bfmExtensionsForKeyword', function () {
    test('generates extensions with keyword-specific names', function (assert) {
      let extensions = bfmExtensionsForKeyword('file');
      assert.strictEqual(extensions.length, 2);
      assert.strictEqual((extensions[0] as any).name, 'bfmFileBlock');
      assert.strictEqual((extensions[1] as any).name, 'bfmFileInline');
    });
  });

  module('markdownToHtml with BFM syntax', function () {
    test('inline card ref produces span placeholder with bfm attributes', function (assert) {
      let markdown = 'See :card[https://example.com/cards/1] here.';
      let html = markdownToHtml(markdown);
      assert.true(
        html.includes(
          'data-boxel-bfm-inline-ref="https://example.com/cards/1"',
        ),
        'inline placeholder has ref data attribute',
      );
      assert.true(
        html.includes('data-boxel-bfm-type="card"'),
        'inline placeholder has type data attribute',
      );
      assert.true(
        html.includes('<span data-boxel-bfm-inline-ref='),
        'inline placeholder is a span element',
      );
    });

    test('block card ref produces div placeholder with bfm attributes', function (assert) {
      let markdown = '::card[https://example.com/cards/1]\n';
      let html = markdownToHtml(markdown);
      assert.true(
        html.includes('data-boxel-bfm-block-ref="https://example.com/cards/1"'),
        'block placeholder has ref data attribute',
      );
      assert.true(
        html.includes('data-boxel-bfm-type="card"'),
        'block placeholder has type data attribute',
      );
      assert.true(
        html.includes('<div data-boxel-bfm-block-ref='),
        'block placeholder is a div element',
      );
    });

    test('card refs inside code blocks are not processed', function (assert) {
      let markdown = ['```', ':card[https://example.com/cards/1]', '```'].join(
        '\n',
      );
      let html = markdownToHtml(markdown);
      assert.false(
        html.includes('data-boxel-bfm-inline-ref'),
        'no card ref placeholder inside code block',
      );
    });

    test('inline card ref inside inline code is not processed', function (assert) {
      let markdown = 'Use `:card[url]` syntax.';
      let html = markdownToHtml(markdown);
      assert.false(
        html.includes('data-boxel-bfm-inline-ref'),
        'no card ref placeholder inside inline code',
      );
    });

    test('DOMPurify preserves BFM placeholders', function (assert) {
      let markdown =
        'Text :card[https://example.com/cards/1] and more.\n\n::card[https://example.com/cards/2]\n';
      let html = markdownToHtml(markdown, { sanitize: true });
      assert.true(
        html.includes(
          'data-boxel-bfm-inline-ref="https://example.com/cards/1"',
        ),
        'inline ref survives sanitization',
      );
      assert.true(
        html.includes('data-boxel-bfm-block-ref="https://example.com/cards/2"'),
        'block ref survives sanitization',
      );
    });

    test('markdown without card refs is unaffected', function (assert) {
      let markdown = '# Hello\n\nSome **bold** text.';
      let withBfm = markdownToHtml(markdown);
      assert.true(withBfm.includes('<h1 id="hello">Hello</h1>'));
      assert.true(withBfm.includes('<strong>bold</strong>'));
      assert.false(withBfm.includes('data-boxel-bfm'));
    });

    test('HTML special chars in URLs are escaped in placeholders', function (assert) {
      let markdown = ':card[https://example.com/cards/1&foo=<bar>]';
      let html = markdownToHtml(markdown, { sanitize: false });
      assert.true(
        html.includes('&amp;foo=&lt;bar&gt;'),
        'URL special chars are escaped',
      );
    });

    test('mixed inline and block refs in a document', function (assert) {
      let markdown = [
        '# Title',
        '',
        'Intro text with :card[https://example.com/cards/inline] reference.',
        '',
        '::card[https://example.com/cards/block]',
        '',
        'More text.',
      ].join('\n');
      let html = markdownToHtml(markdown);
      assert.true(
        html.includes(
          'data-boxel-bfm-inline-ref="https://example.com/cards/inline"',
        ),
        'has inline ref',
      );
      assert.true(
        html.includes(
          'data-boxel-bfm-block-ref="https://example.com/cards/block"',
        ),
        'has block ref',
      );
      assert.true(
        html.includes('<h1 id="title">Title</h1>'),
        'heading preserved',
      );
    });
  });
});
