import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import {
  BASE_INDEX_FIELDS,
  baseCardRef,
  baseFileRef,
  baseRef,
  rri,
  type Query,
  type Realm,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';
import {
  setupPermissionedRealmCached,
  searchCardsForTest,
} from './helpers/index.ts';

// A file's fields are not facets of the card that links it ("the wrapper card
// defines the facets", docs/search-cookbook.md): the card declares a computed
// field that reads the linked file, with `search: { facet: true }`, and
// facets by it. End to end through the real render: the computed value is in
// the card's search doc and facet table when the file is loaded at index
// time, and follows the file when it changes. A facet by a path into the
// file itself is refused with the pattern to use.

const clipSource = `
  import { contains, field, linksTo, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  import { MarkdownDef } from "@cardstack/base/markdown-file-def";

  export class Clip extends CardDef {
    static displayName = 'Clip';
    @field name = contains(StringField);
    @field notes = linksTo(MarkdownDef, { search: { facet: true } });
    @field notesTitle = contains(StringField, {
      computeVia: function (this: Clip) {
        return this.notes?.title;
      },
      search: { facet: true },
    });
  }
`;

function clip(name: string, notes: string) {
  return {
    data: {
      attributes: { name },
      relationships: { notes: { links: { self: `../${notes}` } } },
      meta: { adoptsFrom: { module: rri('../clip'), name: 'Clip' } },
    },
  };
}

module(basename(import.meta.filename), function () {
  module(
    'a wrapper card declares the facets of a file it links',
    function (hooks) {
      let testRealm: Realm;
      let realmHref: string;

      setupPermissionedRealmCached(hooks, {
        realmURL: new URL('http://127.0.0.1:4444/clips/'),
        permissions: { '*': ['read', 'write'] },
        fileSystem: {
          'clip.gts': clipSource,
          'interview.md': '# Interview\n\nThe whole conversation.\n',
          'keynote.md': '# Keynote\n\nThe talk.\n',
          'Clip/a.json': clip('A', 'interview.md'),
          'Clip/b.json': clip('B', 'interview.md'),
          'Clip/c.json': clip('C', 'keynote.md'),
        } as never,
        onRealmSetup(args: { testRealm: Realm }) {
          testRealm = args.testRealm;
          realmHref = new URL(testRealm.url).href;
        },
      });

      let clipRef = (): ResolvedCodeRef => ({
        module: rri(`${realmHref}clip`),
        name: 'Clip',
      });
      async function search(query: Query) {
        return await searchCardsForTest(testRealm.realmIndexQueryEngine, query);
      }

      // Pinned gap (platform, not facets): a from-scratch index renders a card
      // before the file it links has been indexed, so the computed reads no
      // title for some of them (here `Clip/c`, whose deps do name keynote.md),
      // and the file's own visit later in the same pass does not re-render it.
      // The card has the value once the file changes (the test below).
      QUnit.test.todo(
        'a from-scratch index gives every card the value of the file it links',
        async function (assert) {
          let { meta } = await search({
            filter: { type: clipRef() },
            facets: [{ by: 'notesTitle' }],
          });
          assert.deepEqual(meta.facets?.notesTitle, [
            { value: 'Interview', count: 2 },
            { value: 'Keynote', count: 1 },
          ]);
        },
      );

      test("a computed field over the linked file counts by the file's value, and follows the file", async function (assert) {
        let { meta } = await search({
          filter: { type: clipRef() },
          facets: [{ by: 'notesTitle' }],
        });
        assert.deepEqual(
          meta.facets?.notesTitle?.[0],
          { value: 'Interview', count: 2 },
          'the cards count by the title of the file they link',
        );
        await testRealm.write('keynote.md', '# Opening keynote\n\nThe talk.\n');
        let after = await search({
          filter: { type: clipRef() },
          facets: [{ by: 'notesTitle' }],
        });
        assert.deepEqual(
          after.meta.facets?.notesTitle,
          [
            { value: 'Interview', count: 2 },
            { value: 'Opening keynote', count: 1 },
          ],
          'editing the file reindexes the card that reads it',
        );
      });

      test("base's index-field declarations are the ones the engine falls back to", async function (assert) {
        for (let [name, ref] of [
          ['BaseDef', baseRef],
          ['CardDef', baseCardRef],
          ['FileDef', baseFileRef],
        ] as const) {
          let definition = await testRealm.batchCore.lookupDefinition(
            ref,
            new URL(testRealm.url),
          );
          assert.deepEqual(
            definition?.indexFields,
            BASE_INDEX_FIELDS[name],
            `${name}'s static indexFields, as its definition records them`,
          );
        }
      });

      test('the link counts its files by id; a path into the file is refused with the pattern', async function (assert) {
        let { meta } = await search({
          filter: { type: clipRef() },
          facets: [{ by: 'notes' }],
        });
        assert.deepEqual(
          meta.facets?.notes?.map((c) => [c.value, c.count]),
          [
            [`${realmHref}interview.md`, 2],
            [`${realmHref}keynote.md`, 1],
          ],
        );
        await assert.rejects(
          search({
            filter: { type: clipRef() },
            facets: [{ by: 'notes.title' }],
          }),
          /links a file[\s\S]*computeVia/,
        );
      });
    },
  );
});
