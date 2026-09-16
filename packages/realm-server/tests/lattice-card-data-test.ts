import QUnit from 'qunit';
import { basename } from 'node:path';
import { bxl, getBxlComputeDefinition } from '@cardstack/bxl';
import { rri } from '@cardstack/runtime-common/realm-identifiers';
import type {
  Definition,
  FieldDefinition,
} from '@cardstack/runtime-common/definitions';
import { LatticeBxlWorker } from '../lib/lattice-bxl-derivation.ts';
import { assembleLatticeCardData } from '../lib/lattice-card-data.ts';
import type { LatticeDefinitionSnapshot } from '../lib/lattice-card-data.ts';

const { module, test } = QUnit;
const ref = (name: string) => ({
  module: rri('https://example.com/definitions'),
  name,
});
const text: FieldDefinition = {
  type: 'contains',
  isPrimitive: true,
  isComputed: false,
  fieldOrCard: ref('Text'),
  nativeCodec: { kind: 'primitive', scalar: 'string' },
};
const number: FieldDefinition = {
  ...text,
  fieldOrCard: ref('Number'),
  serializerName: 'number',
  nativeCodec: { kind: 'primitive', serializer: 'number' },
};
const date: FieldDefinition = {
  ...text,
  fieldOrCard: ref('Date'),
  serializerName: 'date',
  nativeCodec: { kind: 'primitive', serializer: 'date' },
};
const compound = (name: string, plural = false): FieldDefinition => ({
  type: plural ? 'containsMany' : 'contains',
  isPrimitive: false,
  isComputed: false,
  fieldOrCard: ref(name),
  nativeCodec: { kind: 'compound' },
});
const expression = (source: string) =>
  getBxlComputeDefinition(
    bxl(source, { readableSyntax: false, libraries: ['core'] }),
  )!;
function snapshot(
  name: string,
  fields: Record<string, FieldDefinition>,
  card = false,
): LatticeDefinitionSnapshot {
  const definition: Definition = {
    type: card ? 'card-def' : 'field-def',
    codeRef: ref(name),
    displayName: name,
    fields: Object.fromEntries(Object.keys(fields).map((name) => [name, name])),
    fieldDefs: fields,
    nativeCodec: {
      kind: 'compound',
      ...(card ? { resourceType: 'card' as const } : {}),
    },
  };
  return { definition, revision: `${name}-v1` };
}
function fixtures() {
  const root = snapshot(
    'Tally',
    {
      id: text,
      rows: compound('Row', true),
      note: text,
      student: {
        ...compound('Student'),
        type: 'linksTo',
        nativeCodec: { kind: 'compound', resourceType: 'card' },
      },
      cardInfo: compound('Info'),
      total: {
        ...number,
        isComputed: true,
        bxl: expression('[.rows[]? | .score // 0] | add // 0'),
      },
      cardTitle: { ...text, isComputed: true, baseCompute: 'cardTitle' },
      cardDescription: {
        ...text,
        isComputed: true,
        baseCompute: 'cardDescription',
      },
    },
    true,
  );
  const children = [
    snapshot('Row', { score: number, label: text }),
    snapshot('Info', { name: text, summary: text }),
  ];
  const byRef = new Map(
    children.map((snapshot) => [
      JSON.stringify(snapshot.definition.codeRef),
      snapshot,
    ]),
  );
  return {
    root,
    lookup: async (ref: unknown) => {
      const snapshot = byRef.get(JSON.stringify(ref));
      if (!snapshot) throw new Error('Not a cached contained definition');
      return snapshot;
    },
  };
}
const id = 'https://example.com/Tally/one';
const resolve = (reference: string, relativeTo: string) =>
  new URL(reference, relativeTo).href;
function source(attributes: object) {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes,
      relationships: { student: { links: { self: './student' } } },
      meta: { adoptsFrom: ref('Tally') },
    },
  });
}
const json = (value: unknown) => JSON.parse(JSON.stringify(value));

module(basename(import.meta.filename), function (hooks) {
  let worker: LatticeBxlWorker;
  hooks.beforeEach(function () {
    worker = new LatticeBxlWorker();
  });
  hooks.afterEach(async function () {
    await worker.close();
  });

  test('normalizes source values, computes, and emits the full shallow card and search document', async function (assert) {
    const result = await assembleLatticeCardData({
      id,
      sourceRevision: 'source-v2',
      sourceJSON: source({
        rows: [
          { score: '6', label: 'First' },
          { score: 'not-a-number', label: 'Blank' },
        ],
        cardInfo: { name: 'Example', summary: 'Summary' },
        total: 999,
        undeclared: 'discard me',
      }),
      ...fixtures(),
      resolve,
      worker,
    });
    assert.deepEqual(json(result.serialized), {
      data: {
        type: 'card',
        id,
        attributes: {
          rows: [
            { score: 6, label: 'First' },
            { score: null, label: 'Blank' },
          ],
          note: null,
          cardInfo: { name: 'Example', summary: 'Summary' },
          total: 6,
          cardTitle: 'Example',
          cardDescription: 'Summary',
        },
        relationships: {
          student: {
            links: { self: './student' },
            data: { type: 'card', id: './student' },
          },
        },
        meta: { adoptsFrom: ref('Tally') },
      },
    });
    assert.deepEqual(json(result.searchDoc), {
      id,
      rows: [{ score: 6, label: 'First' }, { label: 'Blank' }],
      student: { id: 'https://example.com/Tally/student' },
      cardInfo: { name: 'Example', summary: 'Summary' },
      total: 6,
      cardTitle: 'Example',
      cardDescription: 'Summary',
    });
    assert.strictEqual(result.sourceRevision, 'source-v2');
    assert.deepEqual(
      result.definitionRevisions.map((item) => item.revision),
      ['Tally-v1', 'Row-v1', 'Info-v1'],
    );
  });

  test("a contained definition's own computeds run per node, feed the holder, and grain the card", async function (assert) {
    // Row.weighted is a FieldDef computed (BXL) with a clock grain; the card's
    // total reads the computed values of its rows.
    const { root, lookup } = fixtures();
    const row = await lookup(ref('Row'));
    const weightedRow: LatticeDefinitionSnapshot = {
      definition: {
        ...row.definition,
        fields: {
          ...row.definition.fields,
          when: 'when',
          whenText: 'whenText',
          weighted: 'weighted',
        },
        fieldDefs: {
          ...row.definition.fieldDefs,
          when: date,
          // Programs read a date field as the calendar date string.
          whenText: {
            ...text,
            isComputed: true,
            bxl: expression('.when // ""'),
          },
          weighted: {
            ...number,
            isComputed: true,
            bxl: getBxlComputeDefinition(
              bxl('(.score // 0) * 2', {
                readableSyntax: false,
                libraries: ['core'],
                validUntil: '.__clock.today',
              }),
            )!,
          },
        },
      },
      revision: 'Row-v2',
    };
    const total = root.definition.fieldDefs.total;
    const nestedRoot: LatticeDefinitionSnapshot = {
      ...root,
      definition: {
        ...root.definition,
        fieldDefs: {
          ...root.definition.fieldDefs,
          total: {
            ...total,
            bxl: expression('[.rows[]? | .weighted // 0] | add // 0'),
          },
        },
      },
    };
    const result = await assembleLatticeCardData({
      id,
      sourceRevision: 'source-v3',
      sourceJSON: source({
        rows: [
          { score: '6', label: 'First', weighted: 999, when: '2026-01-05' },
          { score: 'not-a-number', label: 'Blank' },
        ],
        cardInfo: { name: 'Example', summary: 'Summary' },
      }),
      root: nestedRoot,
      lookup: async (target: unknown) =>
        JSON.stringify(target) === JSON.stringify(ref('Row'))
          ? weightedRow
          : lookup(target),
      resolve,
      worker,
    });
    assert.deepEqual(json(result.serialized).data.attributes.rows, [
      {
        score: 6,
        label: 'First',
        when: '2026-01-05',
        whenText: '2026-01-05',
        weighted: 12,
      },
      { score: null, label: 'Blank', when: null, whenText: '', weighted: 0 },
    ]);
    assert.strictEqual(json(result.serialized).data.attributes.total, 12);
    assert.deepEqual(json(result.searchDoc).rows, [
      {
        score: 6,
        label: 'First',
        when: '2026-01-05',
        whenText: '2026-01-05',
        weighted: 12,
      },
      { label: 'Blank', whenText: '', weighted: 0 },
    ]);
    assert.strictEqual(typeof result.validUntil, 'string');
    assert.true(
      (result.validUntil ?? '') > new Date().toISOString().slice(0, 10),
      `the row grain (end of today) becomes the card's valid_until: ${result.validUntil}`,
    );
    assert.deepEqual(
      result.definitionRevisions.map((item) => item.revision),
      ['Tally-v1', 'Row-v2', 'Info-v1'],
    );
  });

  test('an empty collection serializes as an array but indexes as null', async function (assert) {
    const result = await assembleLatticeCardData({
      id,
      sourceRevision: 's1',
      sourceJSON: source({}),
      ...fixtures(),
      resolve,
      worker,
    });
    assert.deepEqual(result.serialized.data.attributes.rows, []);
    assert.strictEqual(result.searchDoc.rows, null);
    assert.deepEqual(result.serialized.data.attributes.cardInfo, {
      name: null,
      summary: null,
    });
    assert.strictEqual(
      result.serialized.data.attributes.cardTitle,
      'Untitled Tally',
    );
  });

  test('JSON fields preserve authored and computed data without copying it into search', async function (assert) {
    const options = fixtures();
    const jsonField: FieldDefinition = {
      ...text,
      nativeCodec: { kind: 'json' },
    };
    Object.assign(options.root.definition.fields, {
      identity: 'identity',
      day: 'day',
      keys: 'keys',
    });
    Object.assign(options.root.definition.fieldDefs, {
      identity: jsonField,
      day: {
        ...jsonField,
        isComputed: true,
        bxl: expression(
          '{roster: .identity.roster, nested: {done: .total}, absent: .identity.missing}',
        ),
      },
      keys: {
        ...text,
        type: 'containsMany',
        isComputed: true,
        bxl: expression('[.identity.roster[] | .name]'),
      },
    });
    const result = await assembleLatticeCardData({
      id,
      sourceRevision: 'json-source-1',
      sourceJSON: source({
        rows: [{ score: 4 }],
        identity: {
          roster: [
            { name: 'Avery', flag: true },
            { name: 'Riley', other: [1, null, 'two'] },
          ],
        },
      }),
      ...options,
      resolve,
      worker,
    });
    assert.deepEqual(result.serialized.data.attributes.day, {
      roster: [
        { name: 'Avery', flag: true },
        { name: 'Riley', other: [1, null, 'two'] },
      ],
      nested: { done: 4 },
      absent: null,
    });
    assert.deepEqual(result.serialized.data.attributes.keys, [
      'Avery',
      'Riley',
    ]);
    assert.strictEqual(result.searchDoc.identity, null);
    assert.strictEqual(result.searchDoc.day, null);
    assert.deepEqual(result.searchDoc.keys, ['Avery', 'Riley']);
  });

  test('blank JSON and contained JSON arrays use the ordinary null boundary', async function (assert) {
    const options = fixtures();
    Object.assign(options.root.definition.fields, {
      blank: 'blank',
      items: 'items',
    });
    Object.assign(options.root.definition.fieldDefs, {
      blank: { ...text, nativeCodec: { kind: 'json' } },
      items: { ...text, type: 'containsMany', nativeCodec: { kind: 'json' } },
    });
    const result = await assembleLatticeCardData({
      id,
      sourceRevision: 'json-source-2',
      sourceJSON: source({ items: [{ a: 1 }, null, [2, 3]] }),
      ...options,
      resolve,
      worker,
    });
    assert.strictEqual(result.serialized.data.attributes.blank, null);
    assert.deepEqual(result.serialized.data.attributes.items, [
      { a: 1 },
      null,
      [2, 3],
    ]);
    assert.strictEqual(result.searchDoc.blank, null);
    assert.strictEqual(result.searchDoc.items, null);
  });

  test('a relationship identity cannot silently stand in for missing target data', async function (assert) {
    const options = fixtures();
    options.root.definition.fieldDefs.total.bxl = expression(
      '.student.name | length',
    );
    await assert.rejects(
      assembleLatticeCardData({
        id,
        sourceRevision: 's1',
        sourceJSON: source({}),
        ...options,
        resolve,
        worker,
      }),
      /Unadmitted computed input/,
    );
  });

  test('custom value hooks and unresolved searchable links are declined', async function (assert) {
    const options = fixtures();
    options.root.definition.fieldDefs.note = {
      ...text,
      nativeCodec: undefined,
    };
    await assert.rejects(
      assembleLatticeCardData({
        id,
        sourceRevision: 's1',
        sourceJSON: source({}),
        ...options,
        resolve,
        worker,
      }),
      /Unadmitted field codec: note/,
    );
    options.root.definition.fieldDefs.note = text;
    options.root.definition.fieldDefs.student.searchable = true;
    await assert.rejects(
      assembleLatticeCardData({
        id,
        sourceRevision: 's1',
        sourceJSON: source({}),
        ...options,
        resolve,
        worker,
      }),
      /membership is not resolved/,
    );
  });
});
