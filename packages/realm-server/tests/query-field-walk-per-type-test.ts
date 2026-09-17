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

// `Wide` composes five field definitions, each of which the query-field walk
// must descend into to find out whether anything below it is query-backed —
// and `nested` puts a second level under one of them. `Narrow` composes none,
// so the two types differ only in the size of the tree a walk covers, not in
// their instance count, payload or links.
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

async function searchType(
  realm: Realm,
  name: string,
  pageSize: number,
): Promise<{ rows: number; defLookups: number }> {
  let timings = new RequestTimings();
  let { data } = await searchCardsForTest(
    realm.realmIndexQueryEngine,
    {
      filter: { type: { module: `${testRealm}${name.toLowerCase()}`, name } },
      page: { size: pageSize, number: 0 },
    },
    { loadLinks: true, timings },
  );
  return { rows: data.length, defLookups: timings.counters().defLookups ?? 0 };
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
  });
});
