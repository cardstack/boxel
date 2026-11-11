import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import {
  baseFileRef,
  baseRRI,
  FILE_PATTERN_FIELDS,
  type Query,
  type Realm,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';
import {
  setupPermissionedRealmCached,
  searchCardsForTest,
} from './helpers/index.ts';

// Path and name globs on files (docs/search.md, `pattern`; cookbook "Find
// source files by path"). Base's FileDef declares `url` and `name`
// `search: { patterns: true }`, so every file type is found by them, end to
// end through the real file indexer: `*` and `?` stay within one `/`
// segment, `**` crosses segments, ignoring case.

const ref = (module: string, name: string): ResolvedCodeRef => ({
  module: baseRRI(module),
  name,
});
const GtsFileDef = ref('gts-file-def', 'GtsFileDef');
const TsFileDef = ref('ts-file-def', 'TsFileDef');
const JsonFileDef = ref('json-file-def', 'JsonFileDef');
const TextFileDef = ref('text-file-def', 'TextFileDef');
const MarkdownDef = ref('markdown-file-def', 'MarkdownDef');

const gts = (name: string) => `
  import { CardDef } from "@cardstack/base/card-api";
  export class ${name} extends CardDef {
    static displayName = '${name}';
  }
`;

module(basename(import.meta.filename), function () {
  module('globs on a file path and name', function (hooks) {
    let testRealm: Realm;
    let realmHref: string;

    setupPermissionedRealmCached(hooks, {
      realmURL: new URL('http://127.0.0.1:4444/globs/'),
      permissions: { '*': ['read', 'write'] },
      fileSystem: {
        'components/hello-card.gts': gts('HelloCard'),
        'components/goodbye.gts': gts('Goodbye'),
        'components/deep/nested-card.gts': gts('NestedCard'),
        'app.gts': gts('App'),
        'lib/util.ts': 'export const answer = 42;\n',
        'lib/deep/more.ts': 'export const more = 1;\n',
        'data/config.json': '{ "theme": "dark", "size": 3 }\n',
        'notes/todo.txt': 'buy milk\n',
        'docs/guide.md': '# Guide\n\nRead me.\n',
        'docs/api/search.md': '# Search\n\nThe query.\n',
        'README.md': '# Readme\n',
      } as never,
      onRealmSetup(args: { testRealm: Realm }) {
        testRealm = args.testRealm;
        realmHref = new URL(testRealm.url).href;
      },
    });

    async function paths(query: Query) {
      let { data } = await searchCardsForTest(
        testRealm.realmIndexQueryEngine,
        query,
      );
      return data.map((r) => r.id!.slice(realmHref.length)).sort();
    }

    test('GtsFileDef: `**/components/*.gts` finds the direct children of any components folder', async function (assert) {
      assert.deepEqual(
        await paths({
          type: GtsFileDef,
          filter: { pattern: { url: '**/components/*.gts' } },
        }),
        ['components/goodbye.gts', 'components/hello-card.gts'],
        '`*` stays within the segment: components/deep/ is not matched',
      );
      assert.deepEqual(
        await paths({
          type: GtsFileDef,
          filter: { pattern: { url: '**/components/**.gts' } },
        }),
        [
          'components/deep/nested-card.gts',
          'components/goodbye.gts',
          'components/hello-card.gts',
        ],
        '`**` crosses segments',
      );
      assert.deepEqual(
        await paths({
          type: GtsFileDef,
          filter: { pattern: { url: '**/COMPONENTS/*.GTS' } },
        }),
        ['components/goodbye.gts', 'components/hello-card.gts'],
        'ignoring case',
      );
    });

    test('`*` and `?` do not cross `/`', async function (assert) {
      assert.deepEqual(
        await paths({
          type: GtsFileDef,
          filter: { pattern: { url: `${realmHref}*.gts` } },
        }),
        ['app.gts'],
        'a `*` after the realm matches only the top-level module',
      );
      assert.deepEqual(
        await paths({
          type: GtsFileDef,
          filter: { pattern: { url: `${realmHref}components?goodbye.gts` } },
        }),
        [],
        '`?` is not a `/`',
      );
      assert.deepEqual(
        await paths({
          type: GtsFileDef,
          filter: { pattern: { url: `${realmHref}components/g??dbye.gts` } },
        }),
        ['components/goodbye.gts'],
        '`?` is one character within the segment',
      );
    });

    test('name globs: `*-card.gts`', async function (assert) {
      assert.deepEqual(
        await paths({
          type: GtsFileDef,
          filter: { pattern: { name: '*-card.gts' } },
        }),
        ['components/deep/nested-card.gts', 'components/hello-card.gts'],
      );
    });

    test('TsFileDef, JsonFileDef, TextFileDef and MarkdownDef are found by path', async function (assert) {
      assert.deepEqual(
        await paths({
          type: TsFileDef,
          filter: { pattern: { url: '**/lib/*.ts' } },
        }),
        ['lib/util.ts'],
        'TsFileDef',
      );
      assert.deepEqual(
        await paths({
          type: JsonFileDef,
          filter: { pattern: { url: '**/data/*.json' } },
        }),
        ['data/config.json'],
        'JsonFileDef, a .json that is not a card',
      );
      assert.deepEqual(
        await paths({
          type: TextFileDef,
          filter: { pattern: { name: '*.txt' } },
        }),
        ['notes/todo.txt'],
        'TextFileDef',
      );
      assert.deepEqual(
        await paths({
          type: MarkdownDef,
          filter: { pattern: { url: '**/docs/**.md' } },
        }),
        ['docs/api/search.md', 'docs/guide.md'],
        'MarkdownDef: `docs/**/*.md` written `**/docs/**.md`',
      );
      assert.deepEqual(
        await paths({
          type: MarkdownDef,
          filter: { pattern: { url: '**/docs/**/*.md' } },
        }),
        ['docs/api/search.md'],
        '`**/*.md` under docs needs a folder between: the `/` is literal',
      );
    });

    test('mixed file types through the FileDef anchor', async function (assert) {
      assert.deepEqual(
        await paths({
          type: baseFileRef,
          filter: { pattern: { url: '**/lib/**' } },
        }),
        ['lib/deep/more.ts', 'lib/util.ts'],
        'every file type under lib/',
      );
      assert.deepEqual(
        await paths({
          type: baseFileRef,
          filter: {
            any: [
              { pattern: { name: '*.md' } },
              { pattern: { name: '*.txt' } },
            ],
          },
        }),
        ['README.md', 'docs/api/search.md', 'docs/guide.md', 'notes/todo.txt'],
        'globs on name across types',
      );
      assert.deepEqual(
        await paths({
          type: baseFileRef,
          filter: { regex: { url: '/lib/[a-z]+\\.ts$' } },
        }),
        ['lib/util.ts'],
        'regex reads the same fields',
      );
    });

    test("a file type's other fields are not searched by pattern", async function (assert) {
      assert.deepEqual(
        [...FILE_PATTERN_FIELDS],
        ['url', 'name'],
        'the fields the file indexer stamps',
      );
      let definition = await testRealm.batchCore.lookupDefinition(
        baseFileRef,
        new URL(testRealm.url),
      );
      let declared = Object.entries(definition!.fields)
        .filter(
          ([, id]) =>
            (definition!.fieldDefs[id]?.search as { patterns?: boolean })
              ?.patterns,
        )
        .map(([name]) => name)
        .sort();
      assert.deepEqual(
        declared,
        [...FILE_PATTERN_FIELDS].sort(),
        "they are the fields base's FileDef declares for patterns",
      );
      await assert.rejects(
        paths({
          type: MarkdownDef,
          filter: { pattern: { content: '*query*' } },
        }),
        /needs a field searched by pattern/,
        'content is not searched by pattern: `matches` finds words in it',
      );
    });
  });
});
