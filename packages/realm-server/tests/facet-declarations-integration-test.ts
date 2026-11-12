import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import type { PgAdapter } from '@cardstack/postgres';
import {
  IndexQueryEngine,
  IndexWriter,
  InvalidQueryError,
  VirtualNetwork,
  backfillFacetValues,
  facetFieldSpecsOf,
  onlyFacetDeclarationsDiffer,
  internalKeyFor,
  rri,
  type CodeRef,
  type Definition,
  type DefinitionLookup,
  type FieldDefinition,
  type Query,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';

import {
  closeTestPgAdapter,
  createTestPgAdapter,
  prepareTestDB,
  testRealm,
} from './helpers/index.ts';
import { withFacetFields } from './helpers/facet-fields.ts';

// Facets are declared (docs/search.md, Facets): a field counts only when it
// declares `search: { facet: true }`, a compound opts in the subfields its
// FieldDef declares (or its `facetValue`), a link counts its cards, and the
// built-ins (card type, realm, created, modified) need no declaration. Every
// facet reads the facet table, which the index writer keeps for declared
// fields, and a declaration-only change rewrites it from the search docs.

function ref(module: string, name: string): ResolvedCodeRef {
  return { module: module as ResolvedCodeRef['module'], name };
}

const stringRef = ref('@cardstack/base/string', 'default');
const numberRef = ref('@cardstack/base/number', 'default');
const datetimeRef = ref('@cardstack/base/datetime', 'default');
const mod = `${testRealm}order`;
const addressRef = ref(mod, 'Address');
const moneyRef = ref(mod, 'Money');
const itemRef = ref(mod, 'Item');
const personRef = ref(mod, 'Person');
const orderRef = ref(mod, 'Order');
const fileDefRef = ref('@cardstack/base/card-api', 'FileDef');
const rushRef = ref(mod, 'RushOrder');

const facet = { search: { facet: true } };
function prim(
  fieldOrCard: ResolvedCodeRef,
  extra: Partial<FieldDefinition> = {},
): FieldDefinition {
  return {
    type: 'contains',
    isPrimitive: true,
    isComputed: false,
    fieldOrCard,
    ...(fieldOrCard === numberRef ? { serializerName: 'number' } : {}),
    ...(fieldOrCard === datetimeRef ? { serializerName: 'datetime' } : {}),
    ...extra,
  } as FieldDefinition;
}
function compound(
  type: FieldDefinition['type'],
  fieldOrCard: ResolvedCodeRef,
  extra: Partial<FieldDefinition> = {},
): FieldDefinition {
  return {
    type,
    isPrimitive: false,
    isComputed: false,
    fieldOrCard,
    ...extra,
  } as FieldDefinition;
}
function def(
  kind: Definition['type'],
  codeRef: ResolvedCodeRef,
  fields: Record<string, FieldDefinition>,
  extra: Partial<Definition> = {},
): Definition {
  let names: Record<string, string> = {};
  let defs: Record<string, FieldDefinition> = {};
  Object.entries(fields).forEach(([name, field], i) => {
    names[name] = `f${i}`;
    defs[`f${i}`] = field;
  });
  return {
    type: kind,
    codeRef,
    displayName: kind === 'field-def' ? null : codeRef.name,
    fields: names,
    fieldDefs: defs,
    ...extra,
  } as Definition;
}

const addressDef = def('field-def', addressRef, {
  city: prim(stringRef, facet),
  street: prim(stringRef),
});
const moneyFields = () => ({
  currency: prim(stringRef),
  amount: prim(numberRef, facet),
});
const moneyDef = def('field-def', moneyRef, moneyFields(), {
  facetValue: 'currency',
});
const itemDef = def('field-def', itemRef, { sku: prim(stringRef, facet) });
const personDef = def('card-def', personRef, {
  cardTitle: prim(stringRef),
  name: prim(stringRef, facet),
  code: prim(stringRef, facet),
});
const orderFields: Record<string, FieldDefinition> = {
  cardTitle: prim(stringRef),
  status: prim(stringRef, facet),
  note: prim(stringRef),
  weight: prim(numberRef),
  total: prim(numberRef, facet),
  placedAt: prim(datetimeRef, facet),
  tags: { ...prim(stringRef, facet), type: 'containsMany' },
  shipTo: compound('contains', addressRef, facet),
  billTo: compound('contains', addressRef),
  price: compound('contains', moneyRef, facet),
  items: compound('containsMany', itemRef, facet),
  buyer: compound('linksTo', personRef, facet),
  seller: compound('linksTo', personRef),
  receipt: compound('linksTo', fileDefRef, facet),
  // The wrapper-card pattern: what the card counts by inside a linked file is
  // a computed field of its own, declared a facet.
  receiptType: prim(stringRef, { ...facet, isComputed: true }),
};
let orderDef = def('card-def', orderRef, orderFields);
const rushDef = def('card-def', rushRef, {
  ...orderFields,
  rushLevel: prim(numberRef, facet),
  courier: prim(stringRef),
  code: prim(numberRef, facet),
});

// Base's declarations, as the definitions of BaseDef, CardDef and FileDef
// record them (`static indexFields` in card-api).
const baseIndexFields = {
  _type: facet,
  _realm: facet,
  createdAt: facet,
  lastModified: facet,
};
const baseDefinitions = new Map<string, Definition>([
  [
    'BaseDef',
    def(
      'card-def',
      ref('@cardstack/base/card-api', 'BaseDef'),
      {},
      {
        indexFields: baseIndexFields,
      },
    ),
  ],
  [
    'CardDef',
    def(
      'card-def',
      ref('@cardstack/base/card-api', 'CardDef'),
      {},
      {
        indexFields: { ...baseIndexFields, _cardType: facet },
      },
    ),
  ],
  [
    'FileDef',
    def(
      'file-def',
      fileDefRef,
      { contentType: prim(stringRef), name: prim(stringRef) },
      { indexFields: baseIndexFields },
    ),
  ],
]);

const definitions = new Map<string, () => Definition>([
  ['Address', () => addressDef],
  ['Money', () => moneyDef],
  ['Item', () => itemDef],
  ['Person', () => personDef],
  ['Order', () => orderDef],
  ['RushOrder', () => rushDef],
]);

async function lookupDefinition(codeRef: CodeRef): Promise<Definition> {
  if (
    'module' in codeRef &&
    codeRef.module === '@cardstack/base/card-api' &&
    baseDefinitions.has(codeRef.name)
  ) {
    return baseDefinitions.get(codeRef.name)!;
  }
  let found =
    'name' in codeRef && 'module' in codeRef && codeRef.module === mod
      ? definitions.get(codeRef.name)
      : undefined;
  if (!found) {
    throw new Error(`unexpected definition lookup: ${JSON.stringify(codeRef)}`);
  }
  return found();
}

function makeDefinitionLookup(): DefinitionLookup {
  const lookup = {
    lookupDefinition,
    async lookupDefinitionEntry(): Promise<never> {
      throw new Error('lookupDefinitionEntry is not used by these tests');
    },
    async lookupCachedDefinition() {
      return undefined;
    },
    async invalidate() {
      return [];
    },
    async clearRealmDefinitions() {},
    async clearAllDefinitions() {},
    registerRealm() {},
    async getCachedDefinitions() {
      return undefined;
    },
    async populateDefinitionCacheEntry() {
      return undefined;
    },
    async getCachedDefinitionsBatch() {
      return {};
    },
    forRealm() {
      return lookup;
    },
  } as unknown as DefinitionLookup;
  return lookup;
}

const p1 = `${testRealm}Person/ada`;
const p2 = `${testRealm}Person/bob`;

const orders: Record<string, Record<string, unknown>> = {
  a: {
    cardTitle: 'A',
    status: 'open',
    note: 'first',
    weight: 3,
    total: 10,
    placedAt: '2024-01-15T10:00:00Z',
    tags: ['gift', 'rush'],
    shipTo: { city: 'Boston', street: '1 Main' },
    billTo: { city: 'NYC', street: '9 Elm' },
    price: { currency: 'USD', amount: 10 },
    items: [{ sku: 'A1' }, { sku: 'A1' }, { sku: 'B2' }],
    buyer: { id: p1 },
    seller: { id: p2 },
    receipt: { id: `${testRealm}files/a.md` },
    receiptType: 'text/markdown',
  },
  b: {
    cardTitle: 'B',
    status: 'open',
    total: 25,
    placedAt: '2024-02-03T10:00:00Z',
    tags: ['rush'],
    shipTo: { city: 'Boston' },
    price: { currency: 'EUR', amount: 25 },
    items: [{ sku: 'B2' }],
    buyer: { id: p2 },
  },
  c: {
    cardTitle: 'C',
    status: 'closed',
    total: 40,
    placedAt: '2024-02-20T08:30:00Z',
    tags: [],
    shipTo: { city: 'Denver' },
    price: { currency: 'USD', amount: 40 },
    items: [],
    buyer: { id: p1 },
  },
  d: { cardTitle: 'D', total: 5, placedAt: '2024-03-02T00:00:00Z' },
};
const rush: Record<string, unknown> = {
  cardTitle: 'R',
  status: 'open',
  total: 100,
  placedAt: '2024-03-10T12:00:00Z',
  shipTo: { city: 'Austin' },
  items: [{ sku: 'A1' }],
  rushLevel: 2,
  courier: 'UPS',
  code: 7,
};

module(basename(import.meta.filename), function (hooks) {
  let adapter: PgAdapter;
  let virtualNetwork: VirtualNetwork;
  let engine: IndexQueryEngine;
  let orderKey: string;

  hooks.beforeEach(async function () {
    prepareTestDB();
    orderDef = def('card-def', orderRef, orderFields);
    adapter = await createTestPgAdapter();
    virtualNetwork = new VirtualNetwork();
    engine = new IndexQueryEngine(
      adapter,
      makeDefinitionLookup(),
      virtualNetwork,
    );
    orderKey = internalKeyFor(orderRef, undefined, virtualNetwork);
    let rushKey = internalKeyFor(rushRef, undefined, virtualNetwork);
    let personKey = internalKeyFor(personRef, undefined, virtualNetwork);
    let batch = await new IndexWriter(adapter).createBatch(
      new URL(testRealm),
      virtualNetwork,
      undefined,
      { splitPrerenderHtml: false },
    );
    let write = async (
      href: string,
      searchData: Record<string, unknown>,
      definition: Definition,
      types: string[],
      displayNames: string[],
    ) => {
      let cardURL = new URL(href);
      await batch.updateEntry(cardURL, {
        type: 'instance',
        resource: {
          id: rri(cardURL.href),
          type: 'card',
          attributes: {},
          meta: {
            adoptsFrom: {
              module: rri((definition.codeRef as ResolvedCodeRef).module),
              name: (definition.codeRef as ResolvedCodeRef).name,
            },
          },
        },
        lastModified: Date.UTC(2025, 5, 1, 12),
        resourceCreatedAt: Date.UTC(2025, 0, 1, 12),
        searchData: await withFacetFields(
          { ...searchData, _title: searchData.cardTitle },
          definition,
          lookupDefinition,
        ),
        markdown: String(searchData.cardTitle),
        deps: new Set(),
        displayNames,
        types,
        isolatedHtml: '<div></div>',
      });
    };
    for (let [name, data] of Object.entries(orders)) {
      await write(
        `${testRealm}Order/${name}.json`,
        data,
        orderDef,
        [orderKey],
        ['Order'],
      );
    }
    await write(
      `${testRealm}Order/r1.json`,
      rush,
      rushDef,
      [rushKey, orderKey],
      ['RushOrder', 'Order'],
    );
    await write(
      `${p1}.json`,
      { cardTitle: 'Ada', name: 'Ada', code: 'A-1' },
      personDef,
      [personKey],
      ['Person'],
    );
    await write(
      `${p2}.json`,
      { cardTitle: 'Bob', name: 'Bob' },
      personDef,
      [personKey],
      ['Person'],
    );
    // Base's types keep their prefix form as their internal key.
    let fileKey = '@cardstack/base/card-api/FileDef';
    let markdownKey = '@cardstack/base/markdown-file-def/MarkdownDef';
    for (let [name, types, displayNames] of [
      ['files/a.md', [markdownKey, fileKey], ['Markdown', 'File']],
      ['files/b.md', [markdownKey, fileKey], ['Markdown', 'File']],
      ['files/c.bin', [fileKey], ['File']],
    ] as [string, string[], string[]][]) {
      await batch.updateEntry(new URL(`${testRealm}${name}`), {
        type: 'file',
        lastModified: Date.UTC(2025, 5, 1, 12),
        resourceCreatedAt: Date.UTC(2025, 0, 1, 12),
        deps: new Set(),
        searchData: { name, _title: name },
        types,
        displayNames,
      });
    }
    await batch.done();
  });

  hooks.afterEach(async function () {
    await closeTestPgAdapter(adapter);
  });

  const on = orderRef;
  async function meta(query: Query) {
    return (await engine.searchCards(new URL(testRealm), query)).meta;
  }
  async function refusal(query: Query): Promise<InvalidQueryError> {
    try {
      await meta(query);
    } catch (e) {
      if (e instanceof InvalidQueryError) {
        return e;
      }
      throw e;
    }
    throw new Error(`expected a refusal for ${JSON.stringify(query)}`);
  }

  test('an undeclared field is refused with the declaration that makes it a facet', async function (assert) {
    let e = await refusal({ filter: { type: on }, facets: [{ by: 'note' }] });
    assert.strictEqual(e.code, 'needs-declaration');
    assert.ok(
      [
        e.message.includes('"note"'),
        e.message.includes('Order'),
        e.message.includes('search: { facet: true }'),
      ].every(Boolean),
      `the message names the field, its type and the fix: ${e.message}`,
    );
    e = await refusal({ filter: { type: on }, facets: [{ by: 'seller' }] });
    assert.strictEqual(e.code, 'needs-declaration', 'an undeclared link');
    assert.ok(e.message.includes('linksTo('), e.message);
    e = await refusal({
      filter: { type: on },
      facets: [{ by: 'status', measure: { sum: 'weight' } }],
    });
    assert.strictEqual(e.code, 'needs-declaration', 'an undeclared measure');
    assert.ok(e.message.startsWith('facet measure sum "weight"'), e.message);
    e = await refusal({ filter: { type: on }, facets: [{ by: 'nope' }] });
    assert.strictEqual(e.code, 'unknown-field', 'a field the type lacks');
  });

  test('a compound opts in the subfields its FieldDef declares', async function (assert) {
    let { facets } = await meta({
      filter: { type: on },
      facets: [{ by: 'shipTo.city' }],
    });
    assert.deepEqual(facets?.['shipTo.city'], [
      { value: 'Boston', count: 2 },
      { value: 'Austin', count: 1 },
      { value: 'Denver', count: 1 },
    ]);
    let street = await refusal({
      filter: { type: on },
      facets: [{ by: 'shipTo.street' }],
    });
    assert.strictEqual(street.code, 'needs-declaration');
    assert.ok(
      [
        street.message.includes('"street"'),
        street.message.includes('Address'),
      ].every(Boolean),
      street.message,
    );
    let billTo = await refusal({
      filter: { type: on },
      facets: [{ by: 'billTo.city' }],
    });
    assert.strictEqual(billTo.code, 'needs-declaration');
    assert.ok(billTo.message.includes('"billTo"'), billTo.message);
    let whole = await refusal({
      filter: { type: on },
      facets: [{ by: 'shipTo' }],
    });
    assert.strictEqual(whole.code, 'needs-declaration');
    assert.ok(
      [
        whole.message.includes('"shipTo.city"'),
        whole.message.includes('facetValue'),
      ].every(Boolean),
      `a compound with no facetValue points at its subfields: ${whole.message}`,
    );
  });

  test("a compound's facetValue makes the compound itself a facet", async function (assert) {
    let { facets } = await meta({
      filter: { type: on },
      facets: [{ by: 'price' }, { by: 'price.amount', stats: true }],
    });
    assert.deepEqual(facets?.price, [
      { value: 'USD', count: 2 },
      { value: 'EUR', count: 1 },
    ]);
    assert.strictEqual(facets?.['price.amount']?.length, 3);
  });

  test('a list of compounds counts a card once per value any element holds', async function (assert) {
    let { facets, facetStats } = await meta({
      filter: { type: on },
      facets: [{ by: 'items.sku', stats: true }],
    });
    assert.deepEqual(facets?.['items.sku'], [
      { value: 'A1', count: 2 },
      { value: 'B2', count: 2 },
    ]);
    assert.strictEqual(facetStats?.['items.sku']?.count, 3, 'a, b and r1');
  });

  test('a link facet counts the linked cards by id, labeled with their titles', async function (assert) {
    let { facets } = await meta({
      filter: { type: on },
      facets: [{ by: 'buyer' }],
    });
    assert.deepEqual(facets?.buyer, [
      { value: p1, count: 2, label: 'Ada' },
      { value: p2, count: 1, label: 'Bob' },
    ]);
  });

  test('the built-in facets need no declaration', async function (assert) {
    let { facets } = await meta({
      facets: [
        { by: '_cardType' },
        { by: '_realm' },
        { by: 'lastModified', interval: 'month' },
        { by: 'createdAt' },
      ],
    });
    assert.deepEqual(facets?._cardType, [
      { value: 'Order', count: 4 },
      { value: 'Person', count: 2 },
      { value: 'RushOrder', count: 1 },
    ]);
    assert.deepEqual(facets?._realm, [{ value: testRealm, count: 7 }]);
    assert.deepEqual(facets?.lastModified, [{ value: '2025-06-01', count: 7 }]);
    assert.deepEqual(facets?.createdAt, [{ value: '2025-01-01', count: 7 }]);
  });

  test("the type facet counts cards, files and a mixed search as the realm's type summary does", async function (assert) {
    let summary = await engine.fetchCardTypeSummary(new URL(testRealm));
    let fromSummary = (entries: typeof summary.instances) =>
      entries
        .map((e) => ({
          value: e.code_ref,
          count: e.total,
          label: e.display_name,
        }))
        .sort((x, y) => x.value.localeCompare(y.value));
    let sorted = (counts: { value: string }[] | undefined) =>
      [...(counts ?? [])].sort((x, y) => x.value.localeCompare(y.value));
    let cards = await meta({ facets: [{ by: '_type' }] });
    assert.deepEqual(
      sorted(cards.facets?._type),
      fromSummary(summary.instances),
      "cards: each card's own type, a subclass under its own",
    );
    let rushCount = cards.facets?._type?.find(
      (c) => c.label === 'RushOrder',
    )?.count;
    assert.strictEqual(rushCount, 1, 'the subclass counts under its own type');
    let files = await engine.searchFiles(new URL(testRealm), {
      facets: [{ by: '_type' }],
    });
    assert.deepEqual(
      sorted(files.meta.facets?._type),
      fromSummary(summary.files),
      'files: each file def, labeled with its display name',
    );
    let mixed = await engine.search(
      new URL(testRealm),
      { facets: [{ by: '_type' }, { by: '_realm' }] },
      {},
      { kind: 'dataOnly' },
      'all',
    );
    assert.deepEqual(
      sorted(mixed.meta.facets?._type),
      sorted([
        ...fromSummary(summary.instances),
        ...fromSummary(summary.files),
      ]),
      'a mixed search counts both',
    );
    assert.deepEqual(mixed.meta.facets?._realm, [
      { value: testRealm, count: 10 },
    ]);
    let refused = await engine
      .searchFiles(new URL(testRealm), { facets: [{ by: '_cardType' }] })
      .then(
        () => undefined,
        (e) => e,
      );
    assert.strictEqual(
      refused?.code,
      'needs-declaration',
      'a file declares no _cardType',
    );
  });

  test("a facet inside a linked file is refused, pointing at the wrapper card's own field", async function (assert) {
    let e = await refusal({
      filter: { type: on },
      facets: [{ by: 'receipt.contentType' }],
    });
    assert.strictEqual(e.code, 'needs-declaration');
    assert.ok(
      [
        e.message.includes('links a file'),
        e.message.includes('computeVia'),
        e.message.includes('this.receipt?.contentType'),
      ].every(Boolean),
      e.message,
    );
    let { facets } = await meta({
      filter: { type: on },
      facets: [{ by: 'receiptType' }, { by: 'receipt' }],
    });
    assert.deepEqual(facets?.receiptType, [
      { value: 'text/markdown', count: 1 },
    ]);
    assert.deepEqual(
      facets?.receipt?.map((c) => [c.value, c.count]),
      [[`${testRealm}files/a.md`, 1]],
      'the link itself counts by id',
    );
  });

  test('holder types that declare a field as different kinds of value need a type anchor', async function (assert) {
    let e = await refusal({ facets: [{ by: 'code' }] });
    assert.strictEqual(e.code, 'needs-type');
    assert.true(
      ['Person: text', 'RushOrder: number'].every((t) => e.message.includes(t)),
      e.message,
    );
    let shaped = await meta({ facets: [{ by: 'code', stats: true }] });
    assert.deepEqual(
      shaped.facets?.code,
      [
        { value: '7', count: 1 },
        { value: 'A-1', count: 1 },
      ],
      'a query that names its shape counts each stored value',
    );
    let anchored = await meta({
      filter: { type: personRef },
      facets: [{ by: 'code' }],
    });
    assert.deepEqual(anchored.facets?.code, [{ value: 'A-1', count: 1 }]);
  });

  test('rows no resolvable type declares count as plain values; values held with no recorded type are refused', async function (assert) {
    let ghostRef = ref(`${testRealm}ghost`, 'Ghost');
    let ghostDef = def('card-def', ghostRef, { mood: prim(stringRef, facet) });
    let batch = await new IndexWriter(adapter).createBatch(
      new URL(testRealm),
      virtualNetwork,
      undefined,
      { splitPrerenderHtml: false },
    );
    let write = async (
      name: string,
      data: Record<string, unknown>,
      types: string[],
    ) => {
      let cardURL = new URL(`${testRealm}Ghost/${name}.json`);
      await batch.updateEntry(cardURL, {
        type: 'instance',
        resource: {
          id: rri(cardURL.href),
          type: 'card',
          attributes: {},
          meta: { adoptsFrom: { module: rri(ghostRef.module), name: 'Ghost' } },
        },
        lastModified: Date.now(),
        resourceCreatedAt: Date.now(),
        // Stamped with the type's declarations when written; the type's
        // module is gone now (the lookup knows no Ghost).
        searchData: await withFacetFields(data, ghostDef, async () => ghostDef),
        markdown: name,
        deps: new Set(),
        displayNames: types.length ? ['Ghost'] : [],
        types,
        isolatedHtml: '<div></div>',
      });
    };
    await write('g1', { mood: 'calm' }, [
      internalKeyFor(ghostRef, undefined, virtualNetwork),
    ]);
    await write('g2', { mood: 'calm', untyped: 'x' }, []);
    await batch.done();
    let { facets } = await meta({ facets: [{ by: 'mood' }] });
    assert.deepEqual(
      facets?.mood,
      [{ value: 'calm', count: 2 }],
      'the facet table rows count, whatever their type',
    );
    let e = await refusal({ facets: [{ by: 'untyped' }] });
    assert.strictEqual(e.code, 'needs-declaration');
    assert.true(e.message.includes('no recorded type'), e.message);
  });

  test('a value longer than 1,024 characters is not counted, as documented', async function (assert) {
    let batch = await new IndexWriter(adapter).createBatch(
      new URL(testRealm),
      virtualNetwork,
      undefined,
      { splitPrerenderHtml: false },
    );
    let cardURL = new URL(`${testRealm}Order/long.json`);
    await batch.updateEntry(cardURL, {
      type: 'instance',
      resource: {
        id: rri(cardURL.href),
        type: 'card',
        attributes: {},
        meta: { adoptsFrom: { module: rri(orderRef.module), name: 'Order' } },
      },
      lastModified: Date.now(),
      resourceCreatedAt: Date.now(),
      searchData: await withFacetFields(
        {
          cardTitle: 'L',
          status: 'x'.repeat(1025),
          tags: ['rush', 'y'.repeat(1024)],
        },
        orderDef,
        lookupDefinition,
      ),
      markdown: 'L',
      deps: new Set(),
      displayNames: ['Order'],
      types: [orderKey],
      isolatedHtml: '<div></div>',
    });
    await batch.done();
    let { facets, facetStats } = await meta({
      filter: { type: on },
      facets: [{ by: 'status', missing: true }, { by: 'tags' }],
    });
    assert.deepEqual(
      facets?.status,
      [
        { value: 'open', count: 3 },
        { value: 'closed', count: 1 },
      ],
      'the long status is not a value',
    );
    assert.strictEqual(
      facetStats?.status?.missing,
      2,
      'd, and the card whose only value was too long',
    );
    assert.deepEqual(
      facets?.tags?.map((c) => [c.value.length, c.count]),
      [
        [4, 3],
        [4, 1],
        [1024, 1],
      ],
      'exactly 1,024 characters still counts, beside the short values',
    );
  });

  test('a page past the last match is counted exactly whatever the total mode, facets or not', async function (assert) {
    for (let facets of [undefined, [{ by: 'status' }]]) {
      let { page } = await meta({
        filter: { type: on },
        page: { size: 2, number: 10, total: 'none' },
        ...(facets ? { facets } : {}),
      } as Query);
      assert.strictEqual(page.total, 5, `exact: ${JSON.stringify(facets)}`);
    }
  });

  test('declarations are inherited, and a facet over a base type reads where the field is declared', async function (assert) {
    let own = await meta({
      filter: { type: rushRef },
      facets: [{ by: 'status' }],
    });
    assert.deepEqual(own.facets?.status, [{ value: 'open', count: 1 }]);
    let sub = await meta({
      filter: { type: on },
      facets: [{ by: 'rushLevel', stats: true }],
    });
    assert.deepEqual(sub.facets?.rushLevel, [{ value: '2', count: 1 }]);
    let courier = await refusal({
      filter: { type: on },
      facets: [{ by: 'courier' }],
    });
    assert.strictEqual(courier.code, 'needs-declaration');
    assert.ok(
      [
        courier.message.includes('"courier"'),
        courier.message.includes('RushOrder'),
      ].every(Boolean),
      courier.message,
    );
    let untyped = await meta({ facets: [{ by: 'status' }] });
    assert.deepEqual(untyped.facets?.status, [
      { value: 'open', count: 3 },
      { value: 'closed', count: 1 },
    ]);
    let note = await refusal({ facets: [{ by: 'note' }] });
    assert.strictEqual(note.code, 'needs-declaration');
  });

  test('a change only to facet declarations is told apart from any other', function (assert) {
    let base = def('card-def', orderRef, orderFields);
    let undeclared = def('card-def', orderRef, {
      ...orderFields,
      status: prim(stringRef),
    });
    let relabeled = def('card-def', orderRef, {
      ...orderFields,
      status: prim(stringRef, { search: { facet: true, role: 'label' } }),
    });
    assert.true(onlyFacetDeclarationsDiffer(base, undeclared));
    assert.false(
      onlyFacetDeclarationsDiffer(base, relabeled),
      'a role changes the full-text vectors, so it needs the render',
    );
    assert.false(onlyFacetDeclarationsDiffer(base, base), 'no change at all');
    assert.true(
      onlyFacetDeclarationsDiffer(
        moneyDef,
        def('field-def', moneyRef, moneyFields(), { facetValue: 'amount' }),
      ),
      "a FieldDef's facetValue",
    );
  });

  test('a declaration-only change rewrites the facet table from the search docs', async function (assert) {
    let before = await meta({
      filter: { type: on },
      facets: [{ by: 'status' }, { by: 'tags' }],
    });
    // The type stops declaring `status`: its cards' rows for it go, with no
    // render, and the field is refused.
    orderDef = def('card-def', orderRef, {
      ...orderFields,
      status: prim(stringRef),
    });
    await backfillFacetValues(
      adapter,
      testRealm,
      orderKey,
      await facetFieldSpecsOf(orderDef, lookupDefinition),
    );
    let [{ n }] = (await adapter.execute(
      `SELECT COUNT(*)::int AS n FROM boxel_index_facet_values WHERE field_path = 'status' AND url NOT LIKE '%r1.json'`,
    )) as { n: number }[];
    assert.strictEqual(n, 0, "the Order cards' status rows are gone");
    let refused = await refusal({
      filter: { type: on },
      facets: [{ by: 'status' }],
    });
    assert.strictEqual(refused.code, 'needs-declaration');
    let tags = await meta({ filter: { type: on }, facets: [{ by: 'tags' }] });
    assert.deepEqual(tags.facets?.tags, before.facets?.tags, 'other rows stay');
    // Declared again: the rows come back from the search docs.
    orderDef = def('card-def', orderRef, orderFields);
    await backfillFacetValues(
      adapter,
      testRealm,
      orderKey,
      await facetFieldSpecsOf(orderDef, lookupDefinition),
    );
    let after = await meta({
      filter: { type: on },
      facets: [{ by: 'status' }, { by: 'tags' }],
    });
    assert.deepEqual(after.facets, before.facets);
  });

  test('value facets sharing a filter match separate requests', async function (assert) {
    let filter: Query['filter'] = {
      every: [{ type: on }, { on, eq: { status: 'open' } }],
    };
    let facets = [
      { by: 'tags', size: 2 },
      { by: 'status', size: 1 },
      { by: 'shipTo.city', size: 1 },
      { by: 'total', own: 'ignore', stats: true },
    ] satisfies NonNullable<Query['facets']>;
    let batch = await meta({ filter, facets, page: { size: 0 } });
    for (let facet of facets) {
      let single = await meta({ filter, facets: [facet], page: { size: 0 } });
      assert.deepEqual(
        batch.facets?.[facet.by],
        single.facets?.[facet.by],
        facet.by,
      );
      assert.deepEqual(
        batch.facetStats?.[facet.by],
        single.facetStats?.[facet.by],
      );
      assert.deepEqual(batch.page, single.page);
    }
  });

  // Proven once against the search-doc read this table replaced (batch O):
  // every kind below answered alike from both, then the search-doc read was
  // removed. These pin the answers.
  test('every facet kind counts from the facet table', async function (assert) {
    let { facets, facetStats } = await meta({
      filter: { type: on },
      facets: [
        { by: 'status', missing: true },
        { by: 'tags' },
        { by: 'total', stats: true },
        { by: 'placedAt' },
      ],
    });
    assert.deepEqual(facets?.status, [
      { value: 'open', count: 3 },
      { value: 'closed', count: 1 },
    ]);
    assert.strictEqual(facetStats?.status?.missing, 1, 'values');
    assert.deepEqual(facets?.tags, [
      { value: 'rush', count: 2 },
      { value: 'gift', count: 1 },
    ]);
    assert.deepEqual(
      [5, 100, 180, 36].map(
        (n, i) =>
          [
            facetStats?.total?.min,
            facetStats?.total?.max,
            facetStats?.total?.sum,
            facetStats?.total?.avg,
          ][i] === n,
      ),
      [true, true, true, true],
      'stats',
    );
    assert.deepEqual(facets?.placedAt, [
      { value: '2024-01-01', count: 1 },
      { value: '2024-02-01', count: 2 },
      { value: '2024-03-01', count: 2 },
    ]);
    let ranges = await meta({
      filter: { type: on },
      facets: [
        {
          by: 'total',
          ranges: [{ to: 10 }, { from: 10, to: 30 }, { key: 'big', from: 30 }],
        },
      ],
    });
    assert.deepEqual(ranges.facets?.total, [
      { value: '*-10', count: 1 },
      { value: '10-30', count: 2 },
      { value: 'big', count: 2 },
    ]);
    let ignore = await meta({
      filter: { every: [{ type: on }, { on, eq: { status: 'open' } }] },
      facets: [{ by: 'status', own: 'ignore' }, { by: 'tags' }],
    });
    assert.deepEqual(ignore.facets?.status, facets?.status, "own: 'ignore'");
    assert.deepEqual(ignore.facets?.tags, [
      { value: 'rush', count: 2 },
      { value: 'gift', count: 1 },
    ]);
    let measured = await meta({
      filter: { type: on },
      facets: [{ by: 'status', measure: { avg: 'total' }, order: 'measure' }],
    });
    assert.deepEqual(measured.facets?.status, [
      { value: 'open', count: 3, measure: { avg: 45 } },
      { value: 'closed', count: 1, measure: { avg: 40 } },
    ]);
    let countsOnly = await meta({
      filter: { type: on },
      page: { size: 0 },
      facets: [{ by: 'tags', missing: true }],
    });
    assert.strictEqual(countsOnly.facetStats?.tags?.missing, 3, 'c, d and r1');
  });
});
