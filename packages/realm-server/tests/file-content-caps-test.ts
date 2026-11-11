import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import {
  baseRRI,
  type Query,
  type Realm,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';
import {
  setupPermissionedRealmCached,
  searchCardsForTest,
} from './helpers/index.ts';

// How much of a text file a file type keeps as `content` (base's
// file-content-cap.ts; docs/search.md, "What a file's `content` holds"): the
// first whole lines within 1 MiB for code, markdown, plain text and JSON, cut
// at a line break or, for one long line, at a character boundary; a CSV keeps
// its header and first 1,000 rows. `lineCount`, `rowCount` and `columns`
// still describe the whole file, and a filter on `content` finds nothing past
// the cap.

const CAP = 1024 * 1024;
const ref = (module: string, name: string): ResolvedCodeRef => ({
  module: baseRRI(module),
  name,
});
const MarkdownDef = ref('markdown-file-def', 'MarkdownDef');
const TextFileDef = ref('text-file-def', 'TextFileDef');

function lines(prefix: string, count: number) {
  return Array.from({ length: count }, (_, i) => `${prefix} ${i} lorem\n`);
}
// ~1.3 MB of markdown: a word near the start, another past the cap
const longMarkdown = [
  '# Long\n\nzebratoken opens the document.\n',
  ...lines('paragraph line', 60_000),
  'yaktoken closes it.\n',
].join('');
const longModule = [
  'export const answer = 42;\n',
  ...lines('// comment line', 60_000),
  'export const last = 1;\n',
].join('');
// one line of two-byte characters, longer than the cap
const oneLongLine = 'é'.repeat(700_000);
const csv = [
  'id,name,note\n',
  ...Array.from(
    { length: 2_500 },
    (_, i) => `${i},item ${i},"a note, with a comma"\n`,
  ),
].join('');

module(basename(import.meta.filename), function () {
  module('content caps', function (hooks) {
    let testRealm: Realm;
    let realmHref: string;

    setupPermissionedRealmCached(hooks, {
      realmURL: new URL('http://127.0.0.1:4444/caps/'),
      permissions: { '*': ['read', 'write'] },
      fileSystem: {
        'long.md': longMarkdown,
        'long.ts': longModule,
        'one-line.txt': oneLongLine,
        'table.csv': csv,
        'short.md': '# Short\n\nAll of it.\n',
      } as never,
      onRealmSetup(args: { testRealm: Realm }) {
        testRealm = args.testRealm;
        realmHref = new URL(testRealm.url).href;
      },
    });

    async function attributes(path: string) {
      let file = await testRealm.realmIndexQueryEngine.file(
        new URL(`${realmHref}${path}`),
      );
      return (file?.resource?.attributes ?? {}) as Record<string, any>;
    }
    async function paths(query: Query) {
      let { data } = await searchCardsForTest(
        testRealm.realmIndexQueryEngine,
        query,
      );
      return data.map((r) => r.id!.slice(realmHref.length)).sort();
    }

    test('markdown keeps its first whole lines within 1 MiB, and counts every line', async function (assert) {
      let { content, lineCount } = await attributes('long.md');
      let bytes = Buffer.byteLength(content);
      assert.true(bytes <= CAP, `content is ${bytes} bytes`);
      assert.true(bytes > CAP - 100, 'it fills the cap to the last line');
      assert.true(content.endsWith('\n'), 'it ends on a whole line');
      assert.true(
        longMarkdown.startsWith(content),
        'it is the head of the body',
      );
      assert.strictEqual(
        lineCount,
        longMarkdown.replace(/\n$/, '').split('\n').length,
        'lineCount counts the whole file',
      );
    });

    test('a filter on content finds nothing past the cap; matches reads the head', async function (assert) {
      assert.deepEqual(
        await paths({
          type: MarkdownDef,
          filter: { contains: { content: 'zebratoken' } },
        }),
        ['long.md'],
        'a word inside the cap',
      );
      assert.deepEqual(
        await paths({
          type: MarkdownDef,
          filter: { contains: { content: 'yaktoken' } },
        }),
        [],
        'a word past the cap is not there',
      );
      assert.deepEqual(
        await paths({ type: MarkdownDef, filter: { matches: 'zebratoken' } }),
        ['long.md'],
        'full-text matches finds a word in the head',
      );
    });

    test('code keeps its first whole lines within 1 MiB', async function (assert) {
      let { content, lineCount } = await attributes('long.ts');
      assert.true(Buffer.byteLength(content) <= CAP);
      assert.true(content.endsWith('\n'));
      assert.true(longModule.startsWith(content));
      assert.false(content.includes('export const last'), 'the tail is cut');
      assert.strictEqual(lineCount, 60_002, 'lineCount counts the whole file');
    });

    test('one line longer than the cap is cut at a character boundary', async function (assert) {
      let { content } = await attributes('one-line.txt');
      assert.false(content.includes('�'), 'no character is split');
      assert.strictEqual(content.length, CAP / 2, 'as many as fit');
      assert.deepEqual(
        await paths({
          type: TextFileDef,
          filter: { contains: { content: 'éé' } },
        }),
        ['one-line.txt'],
      );
    });

    test('a CSV keeps its header and first 1,000 rows; rowCount and columns describe the whole file', async function (assert) {
      let { content, rowCount, columns, columnCount } =
        await attributes('table.csv');
      let kept = content.replace(/\n$/, '').split('\n');
      assert.strictEqual(kept.length, 1_001, 'the header and 1,000 rows');
      assert.strictEqual(kept[1_000], '999,item 999,"a note, with a comma"');
      assert.strictEqual(rowCount, 2_500);
      assert.deepEqual(columns, ['id', 'name', 'note']);
      assert.strictEqual(columnCount, 3);
    });

    test('a file under the cap keeps all of it', async function (assert) {
      let { content } = await attributes('short.md');
      assert.strictEqual(content, '# Short\n\nAll of it.\n');
    });
  });
});
