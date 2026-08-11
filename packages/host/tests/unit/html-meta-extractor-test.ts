// Text-level tests for the HTML structure reader. It runs inside the index
// pass against whatever a realm holds, so the contract is as much about
// fragments and hostile markup as about well-formed documents: a titleless
// fragment must degrade to "no title" rather than invent one, and entity
// decoding must not become an HTML parse.

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm, type Loader } from '@cardstack/runtime-common';

import { setupRenderingTest } from '../helpers/setup';

import type * as HtmlModule from '@cardstack/base/html-meta-extractor';

module('Unit | html-meta-extractor', function (hooks) {
  setupRenderingTest(hooks);

  let loader: Loader;
  let extractHtmlMetadata: typeof HtmlModule.extractHtmlMetadata;
  let extractHtmlExcerpt: typeof HtmlModule.extractHtmlExcerpt;

  hooks.beforeEach(async function () {
    loader = getService('loader-service').loader;
    ({ extractHtmlMetadata, extractHtmlExcerpt } = await loader.import<
      typeof HtmlModule
    >(`${baseRealm.url}html-meta-extractor`));
  });

  test('decodes entities and strips markup from the title', function (assert) {
    let meta = extractHtmlMetadata(
      `<title>Fish &amp; Chips &#8212; <em>menu</em></title>`,
    );
    assert.strictEqual(meta.documentTitle, 'Fish & Chips — menu');
  });

  test('an out-of-range numeric entity stays as written rather than throwing', function (assert) {
    let meta = extractHtmlMetadata(
      `<title>bad &#9999999999; and &#x110000; but ok &#x1F600;</title>`,
    );
    assert.strictEqual(
      meta.documentTitle,
      'bad &#9999999999; and &#x110000; but ok 😀',
      'invalid references survive verbatim while valid ones decode',
    );
  });

  test('a titleless fragment yields no documentTitle rather than inventing one', function (assert) {
    let meta = extractHtmlMetadata(`<p>hello</p>`);
    assert.strictEqual(meta.documentTitle, undefined);
    assert.strictEqual(meta.elementCount, 1);
  });

  test('interactivity derives from scripts or form controls, not styling', function (assert) {
    let styledProse = extractHtmlMetadata(
      `<style>p { color: red; }</style><p>prose</p>`,
    );
    assert.false(styledProse.isInteractive, 'styling alone is static');
    assert.strictEqual(styledProse.styleSheetCount, 1);

    let form = extractHtmlMetadata(`<form><input></form>`);
    assert.true(form.isInteractive, 'a form control is interactive');
    assert.strictEqual(form.formControlCount, 1);

    let script = extractHtmlMetadata(`<script src="./app.js"></script>`);
    assert.true(script.isInteractive, 'a script is interactive');
    assert.false(
      script.hasInlineScript,
      'an external script is not an inline one',
    );
  });

  test('module scripts are distinguished from classic ones', function (assert) {
    let meta = extractHtmlMetadata(
      `<script type="module">import './x.js';</script>`,
    );
    assert.true(meta.hasModuleScript);
    assert.true(meta.hasInlineScript);
    assert.strictEqual(meta.scriptCount, 1);
  });

  test('stylesheets count both style blocks and stylesheet links', function (assert) {
    let meta = extractHtmlMetadata(
      `<link rel="stylesheet" href="a.css"><style>b{}</style><link rel="icon" href="i.png">`,
    );
    assert.strictEqual(meta.styleSheetCount, 2, 'the icon link is not a sheet');
  });

  test('the excerpt is visible prose with scripts and styles removed', function (assert) {
    let excerpt = extractHtmlExcerpt(
      `<style>p{}</style><script>var x;</script><h1>Depot</h1><p>Seven &quot;trucks&quot; left.</p>`,
      500,
    );
    assert.strictEqual(excerpt, 'Depot Seven "trucks" left.');
  });

  test('a long excerpt truncates with an ellipsis inside the budget', function (assert) {
    let excerpt = extractHtmlExcerpt(`<p>${'word '.repeat(200)}</p>`, 50);
    assert.strictEqual(excerpt.length, 50);
    assert.true(excerpt.endsWith('...'));
  });
});
