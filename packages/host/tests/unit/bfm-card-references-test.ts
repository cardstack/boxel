import { module, test } from 'qunit';

import { fittedFormatIds } from '@cardstack/boxel-ui/helpers';

import {
  extractCardReferenceUrls,
  extractFileReferenceUrls,
  extractBfmReferences,
  extractBfmRefRanges,
  bfmRefFormatAndSize,
  bfmCardReferenceExtensions,
  bfmExtensionsForKeyword,
  parseBfmSizeSpec,
  serializeBfmSizeSpec,
  serializeBfmRef,
  type BfmSizeSpec,
} from '@cardstack/runtime-common/bfm-card-references';
import { markdownToHtml } from '@cardstack/runtime-common/marked-sync';
import { VirtualNetwork } from '@cardstack/runtime-common/virtual-network';

const virtualNetwork = new VirtualNetwork();

module('Unit | bfm-card-references', function () {
  module('extractCardReferenceUrls', function () {
    test('extracts inline card references', function (assert) {
      let markdown = 'See :card[https://example.com/cards/1] for details.';
      let urls = extractCardReferenceUrls(
        markdown,
        'https://base.com/',
        virtualNetwork,
      );
      assert.deepEqual(urls, ['https://example.com/cards/1']);
    });

    test('extracts block card references', function (assert) {
      let markdown = '::card[https://example.com/cards/1]\n';
      let urls = extractCardReferenceUrls(
        markdown,
        'https://base.com/',
        virtualNetwork,
      );
      assert.deepEqual(urls, ['https://example.com/cards/1']);
    });

    test('extracts both inline and block references', function (assert) {
      let markdown = [
        '::card[https://example.com/cards/1]',
        '',
        'Text with :card[https://example.com/cards/2] inline.',
      ].join('\n');
      let urls = extractCardReferenceUrls(
        markdown,
        'https://base.com/',
        virtualNetwork,
      );
      assert.deepEqual(urls, [
        'https://example.com/cards/1',
        'https://example.com/cards/2',
      ]);
    });

    test('extracts the URL from an inline ref with a size spec', function (assert) {
      let markdown =
        'See :card[https://example.com/cards/1 | embedded] for details.';
      let urls = extractCardReferenceUrls(
        markdown,
        'https://base.com/',
        virtualNetwork,
      );
      assert.deepEqual(
        urls,
        ['https://example.com/cards/1'],
        'the specifier is stripped from the extracted URL',
      );
    });

    test('resolves relative URLs against base', function (assert) {
      let markdown = ':card[./my-card]';
      let urls = extractCardReferenceUrls(
        markdown,
        'https://realm.example/docs/file.md',
        virtualNetwork,
      );
      assert.deepEqual(urls, ['https://realm.example/docs/my-card']);
    });

    test('strips .json extension from extracted URLs', function (assert) {
      let markdown = [
        ':card[https://example.com/cards/1.json]',
        '',
        '::card[https://example.com/cards/2.json]',
      ].join('\n');
      let urls = extractCardReferenceUrls(
        markdown,
        'https://base.com/',
        virtualNetwork,
      );
      assert.deepEqual(urls, [
        'https://example.com/cards/1',
        'https://example.com/cards/2',
      ]);
    });

    test('deduplicates URLs that differ only by .json extension', function (assert) {
      let markdown = [
        ':card[https://example.com/cards/1]',
        ':card[https://example.com/cards/1.json]',
      ].join('\n');
      let urls = extractCardReferenceUrls(
        markdown,
        'https://base.com/',
        virtualNetwork,
      );
      assert.deepEqual(urls, ['https://example.com/cards/1']);
    });

    test('deduplicates URLs', function (assert) {
      let markdown = [
        ':card[https://example.com/cards/1]',
        ':card[https://example.com/cards/1]',
      ].join('\n');
      let urls = extractCardReferenceUrls(
        markdown,
        'https://base.com/',
        virtualNetwork,
      );
      assert.deepEqual(urls, ['https://example.com/cards/1']);
    });

    test('ignores references inside fenced code blocks', function (assert) {
      let markdown = ['```', ':card[https://example.com/cards/1]', '```'].join(
        '\n',
      );
      let urls = extractCardReferenceUrls(
        markdown,
        'https://base.com/',
        virtualNetwork,
      );
      assert.deepEqual(urls, []);
    });

    test('ignores references inside inline code', function (assert) {
      let markdown = 'Use `:card[url]` syntax.';
      let urls = extractCardReferenceUrls(
        markdown,
        'https://base.com/',
        virtualNetwork,
      );
      assert.deepEqual(urls, []);
    });

    test('ignores references inside multi-backtick inline code', function (assert) {
      let markdown = 'Use ``:card[https://example.com/cards/1]`` syntax.';
      let urls = extractCardReferenceUrls(
        markdown,
        'https://base.com/',
        virtualNetwork,
      );
      assert.deepEqual(urls, []);
    });

    test('skips malformed URLs with empty base', function (assert) {
      let markdown = ':card[not a valid url at all]';
      let urls = extractCardReferenceUrls(markdown, '', virtualNetwork);
      assert.deepEqual(urls, []);
    });

    test('returns empty array for markdown without references', function (assert) {
      let markdown = '# Hello World\n\nNo card references here.';
      let urls = extractCardReferenceUrls(
        markdown,
        'https://base.com/',
        virtualNetwork,
      );
      assert.deepEqual(urls, []);
    });

    test('returns empty array for empty markdown', function (assert) {
      let urls = extractCardReferenceUrls(
        '',
        'https://base.com/',
        virtualNetwork,
      );
      assert.deepEqual(urls, []);
    });
  });

  module('extractFileReferenceUrls', function () {
    test('extracts only file references, ignoring card references', function (assert) {
      let markdown = [
        ':card[https://example.com/cards/1]',
        ':file[https://example.com/files/1.pdf]',
        '::file[https://example.com/files/2.pdf]',
      ].join('\n');
      let urls = extractFileReferenceUrls(
        markdown,
        'https://base.com/',
        virtualNetwork,
      );
      assert.deepEqual(urls, [
        'https://example.com/files/1.pdf',
        'https://example.com/files/2.pdf',
      ]);
    });

    test('resolves relative file URLs against base', function (assert) {
      let markdown = ':file[./docs/report.pdf]';
      let urls = extractFileReferenceUrls(
        markdown,
        'https://realm.example/notes/file.md',
        virtualNetwork,
      );
      assert.deepEqual(urls, ['https://realm.example/notes/docs/report.pdf']);
    });

    test('returns empty array when there are no file references', function (assert) {
      let markdown = ':card[https://example.com/cards/1]';
      let urls = extractFileReferenceUrls(
        markdown,
        'https://base.com/',
        virtualNetwork,
      );
      assert.deepEqual(urls, []);
    });
  });

  module('extractBfmReferences', function () {
    test('extracts references for multiple keywords', function (assert) {
      let markdown = [
        ':card[https://example.com/cards/1]',
        ':file[https://example.com/files/1]',
      ].join('\n');
      let refs = extractBfmReferences(
        markdown,
        'https://base.com/',
        ['card', 'file'],
        virtualNetwork,
      );
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
      let refs = extractBfmReferences(
        markdown,
        'https://base.com/',
        ['card', 'file'],
        virtualNetwork,
      );
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

  module('markdownToHtml with BFM file syntax', function () {
    test('inline file ref produces span placeholder with bfm attributes', function (assert) {
      let markdown = 'See :file[https://example.com/files/1.pdf] here.';
      let html = markdownToHtml(markdown);
      assert.true(
        html.includes(
          'data-boxel-bfm-inline-ref="https://example.com/files/1.pdf"',
        ),
        'inline placeholder has ref data attribute',
      );
      assert.true(
        html.includes('data-boxel-bfm-type="file"'),
        'inline placeholder has file type data attribute',
      );
      assert.true(
        html.includes('<span data-boxel-bfm-inline-ref='),
        'inline placeholder is a span element',
      );
    });

    test('block file ref produces div placeholder with bfm attributes', function (assert) {
      let markdown = '::file[https://example.com/files/1.pdf]\n';
      let html = markdownToHtml(markdown);
      assert.true(
        html.includes(
          'data-boxel-bfm-block-ref="https://example.com/files/1.pdf"',
        ),
        'block placeholder has ref data attribute',
      );
      assert.true(
        html.includes('data-boxel-bfm-type="file"'),
        'block placeholder has file type data attribute',
      );
      assert.true(
        html.includes('<div data-boxel-bfm-block-ref='),
        'block placeholder is a div element',
      );
    });

    test('file refs inside code blocks are not processed', function (assert) {
      let markdown = ['```', ':file[https://example.com/files/1]', '```'].join(
        '\n',
      );
      let html = markdownToHtml(markdown);
      assert.false(
        html.includes('data-boxel-bfm-inline-ref'),
        'no file ref placeholder inside code block',
      );
    });

    test('card and file refs coexist in a document', function (assert) {
      let markdown = [
        'Card :card[https://example.com/cards/1] and file',
        ':file[https://example.com/files/1.pdf].',
      ].join('\n');
      let html = markdownToHtml(markdown);
      assert.true(
        html.includes('data-boxel-bfm-type="card"'),
        'card placeholder present',
      );
      assert.true(
        html.includes('data-boxel-bfm-type="file"'),
        'file placeholder present',
      );
    });

    test('block file ref with size spec emits format and dimension attributes', function (assert) {
      let markdown = '::file[https://example.com/images/photo.png | 400x200]\n';
      let html = markdownToHtml(markdown);
      assert.true(
        html.includes(
          'data-boxel-bfm-block-ref="https://example.com/images/photo.png"',
        ),
        'URL excludes the pipe and specifier',
      );
      assert.true(
        html.includes('data-boxel-bfm-format="fitted"'),
        'file block ref honors fitted format',
      );
      assert.true(html.includes('data-boxel-bfm-width="400"'), 'width=400');
      assert.true(html.includes('data-boxel-bfm-height="200"'), 'height=200');
    });

    test('block file ref with named size constant emits dimension attributes', function (assert) {
      let markdown = '::file[https://example.com/images/photo.png | strip]\n';
      let html = markdownToHtml(markdown);
      assert.true(
        html.includes('data-boxel-bfm-format="fitted"'),
        'has fitted format',
      );
      assert.true(
        html.includes('data-boxel-bfm-width="250"'),
        'width from strip constant',
      );
      assert.true(
        html.includes('data-boxel-bfm-height="40"'),
        'height from strip constant',
      );
    });

    test('DOMPurify preserves file BFM placeholders', function (assert) {
      let markdown =
        'Text :file[https://example.com/files/1.pdf] and more.\n\n::file[https://example.com/files/2.pdf]\n';
      let html = markdownToHtml(markdown, { sanitize: true });
      assert.true(
        html.includes(
          'data-boxel-bfm-inline-ref="https://example.com/files/1.pdf"',
        ),
        'inline file ref survives sanitization',
      );
      assert.true(
        html.includes(
          'data-boxel-bfm-block-ref="https://example.com/files/2.pdf"',
        ),
        'block file ref survives sanitization',
      );
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

    test('DOMPurify preserves BFM size data attributes', function (assert) {
      let markdown = '::card[https://example.com/cards/1 | strip]\n';
      let html = markdownToHtml(markdown, { sanitize: true });
      assert.true(
        html.includes('data-boxel-bfm-format="fitted"'),
        'format attribute survives sanitization',
      );
      assert.true(
        html.includes('data-boxel-bfm-width="250"'),
        'width attribute survives sanitization',
      );
      assert.true(
        html.includes('data-boxel-bfm-height="40"'),
        'height attribute survives sanitization',
      );
    });

    test('markdown without card refs is unaffected', function (assert) {
      let markdown = '# Hello\n\nSome **bold** text.';
      let withBfm = markdownToHtml(markdown);
      assert.true(withBfm.includes('<h1 id="user-content-hello">Hello</h1>'));
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
        html.includes('<h1 id="user-content-title">Title</h1>'),
        'heading preserved with id',
      );
    });

    test('block ref with named size constant emits format and dimension attributes', function (assert) {
      let markdown = '::card[https://example.com/cards/1 | strip]\n';
      let html = markdownToHtml(markdown);
      assert.true(
        html.includes('data-boxel-bfm-block-ref="https://example.com/cards/1"'),
        'URL excludes the pipe and specifier',
      );
      assert.true(
        html.includes('data-boxel-bfm-format="fitted"'),
        'has fitted format attribute',
      );
      assert.true(
        html.includes('data-boxel-bfm-width="250"'),
        'has width from strip constant',
      );
      assert.true(
        html.includes('data-boxel-bfm-height="40"'),
        'has height from strip constant',
      );
    });

    test('block ref with WxH custom dimensions', function (assert) {
      let markdown = '::card[https://example.com/cards/1 | 400x200]\n';
      let html = markdownToHtml(markdown);
      assert.true(
        html.includes('data-boxel-bfm-format="fitted"'),
        'has fitted format',
      );
      assert.true(html.includes('data-boxel-bfm-width="400"'), 'width=400');
      assert.true(html.includes('data-boxel-bfm-height="200"'), 'height=200');
    });

    test('block ref with w:N h:N custom dimensions', function (assert) {
      let markdown = '::card[https://example.com/cards/1 | w:400 h:200]\n';
      let html = markdownToHtml(markdown);
      assert.true(
        html.includes('data-boxel-bfm-format="fitted"'),
        'has fitted format',
      );
      assert.true(html.includes('data-boxel-bfm-width="400"'), 'width=400');
      assert.true(html.includes('data-boxel-bfm-height="200"'), 'height=200');
    });

    test('block ref with h:N only (width fills container)', function (assert) {
      let markdown = '::card[https://example.com/cards/1 | h:300]\n';
      let html = markdownToHtml(markdown);
      assert.true(
        html.includes('data-boxel-bfm-format="fitted"'),
        'has fitted format',
      );
      assert.false(
        html.includes('data-boxel-bfm-width'),
        'no width attribute (fills container)',
      );
      assert.true(html.includes('data-boxel-bfm-height="300"'), 'height=300');
    });

    test('block ref with w:N% percentage width', function (assert) {
      let markdown = '::card[https://example.com/cards/1 | w:50%]\n';
      let html = markdownToHtml(markdown);
      assert.true(
        html.includes('data-boxel-bfm-format="fitted"'),
        'has fitted format',
      );
      assert.true(html.includes('data-boxel-bfm-width="50%"'), 'width=50%');
      assert.false(
        html.includes('data-boxel-bfm-height'),
        'no height attribute (auto height)',
      );
    });

    test('block ref with isolated format', function (assert) {
      let markdown = '::card[https://example.com/cards/1 | isolated]\n';
      let html = markdownToHtml(markdown);
      assert.true(
        html.includes('data-boxel-bfm-format="isolated"'),
        'has isolated format',
      );
      assert.false(
        html.includes('data-boxel-bfm-width'),
        'no width for isolated',
      );
      assert.false(
        html.includes('data-boxel-bfm-height'),
        'no height for isolated',
      );
    });

    test('block ref with embedded format', function (assert) {
      let markdown = '::card[https://example.com/cards/1 | embedded]\n';
      let html = markdownToHtml(markdown);
      assert.true(
        html.includes('data-boxel-bfm-format="embedded"'),
        'has embedded format',
      );
      assert.false(
        html.includes('data-boxel-bfm-width'),
        'no width for embedded',
      );
      assert.false(
        html.includes('data-boxel-bfm-height'),
        'no height for embedded',
      );
    });

    test('block ref with bare fitted format (no size override)', function (assert) {
      let markdown = '::card[https://example.com/cards/1 | fitted]\n';
      let html = markdownToHtml(markdown);
      assert.true(
        html.includes('data-boxel-bfm-format="fitted"'),
        'has fitted format',
      );
      assert.false(
        html.includes('data-boxel-bfm-width'),
        'no width when no size override',
      );
      assert.false(
        html.includes('data-boxel-bfm-height'),
        'no height when no size override',
      );
    });

    test('block ref with "fitted <named>" prefix', function (assert) {
      let markdown = '::card[https://example.com/cards/1 | fitted strip]\n';
      let html = markdownToHtml(markdown);
      assert.true(
        html.includes('data-boxel-bfm-format="fitted"'),
        'has fitted format',
      );
      assert.true(
        html.includes('data-boxel-bfm-width="250"'),
        'width from strip constant',
      );
      assert.true(
        html.includes('data-boxel-bfm-height="40"'),
        'height from strip constant',
      );
    });

    test('block ref with "fitted <WxH>" prefix', function (assert) {
      let markdown = '::card[https://example.com/cards/1 | fitted 400x200]\n';
      let html = markdownToHtml(markdown);
      assert.true(
        html.includes('data-boxel-bfm-format="fitted"'),
        'has fitted format',
      );
      assert.true(html.includes('data-boxel-bfm-width="400"'), 'width=400');
      assert.true(html.includes('data-boxel-bfm-height="200"'), 'height=200');
    });

    test('block ref without pipe has no format/size attributes', function (assert) {
      let markdown = '::card[https://example.com/cards/1]\n';
      let html = markdownToHtml(markdown);
      assert.false(
        html.includes('data-boxel-bfm-format'),
        'no format attribute for plain block ref',
      );
      assert.false(
        html.includes('data-boxel-bfm-width'),
        'no width attribute for plain block ref',
      );
    });

    test('block ref with unrecognized specifier emits no format attributes', function (assert) {
      let markdown = '::card[https://example.com/cards/1 | nonsense]\n';
      let html = markdownToHtml(markdown);
      assert.true(
        html.includes('data-boxel-bfm-block-ref="https://example.com/cards/1"'),
        'URL is still parsed correctly',
      );
      assert.false(
        html.includes('data-boxel-bfm-format'),
        'no format for unrecognized specifier',
      );
    });

    test('block ref with atom format emits an atom format attribute', function (assert) {
      let markdown = '::card[https://example.com/cards/1 | atom]\n';
      let html = markdownToHtml(markdown);
      assert.true(
        html.includes('data-boxel-bfm-block-ref="https://example.com/cards/1"'),
        'URL excludes the pipe and specifier',
      );
      assert.true(
        html.includes('data-boxel-bfm-format="atom"'),
        'has atom format attribute',
      );
      assert.false(
        html.includes('data-boxel-bfm-width'),
        'atom carries no width',
      );
    });

    test('inline ref with a size spec emits format and dimension attributes', function (assert) {
      let markdown = 'See :card[https://example.com/cards/1 | 400x200] here.';
      let html = markdownToHtml(markdown);
      assert.true(
        html.includes(
          'data-boxel-bfm-inline-ref="https://example.com/cards/1"',
        ),
        'URL excludes the pipe and specifier',
      );
      assert.true(
        html.includes('data-boxel-bfm-format="fitted"'),
        'has fitted format attribute',
      );
      assert.true(html.includes('data-boxel-bfm-width="400"'), 'width=400');
      assert.true(html.includes('data-boxel-bfm-height="200"'), 'height=200');
    });

    test('inline ref with embedded format emits the format attribute', function (assert) {
      let markdown = 'See :card[https://example.com/cards/1 | embedded] here.';
      let html = markdownToHtml(markdown);
      assert.true(
        html.includes('data-boxel-bfm-format="embedded"'),
        'has embedded format attribute',
      );
      assert.false(
        html.includes('data-boxel-bfm-width'),
        'embedded carries no width',
      );
    });

    test('inline ref without pipe has no format/size attributes', function (assert) {
      let markdown = 'See :card[https://example.com/cards/1] here.';
      let html = markdownToHtml(markdown);
      assert.true(
        html.includes(
          'data-boxel-bfm-inline-ref="https://example.com/cards/1"',
        ),
        'inline placeholder still has the ref attribute',
      );
      assert.false(
        html.includes('data-boxel-bfm-format'),
        'no format attribute for plain inline ref',
      );
    });

    test('inline ref with unrecognized specifier emits no format attributes', function (assert) {
      let markdown = 'See :card[https://example.com/cards/1 | nonsense] here.';
      let html = markdownToHtml(markdown);
      assert.true(
        html.includes(
          'data-boxel-bfm-inline-ref="https://example.com/cards/1"',
        ),
        'URL excludes the pipe and specifier',
      );
      assert.false(
        html.includes('data-boxel-bfm-format'),
        'no format for unrecognized specifier',
      );
    });
  });

  module('parseBfmSizeSpec', function () {
    test('returns null for unrecognized specifiers', function (assert) {
      assert.strictEqual(parseBfmSizeSpec('nonsense'), null);
      assert.strictEqual(parseBfmSizeSpec(''), null);
    });

    test('parses atom keyword', function (assert) {
      let result = parseBfmSizeSpec('atom');
      assert.deepEqual(result, { format: 'atom' });
    });

    test('parses atom keyword case-insensitively', function (assert) {
      let result = parseBfmSizeSpec('Atom');
      assert.deepEqual(result, { format: 'atom' });
    });

    test('parses isolated keyword', function (assert) {
      let result = parseBfmSizeSpec('isolated');
      assert.deepEqual(result, { format: 'isolated' });
    });

    test('parses isolated keyword case-insensitively', function (assert) {
      let result = parseBfmSizeSpec('Isolated');
      assert.deepEqual(result, { format: 'isolated' });
    });

    test('parses embedded keyword', function (assert) {
      let result = parseBfmSizeSpec('embedded');
      assert.deepEqual(result, { format: 'embedded' });
    });

    test('parses embedded keyword case-insensitively', function (assert) {
      let result = parseBfmSizeSpec('Embedded');
      assert.deepEqual(result, { format: 'embedded' });
    });

    test('parses bare fitted keyword with no size', function (assert) {
      let result = parseBfmSizeSpec('fitted');
      assert.deepEqual(result, { format: 'fitted' });
    });

    test('parses bare fitted keyword case-insensitively', function (assert) {
      let result = parseBfmSizeSpec('Fitted');
      assert.deepEqual(result, { format: 'fitted' });
    });

    test('parses fitted prefix with named constant', function (assert) {
      let result = parseBfmSizeSpec('fitted strip');
      assert.deepEqual(result, { format: 'fitted', width: 250, height: 40 });
    });

    test('parses fitted prefix with canonical named constant', function (assert) {
      let result = parseBfmSizeSpec('fitted compact-card');
      assert.deepEqual(result, { format: 'fitted', width: 400, height: 170 });
    });

    test('parses fitted prefix with WxH', function (assert) {
      let result = parseBfmSizeSpec('fitted 400x200');
      assert.deepEqual(result, { format: 'fitted', width: 400, height: 200 });
    });

    test('parses fitted prefix with WxH with spaces', function (assert) {
      let result = parseBfmSizeSpec('fitted 400 x 200');
      assert.deepEqual(result, { format: 'fitted', width: 400, height: 200 });
    });

    test('parses fitted prefix case-insensitively', function (assert) {
      let result = parseBfmSizeSpec('Fitted Strip');
      assert.deepEqual(result, { format: 'fitted', width: 250, height: 40 });
    });

    // Named size constants — Badges
    test('parses small-badge', function (assert) {
      let result = parseBfmSizeSpec('small-badge');
      assert.deepEqual(result, { format: 'fitted', width: 150, height: 40 });
    });

    test('parses medium-badge', function (assert) {
      let result = parseBfmSizeSpec('medium-badge');
      assert.deepEqual(result, { format: 'fitted', width: 150, height: 65 });
    });

    test('parses large-badge', function (assert) {
      let result = parseBfmSizeSpec('large-badge');
      assert.deepEqual(result, { format: 'fitted', width: 150, height: 105 });
    });

    // Named size constants — Strips (both canonical and alias)
    test('parses strip (alias for single-strip)', function (assert) {
      let result = parseBfmSizeSpec('strip');
      assert.deepEqual(result, { format: 'fitted', width: 250, height: 40 });
    });

    test('parses single-strip (canonical)', function (assert) {
      let result = parseBfmSizeSpec('single-strip');
      assert.deepEqual(result, { format: 'fitted', width: 250, height: 40 });
    });

    test('parses double-strip', function (assert) {
      let result = parseBfmSizeSpec('double-strip');
      assert.deepEqual(result, { format: 'fitted', width: 250, height: 65 });
    });

    test('parses triple-strip', function (assert) {
      let result = parseBfmSizeSpec('triple-strip');
      assert.deepEqual(result, { format: 'fitted', width: 250, height: 105 });
    });

    test('parses double-wide-strip', function (assert) {
      let result = parseBfmSizeSpec('double-wide-strip');
      assert.deepEqual(result, { format: 'fitted', width: 400, height: 65 });
    });

    test('parses triple-wide-strip', function (assert) {
      let result = parseBfmSizeSpec('triple-wide-strip');
      assert.deepEqual(result, { format: 'fitted', width: 400, height: 105 });
    });

    // Named size constants — Tiles (both canonical and alias)
    test('parses tile (alias for regular-tile)', function (assert) {
      let result = parseBfmSizeSpec('tile');
      assert.deepEqual(result, { format: 'fitted', width: 250, height: 170 });
    });

    test('parses regular-tile (canonical)', function (assert) {
      let result = parseBfmSizeSpec('regular-tile');
      assert.deepEqual(result, { format: 'fitted', width: 250, height: 170 });
    });

    test('parses grid-tile (alias for cardsgrid-tile)', function (assert) {
      let result = parseBfmSizeSpec('grid-tile');
      assert.deepEqual(result, { format: 'fitted', width: 170, height: 250 });
    });

    test('parses small-tile', function (assert) {
      let result = parseBfmSizeSpec('small-tile');
      assert.deepEqual(result, { format: 'fitted', width: 150, height: 170 });
    });

    test('parses tall-tile', function (assert) {
      let result = parseBfmSizeSpec('tall-tile');
      assert.deepEqual(result, { format: 'fitted', width: 150, height: 275 });
    });

    test('parses large-tile', function (assert) {
      let result = parseBfmSizeSpec('large-tile');
      assert.deepEqual(result, { format: 'fitted', width: 250, height: 275 });
    });

    // Named size constants — Cards
    test('parses compact-card', function (assert) {
      let result = parseBfmSizeSpec('compact-card');
      assert.deepEqual(result, { format: 'fitted', width: 400, height: 170 });
    });

    test('parses full-card', function (assert) {
      let result = parseBfmSizeSpec('full-card');
      assert.deepEqual(result, { format: 'fitted', width: 400, height: 275 });
    });

    test('parses expanded-card', function (assert) {
      let result = parseBfmSizeSpec('expanded-card');
      assert.deepEqual(result, { format: 'fitted', width: 400, height: 445 });
    });

    // Custom dimensions
    test('parses WxH syntax', function (assert) {
      let result = parseBfmSizeSpec('400x200');
      assert.deepEqual(result, { format: 'fitted', width: 400, height: 200 });
    });

    test('parses WxH with spaces', function (assert) {
      let result = parseBfmSizeSpec('400 x 200');
      assert.deepEqual(result, { format: 'fitted', width: 400, height: 200 });
    });

    test('parses w:N h:N syntax', function (assert) {
      let result = parseBfmSizeSpec('w:400 h:200');
      assert.deepEqual(result, { format: 'fitted', width: 400, height: 200 });
    });

    test('parses h:N only', function (assert) {
      let result = parseBfmSizeSpec('h:300');
      assert.deepEqual(result, { format: 'fitted', height: 300 });
    });

    test('parses w:N% percentage width', function (assert) {
      let result = parseBfmSizeSpec('w:50%');
      assert.deepEqual(result, { format: 'fitted', width: '50%' });
    });

    test('named constants are case-insensitive', function (assert) {
      let result = parseBfmSizeSpec('Strip');
      assert.deepEqual(result, { format: 'fitted', width: 250, height: 40 });
    });
  });

  module('extractCardReferenceUrls with pipe syntax', function () {
    test('extracts URL from block ref with size specifier', function (assert) {
      let markdown = '::card[https://example.com/cards/1 | strip]\n';
      let urls = extractCardReferenceUrls(
        markdown,
        'https://base.com/',
        virtualNetwork,
      );
      assert.deepEqual(urls, ['https://example.com/cards/1']);
    });

    test('extracts URL from block ref with custom dimensions', function (assert) {
      let markdown = '::card[https://example.com/cards/1 | 400x200]\n';
      let urls = extractCardReferenceUrls(
        markdown,
        'https://base.com/',
        virtualNetwork,
      );
      assert.deepEqual(urls, ['https://example.com/cards/1']);
    });

    test('extracts URL from block ref with isolated', function (assert) {
      let markdown = '::card[https://example.com/cards/1 | isolated]\n';
      let urls = extractCardReferenceUrls(
        markdown,
        'https://base.com/',
        virtualNetwork,
      );
      assert.deepEqual(urls, ['https://example.com/cards/1']);
    });

    test('resolves relative URL with size specifier', function (assert) {
      let markdown = '::card[./my-card | tile]\n';
      let urls = extractCardReferenceUrls(
        markdown,
        'https://realm.example/docs/file.md',
        virtualNetwork,
      );
      assert.deepEqual(urls, ['https://realm.example/docs/my-card']);
    });

    test('deduplicates same URL with different specifiers', function (assert) {
      let markdown = [
        '::card[https://example.com/cards/1 | strip]',
        '::card[https://example.com/cards/1 | tile]',
      ].join('\n');
      let urls = extractCardReferenceUrls(
        markdown,
        'https://base.com/',
        virtualNetwork,
      );
      assert.deepEqual(urls, ['https://example.com/cards/1']);
    });
  });

  module('bfmRefFormatAndSize', function () {
    test('defaults to embedded with no sizeStyle when format attr is missing', function (assert) {
      assert.deepEqual(bfmRefFormatAndSize(undefined, undefined, undefined), {
        format: 'embedded',
      });
    });

    test('honors an explicit defaultFormat when the format attr is missing', function (assert) {
      assert.deepEqual(
        bfmRefFormatAndSize(undefined, undefined, undefined, 'atom'),
        { format: 'atom' },
      );
    });

    test('defaults to embedded when format attr is unrecognized', function (assert) {
      assert.deepEqual(bfmRefFormatAndSize('something', '400', '200'), {
        format: 'embedded',
      });
    });

    test('falls back to the supplied defaultFormat when format attr is unrecognized', function (assert) {
      assert.deepEqual(
        bfmRefFormatAndSize('something', undefined, undefined, 'atom'),
        {
          format: 'atom',
        },
      );
    });

    test('passes atom through and ignores width/height', function (assert) {
      assert.deepEqual(bfmRefFormatAndSize('atom', '400', '200'), {
        format: 'atom',
      });
    });

    test('passes isolated through and ignores width/height', function (assert) {
      assert.deepEqual(bfmRefFormatAndSize('isolated', '400', '200'), {
        format: 'isolated',
      });
    });

    test('fitted with no width/height returns undefined sizeStyle', function (assert) {
      assert.deepEqual(bfmRefFormatAndSize('fitted', undefined, undefined), {
        format: 'fitted',
        sizeStyle: undefined,
      });
    });

    test('fitted converts integer width attr to a px value', function (assert) {
      assert.deepEqual(bfmRefFormatAndSize('fitted', '400', undefined), {
        format: 'fitted',
        sizeStyle: 'width: 400px',
      });
    });

    test('fitted passes percentage width attr through unchanged', function (assert) {
      assert.deepEqual(bfmRefFormatAndSize('fitted', '50%', undefined), {
        format: 'fitted',
        sizeStyle: 'width: 50%',
      });
    });

    test('fitted converts integer height attr to a px value', function (assert) {
      assert.deepEqual(bfmRefFormatAndSize('fitted', undefined, '200'), {
        format: 'fitted',
        sizeStyle: 'height: 200px',
      });
    });

    test('fitted combines width + height into one sizeStyle string', function (assert) {
      assert.deepEqual(bfmRefFormatAndSize('fitted', '400', '200'), {
        format: 'fitted',
        sizeStyle: 'width: 400px; height: 200px',
      });
    });

    test('fitted ignores width with unsupported units', function (assert) {
      // Only `\d+` (px implied) and `\d+%` are accepted; anything else is dropped.
      assert.deepEqual(bfmRefFormatAndSize('fitted', '100em', '200'), {
        format: 'fitted',
        sizeStyle: 'height: 200px',
      });
    });

    test('fitted ignores height with unsupported units', function (assert) {
      assert.deepEqual(bfmRefFormatAndSize('fitted', '400', '50%'), {
        format: 'fitted',
        sizeStyle: 'width: 400px',
      });
    });
  });

  module('serializeBfmSizeSpec', function () {
    test('atom / isolated / embedded round-trip to their keyword', function (assert) {
      assert.strictEqual(serializeBfmSizeSpec({ format: 'atom' }), 'atom');
      assert.strictEqual(
        serializeBfmSizeSpec({ format: 'isolated' }),
        'isolated',
      );
      assert.strictEqual(
        serializeBfmSizeSpec({ format: 'embedded' }),
        'embedded',
      );
    });

    test('bare fitted with no dimensions serializes to `fitted`', function (assert) {
      assert.strictEqual(serializeBfmSizeSpec({ format: 'fitted' }), 'fitted');
    });

    test('fitted dimensions serialize to the explicit-key form', function (assert) {
      assert.strictEqual(
        serializeBfmSizeSpec({ format: 'fitted', width: 300, height: 200 }),
        'w:300 h:200',
      );
    });

    test('percentage width is preserved', function (assert) {
      assert.strictEqual(
        serializeBfmSizeSpec({ format: 'fitted', width: '50%', height: 200 }),
        'w:50% h:200',
      );
    });

    test('a single dimension serializes on its own', function (assert) {
      assert.strictEqual(
        serializeBfmSizeSpec({ format: 'fitted', height: 300 }),
        'h:300',
      );
    });

    test('round-trips through parseBfmSizeSpec for atom, isolated, embedded, dims, and %', function (assert) {
      let specs: BfmSizeSpec[] = [
        { format: 'atom' },
        { format: 'isolated' },
        { format: 'embedded' },
        { format: 'fitted', width: 300, height: 200 },
        { format: 'fitted', width: '50%', height: 120 },
        { format: 'fitted', height: 300 },
      ];
      for (let spec of specs) {
        assert.deepEqual(
          parseBfmSizeSpec(serializeBfmSizeSpec(spec)),
          spec,
          `round-trips ${JSON.stringify(spec)}`,
        );
      }
    });

    test('every named fitted id round-trips dimensionally', function (assert) {
      for (let id of fittedFormatIds) {
        let parsed = parseBfmSizeSpec(id)!;
        // The serializer emits `w:N h:N`, which re-parses to the same spec —
        // the named identity is intentionally not reconstructed.
        assert.deepEqual(
          parseBfmSizeSpec(serializeBfmSizeSpec(parsed)),
          parsed,
          `${id} round-trips dimensionally`,
        );
      }
    });
  });

  module('serializeBfmRef', function () {
    let url = 'https://example.com/Author/jane';

    test('inline with no size emits the bare single-colon form', function (assert) {
      assert.strictEqual(
        serializeBfmRef('card', url, { kind: 'inline' }),
        `:card[${url}]`,
      );
    });

    test('inline with a size appends the specifier', function (assert) {
      assert.strictEqual(
        serializeBfmRef('card', url, { kind: 'inline', size: 'tall-tile' }),
        `:card[${url} | tall-tile]`,
      );
    });

    test('block with no size emits the bare double-colon form', function (assert) {
      assert.strictEqual(
        serializeBfmRef('card', url, { kind: 'block' }),
        `::card[${url}]`,
      );
    });

    test('block with a size appends the specifier', function (assert) {
      assert.strictEqual(
        serializeBfmRef('card', url, { kind: 'block', size: 'tall-tile' }),
        `::card[${url} | tall-tile]`,
      );
      assert.strictEqual(
        serializeBfmRef('card', url, { kind: 'block', size: 'w:300 h:200' }),
        `::card[${url} | w:300 h:200]`,
      );
    });

    test('defaults to block', function (assert) {
      assert.strictEqual(serializeBfmRef('card', url), `::card[${url}]`);
    });

    test('honors the refType keyword (file)', function (assert) {
      assert.strictEqual(
        serializeBfmRef('file', url, { kind: 'inline' }),
        `:file[${url}]`,
      );
      assert.strictEqual(
        serializeBfmRef('file', url, { kind: 'block', size: 'embedded' }),
        `::file[${url} | embedded]`,
      );
    });

    test('returns empty string for a missing url', function (assert) {
      assert.strictEqual(serializeBfmRef('card', undefined), '');
      assert.strictEqual(serializeBfmRef('card', ''), '');
    });
  });

  module('extractBfmRefRanges', function () {
    test('returns source-byte ranges for inline and block refs', function (assert) {
      let markdown = 'Inline :card[./mango] then\n::file[./photo.jpg]\n';
      let ranges = extractBfmRefRanges(markdown);
      assert.strictEqual(ranges.length, 2);

      let inline = ranges[0];
      assert.strictEqual(inline.kind, 'inline');
      assert.strictEqual(inline.refType, 'card');
      assert.strictEqual(inline.url, './mango');
      assert.strictEqual(
        markdown.slice(inline.from, inline.to),
        ':card[./mango]',
        'inline range round-trips through markdown.slice',
      );

      let block = ranges[1];
      assert.strictEqual(block.kind, 'block');
      assert.strictEqual(block.refType, 'file');
      assert.strictEqual(block.url, './photo.jpg');
      assert.strictEqual(
        markdown.slice(block.from, block.to),
        '::file[./photo.jpg]',
        'block range round-trips through markdown.slice',
      );
    });

    test('captures the size specifier when present', function (assert) {
      let markdown = '::card[./mango | tall-tile]';
      let [range] = extractBfmRefRanges(markdown);
      assert.strictEqual(range.url, './mango');
      assert.strictEqual(range.sizeSpec, 'tall-tile');
      assert.strictEqual(markdown.slice(range.from, range.to), markdown);
    });

    test('skips refs inside fenced and inline code', function (assert) {
      let markdown = [
        '```',
        '::card[./inside-fence]',
        '```',
        'See `:card[./inline-code]` and :card[./real] for real.',
      ].join('\n');
      let ranges = extractBfmRefRanges(markdown);
      assert.strictEqual(ranges.length, 1, 'only the un-coded ref is returned');
      assert.strictEqual(ranges[0].url, './real');
    });

    test('emits one range per site (no deduplication)', function (assert) {
      let markdown = ':card[./mango] then :card[./mango]';
      let ranges = extractBfmRefRanges(markdown);
      assert.strictEqual(ranges.length, 2, 'both sites are surfaced');
      assert.notStrictEqual(ranges[0].from, ranges[1].from);
    });

    test('sorts by document order', function (assert) {
      let markdown = '::card[./second]\n:card[./first]'.replace(
        '::card[./second]\n:card[./first]',
        ':card[./first] then ::card[./second]',
      );
      let ranges = extractBfmRefRanges(markdown);
      assert.deepEqual(
        ranges.map((r) => r.url),
        ['./first', './second'],
      );
    });
  });
});
