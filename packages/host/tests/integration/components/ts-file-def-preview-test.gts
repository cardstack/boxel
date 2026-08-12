import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm, type Loader } from '@cardstack/runtime-common';

import { setupBaseRealm } from '../../helpers/base-realm';
import { renderCard } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

import type * as GtsFileDefModule from '@cardstack/base/gts-file-def';
import type * as TsFileDefModule from '@cardstack/base/ts-file-def';

const TS_SOURCE = [
  '// greet returns a friendly message',
  'export function greet(name: string): string {',
  '  return `Hello, ${name}!`;',
  '}',
].join('\n');

const GTS_SOURCE = [
  "import Component from '@glimmer/component';",
  '',
  'export default class Greeting extends Component {',
  '  <template>',
  '    <h1>Hello</h1>',
  '  </template>',
  '}',
].join('\n');

// TsFileDef and GtsFileDef supply only a code `previewComponent`; the four
// shared shells own identity, facts, and state. These tests pin the two things
// unique to the code family: that the renderer mounts into every shell, and
// that it syntax-highlights the source (including GTS `<template>` tags).
module('Integration | ts/gts file def preview', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);

  let loader: Loader;
  let TsFileDef: typeof TsFileDefModule.TsFileDef;
  let GtsFileDef: typeof GtsFileDefModule.GtsFileDef;

  hooks.beforeEach(async function (this: RenderingTestContext) {
    loader = getService('loader-service').loader;
    TsFileDef = (
      await loader.import<typeof TsFileDefModule>(`${baseRealm.url}ts-file-def`)
    ).TsFileDef;
    GtsFileDef = (
      await loader.import<typeof GtsFileDefModule>(
        `${baseRealm.url}gts-file-def`,
      )
    ).GtsFileDef;
  });

  function tsFile() {
    return new TsFileDef({
      id: 'http://example.com/code/utils.ts',
      url: 'http://example.com/code/utils.ts',
      sourceUrl: 'http://example.com/code/utils.ts',
      name: 'utils.ts',
      contentType: 'text/typescript',
      content: TS_SOURCE,
    });
  }

  for (let format of ['isolated', 'embedded', 'fitted', 'atom'] as const) {
    test(`the code renderer mounts into the ${format} shell`, async function (assert) {
      await renderCard(loader, tsFile(), format);
      assert
        .dom(`[data-test-file-${format}]`)
        .exists(`${format} shell renders`);
      if (format === 'atom') {
        // Atom is an identity chip — a name and a glyph, no code body.
        assert.dom('[data-test-file-atom]').containsText('utils');
        assert.dom('[data-test-ts-preview]').doesNotExist();
      } else {
        assert.dom('[data-test-ts-preview]').exists('code preview mounts');
      }
    });
  }

  test('the isolated preview syntax-highlights the TypeScript source', async function (assert) {
    await renderCard(loader, tsFile(), 'isolated');
    assert.dom('[data-test-ts-preview]').exists();
    // `export`/`function`/`return` are keywords; the leading `//` line is a
    // comment; the backtick literal is a string.
    assert.dom('[data-test-ts-preview] .ts-keyword').exists('keywords marked');
    assert.dom('[data-test-ts-preview] .ts-comment').exists('comment marked');
    assert.dom('[data-test-ts-preview] .ts-string').exists('string marked');
    assert.dom('[data-test-ts-preview]').containsText('greet');
  });

  test('the fitted preview shows a highlighted head snippet, not the full file', async function (assert) {
    await renderCard(loader, tsFile(), 'fitted');
    assert.dom('[data-test-ts-preview][data-mode="fitted"]').exists();
    assert
      .dom('[data-test-ts-preview] .ts-keyword')
      .exists('snippet highlights');
  });

  test('GTS reuses the same code renderer and highlights its <template> tags', async function (assert) {
    let file = new GtsFileDef({
      id: 'http://example.com/code/greeting.gts',
      url: 'http://example.com/code/greeting.gts',
      sourceUrl: 'http://example.com/code/greeting.gts',
      name: 'greeting.gts',
      contentType: 'text/typescript+glimmer',
      content: GTS_SOURCE,
    });
    await renderCard(loader, file, 'isolated');
    assert.dom('[data-test-file-isolated]').exists();
    assert.dom('[data-test-ts-preview]').exists('GTS mounts the code preview');
    // The GTS-specific behavior is that the template tag itself is highlighted:
    // `highlightTs` marks `<template>`/`</template>` as keywords. A plain
    // `.ts-keyword` check would pass on `import`/`class` alone, so assert on a
    // keyword span whose text is exactly the tag — this fails if
    // `TEMPLATE_TAG_RE` ever stops firing.
    let keywords = Array.from(
      document.querySelectorAll('[data-test-ts-preview] .ts-keyword'),
    );
    assert.ok(
      keywords.some((el) => el.textContent === '<template>'),
      'the <template> tag itself is marked as a keyword',
    );
    assert.dom('[data-test-ts-preview]').containsText('Greeting');
  });

  // `lineCount` feeds the shell's "N lines" hero fact. It normalizes newline
  // variants (so a CRLF or classic-Mac CR file counts the same as LF) and drops
  // a single trailing newline. Exercise those branches directly rather than only
  // through the LF fixture, which reaches none of them.
  test('lineCount normalizes CRLF/CR and strips one trailing newline', async function (assert) {
    let lineCountOf = async (content: string) => {
      let result = await TsFileDef.extractAttributes(
        'http://example.com/code/newlines.ts',
        async () => new TextEncoder().encode(content),
      );
      return result.lineCount;
    };

    assert.strictEqual(await lineCountOf('a\r\nb\r\n'), 2, 'CRLF + trailing');
    assert.strictEqual(await lineCountOf('a\rb'), 2, 'classic-Mac lone CR');
    assert.strictEqual(await lineCountOf('a\nb\n'), 2, 'LF + trailing');
    assert.strictEqual(await lineCountOf(''), 0, 'empty content is zero lines');
  });
});
