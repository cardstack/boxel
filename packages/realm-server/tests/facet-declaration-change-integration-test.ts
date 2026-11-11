import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import {
  moduleChangeIsOnlyFacetDeclarations,
  rri,
  type Query,
  type Realm,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';
import type { PgAdapter } from '@cardstack/postgres';
import {
  setupPermissionedRealmCached,
  searchCardsForTest,
} from './helpers/index.ts';

// A module write that changes nothing but facet declarations rewrites the
// facet table from the indexed search docs and renders no card again
// (docs/search.md, Facets); any other change renders the dependents as every
// module write does.

const noteSource = (statusOptions: string, template = 'note') => `
  import { contains, field, CardDef, Component } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";

  export class Note extends CardDef {
    static displayName = 'Note';
    @field status = contains(StringField${statusOptions});
    static isolated = class Isolated extends Component<typeof this> {
      <template><p>${template} <@fields.status /></p></template>
    };
  }
`;

function note(status: string) {
  return {
    data: {
      attributes: { status },
      meta: { adoptsFrom: { module: rri('../note'), name: 'Note' } },
    },
  };
}

module(basename(import.meta.filename), function () {
  module('which module changes are only facet declarations', function () {
    const card = (field: string, extra = '', template = '<p>hi</p>') => `
      import { contains, field, CardDef, Component } from "@cardstack/base/card-api";
      import StringField from "@cardstack/base/string";
      export class A extends CardDef {${extra}
        @field s = contains(StringField${field});
        static isolated = class extends Component<typeof this> {
          <template>${template}</template>
        };
      }
    `;
    const facetOnly = (before: string, after: string) =>
      moduleChangeIsOnlyFacetDeclarations(before, after, 'a.gts');

    test('facet options and facetValue alone, however they are laid out', async function (assert) {
      let plain = card('');
      for (let after of [
        card(', { search: { facet: true } })'.slice(0, -1)),
        card(',\n          {\n search: { facet: true },\n })'.slice(0, -1)),
      ]) {
        assert.true(await facetOnly(plain, after), after);
      }
      assert.true(
        await facetOnly(
          card(", { search: { role: 'label' } }"),
          card(", { search: { role: 'label', facet: true } }"),
        ),
        'beside another search option',
      );
      assert.true(
        await facetOnly(
          card(''),
          card('', "\n        static facetValue = 's';"),
        ),
        'a facetValue',
      );
    });

    test('anything else is not facet-only', async function (assert) {
      let plain = card('');
      for (let [before, after, why] of [
        [plain, card('').replace('@field s', '@field t'), 'a rename'],
        [
          card(', { search: { facet: true } }'),
          card(", { search: { facet: true, role: 'label' } }"),
          'a role',
        ],
        [
          card(''),
          card(', { search: { facet: true } }', '', '<p>bye</p>'),
          'a template beside it',
        ],
        [
          card(''),
          card(', { search: { facet: true } }', '', '<p>hi</p> '),
          'whitespace inside a template beside it',
        ],
        [
          card('', '', '<p>facet: false</p>'),
          card('', '', '<p>facet: true</p>'),
          'text in a template that reads like a declaration',
        ],
        [
          card('', "\n        static note = 'facet: false';"),
          card('', "\n        static note = 'facet: true';"),
          'a string literal that reads like a declaration',
        ],
        [plain, plain, 'no change'],
        [plain, 'class {', 'a module that does not parse'],
      ] as const) {
        assert.false(await facetOnly(before, after), why);
      }
      assert.false(await facetOnly(undefined as never, plain), 'a new module');
    });
  });

  module('a facet-only module write', function (hooks) {
    let testRealm: Realm;
    let dbAdapter: PgAdapter;
    let realmHref: string;

    setupPermissionedRealmCached(hooks, {
      realmURL: new URL('http://127.0.0.1:4444/facet-change/'),
      permissions: { '*': ['read', 'write'] },
      fileSystem: {
        'note.gts': noteSource(''),
        'Note/a.json': note('open'),
        'Note/b.json': note('open'),
        'Note/c.json': note('done'),
      } as never,
      onRealmSetup(args: { testRealm: Realm; dbAdapter: PgAdapter }) {
        testRealm = args.testRealm;
        dbAdapter = args.dbAdapter;
        realmHref = new URL(testRealm.url).href;
      },
    });

    let noteRef = (): ResolvedCodeRef => ({
      module: rri(`${realmHref}note`),
      name: 'Note',
    });
    let query = (): Query => ({
      filter: { type: noteRef() },
      facets: [{ by: 'status' }],
    });
    async function renderedAt(): Promise<Record<string, string>> {
      let rows = (await dbAdapter.execute(
        `SELECT url, indexed_at::text AS at FROM boxel_index WHERE realm_url = $1 AND type = 'instance' ORDER BY url`,
        { bind: [realmHref] },
      )) as { url: string; at: string }[];
      return Object.fromEntries(rows.map((r) => [r.url, r.at]));
    }

    test('backfills the facet table without rendering a card, and any other change renders', async function (assert) {
      await assert.rejects(
        searchCardsForTest(testRealm.realmIndexQueryEngine, query()),
        /not declared as a facet/,
        'undeclared at first',
      );
      let before = await renderedAt();
      assert.strictEqual(Object.keys(before).length, 3);

      await testRealm.write(
        'note.gts',
        noteSource(', { search: { facet: true } }'),
      );
      let { meta } = await searchCardsForTest(
        testRealm.realmIndexQueryEngine,
        query(),
      );
      assert.deepEqual(meta.facets?.status, [
        { value: 'open', count: 2 },
        { value: 'done', count: 1 },
      ]);
      assert.deepEqual(
        await renderedAt(),
        before,
        'no card was rendered again',
      );

      // Undeclared again, beside a template change: not facet-only, so the
      // cards render, and the facet is refused.
      await testRealm.write('note.gts', noteSource('', 'a note'));
      let after = await renderedAt();
      assert.notDeepEqual(after, before, 'the cards rendered again');
      await assert.rejects(
        searchCardsForTest(testRealm.realmIndexQueryEngine, query()),
        /not declared as a facet/,
      );
    });
  });
});
