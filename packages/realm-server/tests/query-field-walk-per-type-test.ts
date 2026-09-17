import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { rri, RequestTimings } from '@cardstack/runtime-common';
import type { LooseSingleCardDocument, Realm } from '@cardstack/runtime-common';
import {
  setupPermissionedRealmCached,
  searchCardsForTest,
} from './helpers/index.ts';

const testRealm = new URL('http://127.0.0.1:4463/test/');

const WIDE_ROW_COUNT = 6;
const QUERIED_ROW_COUNT = 4;

// `Wide` composes five field definitions, each of which the query-field walk
// must descend into to find out whether anything below it is query-backed —
// and `branch` puts a second level under one of them. `Narrow` composes none,
// so the two types differ only in the size of the tree a walk covers, not in
// their instance count, payload or links.
//
// `Alpha` and `Beta` both carry a query-backed field, over disjoint result
// sets, so which targets a row carries says which type's plan was applied to
// it.
function buildFileSystem(): Record<string, string | LooseSingleCardDocument> {
  let fs: Record<string, string | LooseSingleCardDocument> = {};

  fs['fields.gts'] = `
    import { contains, field, FieldDef } from "@cardstack/base/card-api";
    import StringField from "@cardstack/base/string";
    import NumberField from "@cardstack/base/number";

    export class Leaf extends FieldDef {
      @field label = contains(StringField);
      @field amount = contains(NumberField);
    }

    export class Branch extends FieldDef {
      @field name = contains(StringField);
      @field leaf = contains(Leaf);
    }

    export class Tag extends FieldDef {
      @field name = contains(StringField);
    }
  `;

  fs['wide.gts'] = `
    import { contains, containsMany, field, CardDef } from "@cardstack/base/card-api";
    import StringField from "@cardstack/base/string";
    import { Branch, Leaf, Tag } from "./fields";

    export class Wide extends CardDef {
      @field name = contains(StringField);
      @field branch = contains(Branch);
      @field summary = contains(Leaf);
      @field detail = contains(Leaf);
      @field tags = containsMany(Tag);
      @field alternate = contains(Tag);
    }
  `;

  fs['narrow.gts'] = `
    import { contains, field, CardDef } from "@cardstack/base/card-api";
    import StringField from "@cardstack/base/string";

    export class Narrow extends CardDef {
      @field name = contains(StringField);
    }
  `;

  fs['target.gts'] = `
    import { contains, field, CardDef } from "@cardstack/base/card-api";
    import StringField from "@cardstack/base/string";

    export class Target extends CardDef {
      @field cardTitle = contains(StringField);
    }
  `;

  fs['queried.gts'] = `
    import { contains, field, linksToMany, CardDef } from "@cardstack/base/card-api";
    import StringField from "@cardstack/base/string";
    import { Branch } from "./fields";
    import { Target } from "./target";

    export class Alpha extends CardDef {
      @field name = contains(StringField);
      @field branch = contains(Branch);
      @field matches = linksToMany(() => Target, {
        query: {
          filter: { eq: { cardTitle: 'alpha-match' } },
          page: { size: 10, number: 0 },
        },
      });
    }

    export class Beta extends CardDef {
      @field name = contains(StringField);
      @field matches = linksToMany(() => Target, {
        query: {
          filter: { eq: { cardTitle: 'beta-match' } },
          page: { size: 10, number: 0 },
        },
      });
    }
  `;

  for (let title of ['alpha-match', 'beta-match']) {
    fs[`${title}.json`] = {
      data: {
        attributes: { cardTitle: title },
        meta: { adoptsFrom: { module: rri('./target'), name: 'Target' } },
      },
    } as LooseSingleCardDocument;
  }

  for (let i = 0; i < QUERIED_ROW_COUNT; i++) {
    fs[`alpha-${i}.json`] = {
      data: {
        attributes: {
          name: `A${i}`,
          branch: { name: `AB${i}`, leaf: { label: `AL${i}`, amount: i } },
        },
        meta: { adoptsFrom: { module: rri('./queried'), name: 'Alpha' } },
      },
    } as LooseSingleCardDocument;
    fs[`beta-${i}.json`] = {
      data: {
        attributes: { name: `B${i}` },
        meta: { adoptsFrom: { module: rri('./queried'), name: 'Beta' } },
      },
    } as LooseSingleCardDocument;
  }

  for (let i = 0; i < WIDE_ROW_COUNT; i++) {
    fs[`wide-${i}.json`] = {
      data: {
        attributes: {
          name: `W${i}`,
          branch: { name: `B${i}`, leaf: { label: `L${i}`, amount: i } },
          summary: { label: `S${i}`, amount: i },
          detail: { label: `D${i}`, amount: i },
          tags: [{ name: `T${i}` }],
          alternate: { name: `A${i}` },
        },
        meta: { adoptsFrom: { module: rri('./wide'), name: 'Wide' } },
      },
    } as LooseSingleCardDocument;
    fs[`narrow-${i}.json`] = {
      data: {
        attributes: { name: `N${i}` },
        meta: { adoptsFrom: { module: rri('./narrow'), name: 'Narrow' } },
      },
    } as LooseSingleCardDocument;
  }

  return fs;
}

type Relationships = Record<
  string,
  {
    links?: { self?: string | null; search?: string | null };
    data?: { id?: string }[];
  }
>;

interface SearchProbe {
  rows: number;
  defLookups: number;
  applied: number;
  data: { id?: string; relationships?: unknown }[];
  included: { id?: string }[];
}

async function search(
  realm: Realm,
  where: { module: string; name: string } | undefined,
  pageSize: number,
): Promise<SearchProbe> {
  let timings = new RequestTimings();
  let applied = 0;
  let { data, included } = await searchCardsForTest(
    realm.realmIndexQueryEngine,
    {
      ...(where
        ? {
            filter: {
              type: { module: `${testRealm}${where.module}`, name: where.name },
            },
          }
        : {}),
      page: { size: pageSize, number: 0 },
    },
    { loadLinks: true, timings, onQueryFieldApplied: () => applied++ },
  );
  return {
    rows: data.length,
    defLookups: timings.counters().defLookups ?? 0,
    applied,
    data,
    included,
  };
}

async function searchType(
  realm: Realm,
  name: string,
  pageSize: number,
): Promise<SearchProbe> {
  return await search(realm, { module: name.toLowerCase(), name }, pageSize);
}

function relationshipsOf(resource: { relationships?: unknown }): Relationships {
  return (resource.relationships ?? {}) as Relationships;
}

// Serving a card's query-backed fields means finding them first, and finding
// them means walking the type's field tree — one definition-cache read per
// composite field it descends into. The answer is the same for every card of
// one type, so the walk belongs to the type and not to the row: a search that
// repeated it per row would pay the tree's whole cost once per result, which
// is a per-type cost masquerading as a per-result one.
module(basename(import.meta.filename), function () {
  module('the query-field walk is per type, not per row', function (hooks) {
    let realm: Realm;

    setupPermissionedRealmCached(hooks, {
      mode: 'before',
      realmURL: testRealm,
      permissions: { '*': ['read'] },
      fileSystem: buildFileSystem(),
      onRealmSetup({ testRealm: r }) {
        realm = r;
      },
    });

    test('definition lookups do not grow with the number of results', async function (assert) {
      let one = await searchType(realm, 'Wide', 1);
      let many = await searchType(realm, 'Wide', WIDE_ROW_COUNT);

      assert.strictEqual(one.rows, 1, 'the one-row page returned one row');
      assert.strictEqual(
        many.rows,
        WIDE_ROW_COUNT,
        'the full page returned every row',
      );
      // The control on the two assertions below: without it a walk that never
      // ran at all would satisfy "did not grow" just as well as one that ran
      // once, and a type with nothing to walk would prove nothing either way.
      assert.ok(
        one.defLookups > 1,
        `walking the type read more than the root definition (${one.defLookups})`,
      );
      assert.strictEqual(
        many.defLookups,
        one.defLookups,
        `${WIDE_ROW_COUNT} rows cost the same lookups as 1 (${many.defLookups} vs ${one.defLookups})`,
      );
      assert.ok(
        many.defLookups < one.defLookups * WIDE_ROW_COUNT,
        'the walk did not repeat per row',
      );
    });

    test("a type's walk cost follows its field tree, not its result count or payload", async function (assert) {
      let wide = await searchType(realm, 'Wide', WIDE_ROW_COUNT);
      let narrow = await searchType(realm, 'Narrow', WIDE_ROW_COUNT);

      assert.strictEqual(wide.rows, narrow.rows, 'both returned the same rows');
      assert.ok(
        wide.defLookups > narrow.defLookups,
        `the composing type costs more lookups (${wide.defLookups}) than the flat one (${narrow.defLookups})`,
      );
    });

    // Sharing one walk across a type's rows is only sound if every row still
    // gets the fields that walk found. A count of lookups cannot see a plan
    // that came back empty, and a document's shape cannot see how many times
    // the walk ran — so the two assertions have to be made together.
    test('every row of a shared plan still has its query field resolved', async function (assert) {
      let alpha = await search(
        realm,
        { module: 'queried', name: 'Alpha' },
        QUERIED_ROW_COUNT,
      );

      assert.strictEqual(
        alpha.rows,
        QUERIED_ROW_COUNT,
        'every Alpha row came back',
      );
      assert.strictEqual(
        alpha.applied,
        QUERIED_ROW_COUNT,
        `the query field was resolved once per row (${alpha.applied})`,
      );
      for (let resource of alpha.data) {
        assert.ok(
          relationshipsOf(resource).matches?.links?.search,
          `${resource.id} carries its resolved query field`,
        );
      }
      assert.ok(
        alpha.included.some((r) => r.id?.endsWith('/alpha-match')),
        "the query's target is side-loaded",
      );
    });

    test('two types in one pass each get their own plan', async function (assert) {
      let all = await search(realm, undefined, 100);

      // The instance cards only. An unfiltered search also carries each
      // card's `.json` file row and the query's own target cards, and neither
      // kind has a query field to resolve.
      let alphas = all.data.filter((r) => /\/alpha-\d+$/.test(r.id ?? ''));
      let betas = all.data.filter((r) => /\/beta-\d+$/.test(r.id ?? ''));
      assert.strictEqual(alphas.length, QUERIED_ROW_COUNT, 'Alphas returned');
      assert.strictEqual(betas.length, QUERIED_ROW_COUNT, 'Betas returned');

      // Disjoint result sets, so a plan applied to the wrong type puts the
      // other type's target on the row rather than merely miscounting.
      for (let resource of [...alphas, ...betas]) {
        let matches = relationshipsOf(resource).matches;
        assert.ok(matches?.links?.search, `${resource.id} resolved its field`);
        let expected = resource.id?.includes('/alpha-')
          ? `${testRealm}alpha-match`
          : `${testRealm}beta-match`;
        assert.deepEqual(
          (matches?.data ?? []).map((member) => member.id),
          [expected],
          `${resource.id} matched its own query's target`,
        );
      }
      // Wide and Narrow are in this pass too and have no query field at all,
      // so a plan leaking across types would show up as extra applications.
      assert.strictEqual(
        all.applied,
        QUERIED_ROW_COUNT * 2,
        `only the two query-backed types applied a field (${all.applied})`,
      );
    });
  });
});
