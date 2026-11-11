import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import { lowerOperationDeclarations } from '@cardstack/runtime-common/card-operations';
import type { CodeRef } from '@cardstack/runtime-common/code-ref';
import type {
  Definition,
  FieldDefinition,
} from '@cardstack/runtime-common/definitions';
import {
  mapQueryPaths,
  resolveSavedQueryLabels,
  type FieldsAt,
} from '@cardstack/runtime-common/query-syntax';
import type { InvalidQueryError } from '@cardstack/runtime-common';

// A saved query (a declared query operation, a query-backed field) resolves
// its labels when it is saved and is stored with bare paths, so a later
// schema change cannot make a label it was written with ambiguous.

const MODULE = 'http://example.com/cards/shop';
const ref = (name: string) => ({ module: MODULE, name }) as CodeRef;
const key = (r: any) => `${r.module}/${r.name}`;
const scalar = (): FieldDefinition => ({
  type: 'contains',
  isPrimitive: true,
  isComputed: false,
  fieldOrCard: ref('StringField'),
});
function definition(
  name: string,
  fields: Record<string, FieldDefinition>,
): Definition {
  let fieldMap: Definition['fields'] = {};
  let fieldDefs: Definition['fieldDefs'] = {};
  Object.entries(fields).forEach(([fieldName, def], i) => {
    fieldMap[fieldName] = `f${i}`;
    fieldDefs[`f${i}`] = def;
  });
  return {
    type: 'card-def',
    codeRef: ref(name),
    displayName: name,
    fields: fieldMap,
    fieldDefs,
  };
}
const Brand = definition('Brand', { name: scalar() });
const Product = definition('Product', {
  priceMin: scalar(),
  unitsSold30d: scalar(),
  brand: {
    type: 'linksTo',
    isPrimitive: false,
    isComputed: false,
    fieldOrCard: ref('Brand'),
  },
});
const graph = new Map([
  [key(ref('Brand')), Brand],
  [key(ref('Product')), Product],
]);
const fieldsAt: FieldsAt = async (type, prefix) => {
  let def = graph.get(key(type));
  if (!def) return undefined;
  if (!prefix.length) return Object.keys(def.fields);
  let field = def.fieldDefs[def.fields[prefix[0]]];
  let inner = field && graph.get(key(field.fieldOrCard));
  return inner ? Object.keys(inner.fields) : undefined;
};
const P = ref('Product');

module(basename(import.meta.filename), function () {
  test('every path a query names is rewritten, and nothing else', function (assert) {
    let seen: string[] = [];
    let out = mapQueryPaths(
      {
        type: P,
        filter: {
          every: [
            { eq: { PriceMin: 'PriceMin' } },
            { on: ref('Brand'), contains: { Name: 'x' } },
            { exists: 'Brand.Name' },
          ],
        },
        sort: [
          {
            blend: [{ by: 'UnitsSold30d' }, { boost: { eq: { PriceMin: 1 } } }],
          },
          { by: 'lastModified' },
        ],
        collapse: 'Brand.Name',
        facets: [{ by: '"Units Sold 30d"' }],
      },
      (path, anchor) => {
        seen.push(`${(anchor as { name?: string })?.name}:${path}`);
        return path.toLowerCase();
      },
    );
    assert.deepEqual(seen.sort(), [
      'Brand:Name',
      'Product:"Units Sold 30d"',
      'Product:Brand.Name',
      'Product:Brand.Name',
      'Product:PriceMin',
      'Product:PriceMin',
      'Product:UnitsSold30d',
    ]);
    assert.deepEqual(
      (out as any).filter.every[0],
      { eq: { pricemin: 'PriceMin' } },
      'a value is left alone',
    );
    assert.strictEqual(
      (out as any).sort[1].by,
      'lastModified',
      'a general sort is left alone',
    );
  });

  test('a saved query stores bare paths for its labels', async function (assert) {
    let saved = await resolveSavedQueryLabels(
      {
        filter: {
          every: [
            { on: P, range: { PriceMin: { lt: 50 } } },
            { on: P, eq: { 'Brand.Name': 'Acme' } },
            { on: P, eq: { 'item.unitsSold30d': 3 } },
          ],
        },
        sort: [{ on: P, by: '"Units Sold 30d"', direction: 'desc' }],
      },
      fieldsAt,
    );
    assert.deepEqual(saved as unknown, {
      filter: {
        every: [
          { on: P, range: { priceMin: { lt: 50 } } },
          { on: P, eq: { 'brand.name': 'Acme' } },
          { on: P, eq: { unitsSold30d: 3 } },
        ],
      },
      sort: [{ on: P, by: 'unitsSold30d', direction: 'desc' }],
    });
  });

  test('a label that names no field, or two, is refused when saved', async function (assert) {
    let twin = definition('Twin', {
      unitsSold: scalar(),
      units_sold: scalar(),
    });
    graph.set(key(ref('Twin')), twin);
    for (let [query, why] of [
      [{ filter: { on: P, eq: { PriceMax: 1 } } }, 'no such field'],
      [{ filter: { on: ref('Twin'), eq: { UnitsSold: 1 } } }, 'two fields'],
    ] as const) {
      let refusal: unknown;
      try {
        await resolveSavedQueryLabels(query, fieldsAt);
      } catch (e) {
        refusal = e;
      }
      assert.strictEqual(
        (refusal as InvalidQueryError | undefined)?.code,
        'unknown-field',
        why,
      );
    }
  });

  test('a declared query operation is stored with its labels resolved', async function (assert) {
    let ProductClass = function Product() {} as unknown as never;
    let lowered = await lowerOperationDeclarations(
      {
        cheapByBrand: {
          base: 'query',
          params: {},
          query: {
            filter: {
              every: [
                { on: () => ProductClass, eq: { 'Brand.Name': 'Acme' } },
                { on: () => ProductClass, range: { PriceMin: { lt: 50 } } },
              ],
            },
            sort: [{ on: () => ProductClass, by: 'PriceMin' }],
          },
        },
        typo: {
          base: 'query',
          params: {},
          query: { filter: { on: () => ProductClass, eq: { PriceMax: 1 } } },
        },
      } as never,
      {
        definition: Product,
        lookupDefinition: async (r: CodeRef) => graph.get(key(r)),
        identifyCard: (def) =>
          (def as unknown) === ProductClass ? P : undefined,
      },
    );
    let stored = JSON.stringify(lowered.operations.cheapByBrand.query);
    assert.true(stored.includes('"item.brand.name"'), stored);
    assert.true(stored.includes('"item.priceMin"'), stored);
    assert.false(/Brand\.Name|PriceMin"/.test(stored), 'no label is stored');
    assert.true(lowered.operations.typo.invalid, 'an unknown label is refused');
    assert.deepEqual(
      lowered.operations.typo.issues?.map((i) => i.code),
      ['invalid-query'],
    );
  });
});
