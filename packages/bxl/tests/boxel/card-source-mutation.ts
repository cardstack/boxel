import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert';
import {
  BxlMutationError,
  EMPTY_OVERLAY_INDEX,
  applyBxlMutationPlanToCardSource,
  mutateBxlCardSource,
  mutationSchemaForCardSource,
  prepareBxlMutation,
  snapshotBxlCardSource,
  type BxlBoxelSourceDefinition,
  type BxlCardSourceDocument,
  type BxlCardSourceRelationship,
  mergeBxlMutationOverlays,
  type BxlMutationOverlays,
  type BxlMutationReadEvent,
} from '../../src/mutation/index.ts';

// A resource's `relationships` map holds either a single relationship or an
// array of them. Every assertion below is about a single one, addressed by its
// full dotted key, so this narrows and fails loudly on anything else.
function relationship(
  document: BxlCardSourceDocument,
  key: string,
): BxlCardSourceRelationship {
  const value = document.data.relationships?.[key];
  if (value === undefined || Array.isArray(value)) {
    throw new Error(`expected a single relationship at "${key}"`);
  }
  return value;
}

const ref = (name: string) => ({ module: 'https://example.test/types', name });
const field = (
  type: 'contains' | 'containsMany' | 'linksTo' | 'linksToMany',
  name: string,
  options: { primitive?: boolean; computed?: boolean; query?: unknown } = {},
) => ({
  type,
  isPrimitive: options.primitive ?? false,
  isComputed: options.computed ?? false,
  fieldOrCard: ref(name),
  ...(options.query === undefined ? {} : { query: options.query }),
});

const cardInfoDefinition: BxlBoxelSourceDefinition = {
  type: 'field-def',
  codeRef: ref('CardInfo'),
  displayName: 'Card Info',
  fields: { name: 'f0', theme: 'f1' },
  fieldDefs: {
    f0: field('contains', 'String', { primitive: true }),
    f1: field('linksTo', 'Theme'),
  },
};

const themeDefinition: BxlBoxelSourceDefinition = {
  type: 'card-def',
  codeRef: ref('Theme'),
  displayName: 'Theme',
  fields: {},
  fieldDefs: {},
};

const tierItemDefinition: BxlBoxelSourceDefinition = {
  type: 'card-def',
  codeRef: ref('TierItem'),
  displayName: 'Tier Item',
  fields: {
    id: 'f0',
    cardInfo: 'f1',
    image: 'f2',
    tags: 'f3',
    computedLabel: 'f4',
    recommendations: 'f5',
  },
  fieldDefs: {
    f0: field('contains', 'String', { primitive: true }),
    f1: field('contains', 'CardInfo'),
    f2: field('contains', 'String', { primitive: true }),
    f3: field('containsMany', 'String', { primitive: true }),
    f4: field('contains', 'String', { primitive: true, computed: true }),
    f5: field('linksToMany', 'TierItem', { query: { filter: {} } }),
  },
};

const definitions = new Map(
  [cardInfoDefinition, themeDefinition, tierItemDefinition].map(
    (definition) => [JSON.stringify(definition.codeRef), definition],
  ),
);

const schema = await mutationSchemaForCardSource(tierItemDefinition, {
  async lookupDefinition(codeRef) {
    return definitions.get(JSON.stringify(codeRef));
  },
});

const promotedTheme = schema.fields.find((entry) => entry.key === 'theme');
strictEqual(promotedTheme?.label, 'Theme');
deepStrictEqual(promotedTheme?.path, ['cardInfo', 'theme']);
strictEqual(
  schema.fields.find((entry) => entry.key === 'recommendations')?.writable,
  false,
);
strictEqual(
  schema.fields.find((entry) => entry.key === 'computedLabel')?.writeBehavior,
  'skip',
);

function sourceFixture(): BxlCardSourceDocument {
  return {
    jsonapi: { version: '1.1' },
    data: {
      type: 'card',
      attributes: {
        cardInfo: {
          name: 'TypeScript',
          untouchedNested: 'preserve me',
        },
        image: 'https://example.test/typescript.svg',
        tags: ['language', 'web'],
        unknownAuthoredField: { preserve: true },
      },
      relationships: {
        'cardInfo.theme': {
          links: { self: '../Theme/original', related: 'preserve-related' },
          data: { type: 'card', id: 'stale-served-id' },
          meta: { preserve: true },
          extension: { preserve: true },
        },
        unknownRelationship: {
          links: { self: '../Other/untouched' },
          meta: { preserve: true },
        },
      },
      meta: {
        adoptsFrom: { module: '../tier-item', name: 'TierItem' },
        fields: {
          cardInfo: {
            adoptsFrom: { module: '../card-info', name: 'CardInfo' },
          },
        },
        custom: { preserve: true },
      },
    },
    included: [
      {
        type: 'card',
        id: 'https://example.test/included',
        meta: { adoptsFrom: ref('Included') },
      },
    ],
    customDocumentMember: { preserve: true },
  };
}

const projectionOptions = {
  targetId: 'https://example.test/TierItem/typescript',
  resolveReference(reference: string) {
    return new URL(reference, 'https://example.test/TierItem/typescript').href;
  },
};

deepStrictEqual(
  snapshotBxlCardSource(sourceFixture(), schema, projectionOptions),
  {
    id: 'https://example.test/TierItem/typescript',
    cardInfo: {
      name: 'TypeScript',
      theme: { id: 'https://example.test/Theme/original' },
    },
    image: 'https://example.test/typescript.svg',
    tags: ['language', 'web'],
    computedLabel: null,
    recommendations: [],
  },
);

const original = sourceFixture();
const before = structuredClone(original);
const darkTheme = 'https://example.test/Theme/dark';
const result = mutateBxlCardSource(
  original,
  '.cardInfo.name = "C#";\n' +
    '.image = "https://cdn.example.test/csharp.svg";\n' +
    `.cardInfo.theme = card(${JSON.stringify(darkTheme)});`,
  {
    schema,
    syntax: 'solidified',
    programId: 'create-card-after-clone',
    ...projectionOptions,
    resolveCard(id) {
      return id === darkTheme ? { id } : undefined;
    },
    formatReference(id) {
      return id === darkTheme ? '../Theme/dark' : id;
    },
  },
);

deepStrictEqual(original, before, 'the input source document is immutable');
strictEqual(
  (result.document.data.attributes?.cardInfo as Record<string, unknown>).name,
  'C#',
);
strictEqual(
  result.document.data.attributes?.image,
  'https://cdn.example.test/csharp.svg',
);
deepStrictEqual(result.document.data.relationships?.['cardInfo.theme'], {
  links: { self: '../Theme/dark', related: 'preserve-related' },
  meta: { preserve: true },
  extension: { preserve: true },
});
deepStrictEqual(
  result.document.data.relationships?.unknownRelationship,
  before.data.relationships?.unknownRelationship,
);
deepStrictEqual(result.document.data.meta, before.data.meta);
deepStrictEqual(result.document.included, before.included);
deepStrictEqual(
  result.document.customDocumentMember,
  before.customDocumentMember,
);
deepStrictEqual(result.plan.paths, [
  ['cardInfo', 'name'],
  ['image'],
  ['cardInfo', 'theme'],
]);

const structuralSource = sourceFixture();
const structuralResult = mutateBxlCardSource(
  structuralSource,
  'append(.tags; "native");',
  {
    schema,
    syntax: 'solidified',
    programId: 'source-structure',
    ...projectionOptions,
  },
);
deepStrictEqual(structuralResult.document.data.attributes?.tags, [
  'language',
  'web',
  'native',
]);
deepStrictEqual(structuralSource, sourceFixture());

const partDefinition: BxlBoxelSourceDefinition = {
  type: 'field-def',
  codeRef: ref('Part'),
  displayName: 'Part',
  fields: { key: 'f0', owner: 'f1' },
  fieldDefs: {
    f0: field('contains', 'String', { primitive: true }),
    f1: field('linksTo', 'Friend'),
  },
};

const exampleDefinition: BxlBoxelSourceDefinition = {
  type: 'field-def',
  codeRef: ref('Example'),
  displayName: 'Example',
  fields: {
    key: 'f0',
    label: 'f1',
    friend: 'f2',
    aliases: 'f3',
    parts: 'f4',
  },
  fieldDefs: {
    f0: field('contains', 'String', { primitive: true }),
    f1: field('contains', 'String', { primitive: true }),
    f2: field('linksTo', 'Friend'),
    f3: field('containsMany', 'String', { primitive: true }),
    f4: field('containsMany', 'Part'),
  },
};

const specLikeDefinition: BxlBoxelSourceDefinition = {
  type: 'card-def',
  codeRef: ref('SpecLike'),
  displayName: 'Spec Like',
  fields: { examples: 'f0', codes: 'f1', linked: 'f2' },
  fieldDefs: {
    f0: field('containsMany', 'Example'),
    f1: field('containsMany', 'String', { primitive: true }),
    f2: field('linksToMany', 'Friend'),
  },
};

const richDefinitions = new Map(
  [partDefinition, exampleDefinition, specLikeDefinition].map((definition) => [
    JSON.stringify(definition.codeRef),
    definition,
  ]),
);
const richSchema = await mutationSchemaForCardSource(specLikeDefinition, {
  async lookupDefinition(codeRef) {
    return richDefinitions.get(JSON.stringify(codeRef));
  },
});

function richSourceFixture(): BxlCardSourceDocument {
  return {
    data: {
      type: 'card',
      attributes: {
        examples: [
          {
            key: 'a',
            label: 'Alpha',
            aliases: ['A-one', 'A-two'],
            parts: [{ key: 'p1' }, { key: 'p2' }],
          },
          { key: 'b', label: 'Beta', aliases: [], parts: [] },
          { key: 'c', label: 'Gamma', aliases: [], parts: [] },
        ],
        codes: ['one', 'two', 'three'],
      },
      relationships: {
        'examples.0.friend': {
          links: { self: '../Friend/a', related: 'keep-a' },
          meta: { slot: 'a' },
        },
        'examples.1.friend': {
          links: { self: '../Friend/b', related: 'keep-b' },
          meta: { slot: 'b' },
        },
        'examples.2.friend': {
          links: { self: '../Friend/c', related: 'keep-c' },
          meta: { slot: 'c' },
        },
        'examples.0.parts.0.owner': {
          links: { self: '../Friend/part-1' },
          meta: { part: 'p1' },
        },
        'examples.0.parts.1.owner': {
          links: { self: '../Friend/part-2' },
          meta: { part: 'p2' },
        },
        'linked.0': {
          links: { self: '../Friend/a', related: 'linked-a' },
          meta: { edge: 'a' },
        },
        'linked.1': {
          links: { self: '../Friend/b', related: 'linked-b' },
          meta: { edge: 'b' },
        },
        'linked.2': {
          links: { self: '../Friend/c', related: 'linked-c' },
          meta: { edge: 'c' },
        },
      },
      meta: {
        adoptsFrom: ref('SpecLike'),
        fields: {
          examples: [
            {
              adoptsFrom: { module: '../fields', name: 'AlphaExample' },
              fields: {
                label: {
                  adoptsFrom: { module: '../fields', name: 'FancyString' },
                },
                'aliases.0': {
                  adoptsFrom: { module: '../fields', name: 'FirstAlias' },
                },
                'aliases.1': {
                  adoptsFrom: { module: '../fields', name: 'SecondAlias' },
                },
                parts: [
                  {
                    adoptsFrom: { module: '../fields', name: 'FirstPart' },
                  },
                  {
                    adoptsFrom: { module: '../fields', name: 'SecondPart' },
                  },
                ],
              },
            },
            {
              adoptsFrom: { module: '../fields', name: 'BetaExample' },
              custom: { preserve: 'beta' },
            },
            {
              adoptsFrom: { module: '../fields', name: 'GammaExample' },
              fields: {
                label: {
                  adoptsFrom: { module: '../fields', name: 'MarkdownString' },
                },
              },
            },
          ],
          'codes.0': {
            adoptsFrom: { module: '../fields', name: 'FirstCode' },
          },
          'codes.2': {
            adoptsFrom: { module: '../fields', name: 'ThirdCode' },
          },
        },
        extension: { preserve: true },
      },
    },
  };
}

const richProjectionOptions = {
  targetId: 'https://example.test/SpecLike/one',
  resolveReference(reference: string) {
    return new URL(reference, 'https://example.test/SpecLike/one').href;
  },
  formatReference(id: string) {
    return id.replace('https://example.test/', '../');
  },
};

const moved = mutateBxlCardSource(
  richSourceFixture(),
  'move_item_to_start(.examples[2]; .examples);',
  {
    schema: richSchema,
    syntax: 'solidified',
    programId: 'move-composite-with-sidecars',
    ...richProjectionOptions,
  },
).document;
deepStrictEqual(
  (moved.data.attributes?.examples as Array<Record<string, unknown>>).map(
    (item) => item.key,
  ),
  ['c', 'a', 'b'],
);
deepStrictEqual(
  (
    (moved.data.meta?.fields as Record<string, unknown>).examples as Array<
      Record<string, unknown>
    >
  ).map((item) => (item.adoptsFrom as Record<string, unknown>).name),
  ['GammaExample', 'AlphaExample', 'BetaExample'],
);
strictEqual(relationship(moved, 'examples.0.friend').meta?.slot, 'c');
strictEqual(relationship(moved, 'examples.1.friend').links?.related, 'keep-a');

function assertExampleSidecarsAligned(document: BxlCardSourceDocument): void {
  const values = document.data.attributes?.examples as Array<
    Record<string, unknown>
  >;
  const metas = (document.data.meta?.fields as Record<string, unknown>)
    .examples as Array<Record<string, Record<string, unknown>>>;
  const typeForKey: Record<string, string> = {
    a: 'AlphaExample',
    b: 'BetaExample',
    c: 'GammaExample',
    z: 'ZetaExample',
  };
  values.forEach((value, index) => {
    const key = value.key as string;
    strictEqual(metas[index].adoptsFrom.name, typeForKey[key]);
    strictEqual(
      relationship(document, `examples.${index}.friend`).meta?.slot,
      key,
    );
  });
  strictEqual(
    Object.keys(document.data.relationships ?? {}).some((key) => {
      const match = /^examples\.(\d+)\.friend$/.exec(key);
      return match ? Number(match[1]) >= values.length : false;
    }),
    false,
  );
}

for (const index of [0, 1, 2]) {
  const document = mutateBxlCardSource(
    richSourceFixture(),
    `del(.examples[${index}]);`,
    {
      schema: richSchema,
      syntax: 'solidified',
      programId: `delete-index-${index}`,
      ...richProjectionOptions,
    },
  ).document;
  assertExampleSidecarsAligned(document);
}

for (const order of [
  ['a', 'b', 'c'],
  ['a', 'c', 'b'],
  ['b', 'a', 'c'],
  ['b', 'c', 'a'],
  ['c', 'a', 'b'],
  ['c', 'b', 'a'],
]) {
  const document = mutateBxlCardSource(
    richSourceFixture(),
    `reorder_by(.examples; .key; ${JSON.stringify(order)});`,
    {
      schema: richSchema,
      syntax: 'solidified',
      programId: `reorder-${order.join('')}`,
      ...richProjectionOptions,
    },
  ).document;
  assertExampleSidecarsAligned(document);
}

for (const index of [0, 1, 2, 3]) {
  const document = mutateBxlCardSource(
    richSourceFixture(),
    `insert_at(.examples; ${index}; {"key":"z","label":"Zeta","aliases":[],"parts":[]});`,
    {
      schema: richSchema,
      syntax: 'solidified',
      programId: `insert-index-${index}`,
      baseRevision: 'revision-1',
      ...richProjectionOptions,
      serializeContainedValue(context) {
        if (context.path.at(-1) !== index) return undefined;
        return {
          meta: { adoptsFrom: { module: '../fields', name: 'ZetaExample' } },
          relationships: {
            friend: {
              links: { self: '../Friend/z' },
              meta: { slot: 'z' },
            },
          },
        };
      },
    },
  ).document;
  assertExampleSidecarsAligned(document);
}

assertExampleSidecarsAligned(
  mutateBxlCardSource(
    richSourceFixture(),
    'move_item_to_end(.examples[0]; .examples);',
    {
      schema: richSchema,
      syntax: 'solidified',
      programId: 'move-first-to-end',
      ...richProjectionOptions,
    },
  ).document,
);

const nested = mutateBxlCardSource(
  richSourceFixture(),
  'del(.examples[0].aliases[0]);\n' +
    'move_item_to_start(.examples[0].parts[1]; .examples[0].parts);',
  {
    schema: richSchema,
    syntax: 'solidified',
    programId: 'nested-collection-sidecars',
    ...richProjectionOptions,
  },
).document;
deepStrictEqual(
  (nested.data.attributes?.examples as Array<Record<string, unknown>>)[0]
    .aliases,
  ['A-two'],
);
const nestedFields = (
  (nested.data.meta?.fields as Record<string, unknown>).examples as Array<
    Record<string, unknown>
  >
)[0].fields as Record<string, unknown>;
strictEqual(nestedFields['aliases.1'], undefined);
strictEqual(
  (nestedFields['aliases.0'] as Record<string, Record<string, unknown>>)
    .adoptsFrom.name,
  'SecondAlias',
);
strictEqual(
  (nestedFields.parts as Array<Record<string, Record<string, unknown>>>)[0]
    .adoptsFrom.name,
  'SecondPart',
);
strictEqual(relationship(nested, 'examples.0.parts.0.owner').meta?.part, 'p2');
strictEqual(relationship(nested, 'examples.0.parts.1.owner').meta?.part, 'p1');

const deleted = mutateBxlCardSource(
  richSourceFixture(),
  'del(.examples[1]);\ndel(.codes[1]);',
  {
    schema: richSchema,
    syntax: 'solidified',
    programId: 'delete-and-renumber-sidecars',
    ...richProjectionOptions,
  },
).document;
deepStrictEqual(deleted.data.attributes?.codes, ['one', 'three']);
deepStrictEqual(
  Object.keys(deleted.data.meta?.fields as Record<string, unknown>).sort(),
  ['codes.0', 'codes.1', 'examples'],
);
strictEqual(
  (
    (deleted.data.meta?.fields as Record<string, unknown>)['codes.1'] as Record<
      string,
      Record<string, unknown>
    >
  ).adoptsFrom.name,
  'ThirdCode',
);
strictEqual(relationship(deleted, 'examples.1.friend').meta?.slot, 'c');
strictEqual(deleted.data.relationships?.['examples.2.friend'], undefined);

const reordered = mutateBxlCardSource(
  richSourceFixture(),
  'reorder_by(.examples; .key; ["b", "c", "a"]);',
  {
    schema: richSchema,
    syntax: 'solidified',
    programId: 'reorder-all-sidecars',
    ...richProjectionOptions,
  },
).document;
deepStrictEqual(
  (reordered.data.attributes?.examples as Array<Record<string, unknown>>).map(
    (item) => item.key,
  ),
  ['b', 'c', 'a'],
);
strictEqual(relationship(reordered, 'examples.0.friend').meta?.slot, 'b');
strictEqual(
  (
    (
      (reordered.data.meta?.fields as Record<string, unknown>)
        .examples as Array<Record<string, unknown>>
    )[1].fields as Record<string, Record<string, Record<string, unknown>>>
  ).label.adoptsFrom.name,
  'MarkdownString',
);

const inserted = mutateBxlCardSource(
  richSourceFixture(),
  'prepend(.examples; {"key":"z","label":"Zeta"});\n' +
    'append(.codes; "four");',
  {
    schema: richSchema,
    syntax: 'solidified',
    programId: 'insert-polymorphic-sidecars',
    ...richProjectionOptions,
    serializeContainedValue(context) {
      if (context.path[0] === 'examples') {
        return {
          meta: {
            adoptsFrom: { module: '../fields', name: 'ZetaExample' },
            fields: {
              label: {
                adoptsFrom: { module: '../fields', name: 'LocalizedString' },
              },
            },
          },
          relationships: {
            friend: {
              links: { self: '../Friend/z' },
              meta: { slot: 'z' },
            },
          },
        };
      }
      return {
        meta: { adoptsFrom: { module: '../fields', name: 'FourthCode' } },
      };
    },
  },
).document;
strictEqual(
  (
    (
      (inserted.data.meta?.fields as Record<string, unknown>).examples as Array<
        Record<string, unknown>
      >
    )[0].adoptsFrom as Record<string, unknown>
  ).name,
  'ZetaExample',
);
strictEqual(relationship(inserted, 'examples.0.friend').meta?.slot, 'z');
strictEqual(relationship(inserted, 'examples.1.friend').meta?.slot, 'a');
strictEqual(
  (
    (inserted.data.meta?.fields as Record<string, unknown>)[
      'codes.3'
    ] as Record<string, Record<string, unknown>>
  ).adoptsFrom.name,
  'FourthCode',
);

throws(
  () =>
    mutateBxlCardSource(
      richSourceFixture(),
      'append(.examples; {"key":"unsafe","label":"Missing type"});',
      {
        schema: richSchema,
        syntax: 'solidified',
        programId: 'reject-untyped-polymorphic-insert',
        ...richProjectionOptions,
      },
    ),
  (error) =>
    error instanceof BxlMutationError &&
    error.code === 'card-source-contained-meta-required',
);

const copied = mutateBxlCardSource(
  richSourceFixture(),
  'copy_value_to(.examples[0]; .examples[1]);\n' +
    'copy_value_to(.codes[1]; .codes[2]);',
  {
    schema: richSchema,
    syntax: 'solidified',
    programId: 'copy-values-and-sidecars',
    ...richProjectionOptions,
  },
).document;
strictEqual(
  (
    (
      (copied.data.meta?.fields as Record<string, unknown>).examples as Array<
        Record<string, unknown>
      >
    )[1].adoptsFrom as Record<string, unknown>
  ).name,
  'AlphaExample',
);
strictEqual(relationship(copied, 'examples.1.friend').meta?.slot, 'a');
strictEqual(
  (
    (copied.data.meta?.fields as Record<string, unknown>)['codes.2'] as Record<
      string,
      Record<string, unknown>
    >
  ).adoptsFrom.name,
  'ThirdCode',
  'copying a primitive value preserves the destination Field override',
);

const replacedCollections = mutateBxlCardSource(
  richSourceFixture(),
  '.examples = [{"key":"n","label":"New","aliases":[],"parts":[]}];\n' +
    '.codes = ["new-code"];',
  {
    schema: richSchema,
    syntax: 'solidified',
    programId: 'replace-complete-collections',
    ...richProjectionOptions,
    serializeContainedValue(context) {
      if (context.path[0] === 'examples') {
        return {
          meta: { adoptsFrom: { module: '../fields', name: 'NewExample' } },
          relationships: {
            friend: { links: { self: '../Friend/new' } },
          },
        };
      }
      return {
        meta: { adoptsFrom: { module: '../fields', name: 'NewCode' } },
      };
    },
  },
).document;
strictEqual(
  (
    (replacedCollections.data.meta?.fields as Record<string, unknown>)
      .examples as Array<Record<string, Record<string, unknown>>>
  )[0].adoptsFrom.name,
  'NewExample',
);
strictEqual(
  (
    (replacedCollections.data.meta?.fields as Record<string, unknown>)[
      'codes.0'
    ] as Record<string, Record<string, unknown>>
  ).adoptsFrom.name,
  'NewCode',
);
strictEqual(
  relationship(replacedCollections, 'examples.0.friend').links?.self,
  '../Friend/new',
);
strictEqual(
  replacedCollections.data.relationships?.['examples.1.friend'],
  undefined,
);

const deletedPrimitiveLeaf = mutateBxlCardSource(
  richSourceFixture(),
  'del(.examples[0]["label"]);',
  {
    schema: richSchema,
    syntax: 'solidified',
    programId: 'delete-primitive-preserves-field-type',
    ...richProjectionOptions,
  },
).document;
strictEqual(
  (
    (
      (deletedPrimitiveLeaf.data.meta?.fields as Record<string, unknown>)
        .examples as Array<Record<string, unknown>>
    )[0].fields as Record<string, Record<string, Record<string, unknown>>>
  ).label.adoptsFrom.name,
  'FancyString',
);

const dataArraySource = richSourceFixture();
dataArraySource.data.relationships = {
  ...dataArraySource.data.relationships,
  linked: {
    links: { related: 'preserve-array-link' },
    data: [
      { type: 'card', id: 'https://example.test/Friend/a' },
      { type: 'card', id: 'https://example.test/Friend/b' },
    ],
    meta: { source: 'data-array' },
  },
};
delete dataArraySource.data.relationships['linked.0'];
delete dataArraySource.data.relationships['linked.1'];
delete dataArraySource.data.relationships['linked.2'];
const normalizedDataArray = mutateBxlCardSource(
  dataArraySource,
  'prepend(.linked; card("https://example.test/Friend/z"));',
  {
    schema: richSchema,
    syntax: 'solidified',
    programId: 'normalize-json-api-data-array',
    ...richProjectionOptions,
    resolveCard(id) {
      return { id };
    },
  },
).document;
strictEqual(normalizedDataArray.data.relationships?.linked, undefined);
strictEqual(
  relationship(normalizedDataArray, 'linked.1').meta?.source,
  'data-array',
);
strictEqual(
  relationship(normalizedDataArray, 'linked.2').links?.related,
  'preserve-array-link',
);

const emptyLinksSource = richSourceFixture();
emptyLinksSource.data.relationships = {
  linked: { links: { self: null }, meta: { empty: true } },
};
const populatedEmptyLinks = mutateBxlCardSource(
  emptyLinksSource,
  'append(.linked; card("https://example.test/Friend/a"));',
  {
    schema: richSchema,
    syntax: 'solidified',
    programId: 'replace-empty-link-marker',
    ...richProjectionOptions,
    resolveCard(id) {
      return { id };
    },
  },
).document;
strictEqual(populatedEmptyLinks.data.relationships?.linked, undefined);
strictEqual(
  relationship(populatedEmptyLinks, 'linked.0').links?.self,
  '../Friend/a',
);

const related = mutateBxlCardSource(
  richSourceFixture(),
  'move_item_to_start(.linked[2]; .linked);\n' +
    'del(.linked[1]);\n' +
    'append(.linked; card("https://example.test/Friend/d"));',
  {
    schema: richSchema,
    syntax: 'solidified',
    programId: 'relationship-collections',
    ...richProjectionOptions,
    resolveCard(id) {
      return { id };
    },
  },
).document;
strictEqual(relationship(related, 'linked.0').meta?.edge, 'c');
strictEqual(relationship(related, 'linked.1').meta?.edge, 'b');
strictEqual(relationship(related, 'linked.2').links?.self, '../Friend/d');

const matrixCardInfoDefinition: BxlBoxelSourceDefinition = {
  type: 'field-def',
  codeRef: ref('MatrixCardInfo'),
  displayName: 'Matrix Card Info',
  fields: { theme: 'f0', themes: 'f1', computedSummary: 'f2' },
  fieldDefs: {
    f0: field('linksTo', 'Theme'),
    f1: field('linksToMany', 'Theme'),
    f2: field('contains', 'String', { primitive: true, computed: true }),
  },
};

const matrixHolderDefinition: BxlBoxelSourceDefinition = {
  type: 'field-def',
  codeRef: ref('MatrixHolder'),
  displayName: 'Matrix Holder',
  fields: { owner: 'f0', peers: 'f1' },
  fieldDefs: {
    f0: field('linksTo', 'Person'),
    f1: field('linksToMany', 'Person'),
  },
};

const linkMatrixDefinition: BxlBoxelSourceDefinition = {
  type: 'card-def',
  codeRef: ref('LinkMatrix'),
  displayName: 'Link Matrix',
  fields: {
    cardInfo: 'f0',
    primary: 'f1',
    collaborators: 'f2',
    holders: 'f3',
  },
  fieldDefs: {
    f0: field('contains', 'MatrixCardInfo'),
    f1: field('linksTo', 'Person'),
    f2: field('linksToMany', 'Person'),
    f3: field('containsMany', 'MatrixHolder'),
  },
};

const matrixDefinitions = new Map(
  [matrixCardInfoDefinition, matrixHolderDefinition, linkMatrixDefinition].map(
    (definition) => [JSON.stringify(definition.codeRef), definition],
  ),
);
const linkMatrixSchema = await mutationSchemaForCardSource(
  linkMatrixDefinition,
  {
    async lookupDefinition(codeRef) {
      return matrixDefinitions.get(JSON.stringify(codeRef));
    },
  },
);

function linkMatrixSource(): BxlCardSourceDocument {
  return {
    data: {
      type: 'card',
      attributes: {
        cardInfo: {},
        holders: [{}],
      },
      relationships: {
        'cardInfo.theme': {
          links: { self: '../Theme/old', related: 'theme-related' },
          meta: { slot: 'card-info-one' },
          extension: { preserve: true },
        },
        'cardInfo.themes.0': {
          links: { self: '@catalog/theme/portable' },
          meta: { slot: 'card-info-many-rri' },
        },
        'cardInfo.themes.1': {
          links: { self: 'https://external.test/Theme/absolute' },
          meta: { slot: 'card-info-many-absolute' },
        },
        primary: {
          links: { self: 'https://external.test/Person/primary' },
          meta: { slot: 'root-one' },
        },
        'collaborators.0': {
          links: { self: '../Person/relative' },
          meta: { slot: 'root-many-relative' },
        },
        'collaborators.1': {
          links: { self: '@catalog/person/portable' },
          meta: { slot: 'root-many-rri' },
        },
        'holders.0.owner': {
          links: { self: '@catalog/person/nested-owner' },
          meta: { slot: 'nested-one' },
        },
        'holders.0.peers.0': {
          links: { self: '../Person/nested-relative' },
          meta: { slot: 'nested-many-relative' },
        },
        'holders.0.peers.1': {
          links: { self: 'https://external.test/Person/nested-absolute' },
          meta: { slot: 'nested-many-absolute' },
        },
      },
      meta: {
        adoptsFrom: ref('LinkMatrix'),
        fields: {
          cardInfo: {
            adoptsFrom: { module: '../fields', name: 'MatrixCardInfo' },
            custom: { preserve: 'card-info-meta' },
          },
          holders: [
            {
              adoptsFrom: { module: '../fields', name: 'MatrixHolder' },
              custom: { preserve: 'holder-meta' },
            },
          ],
        },
        custom: { preserve: 'root-meta' },
      },
    },
  };
}

const matrixBase = 'https://realm.test/LinkMatrix/one';
const matrixOptions = {
  targetId: matrixBase,
  resolveReference(reference: string) {
    return reference.startsWith('@')
      ? reference
      : new URL(reference, matrixBase).href;
  },
  formatReference(id: string) {
    if (id.startsWith('@')) return id;
    const url = new URL(id);
    return url.origin === 'https://realm.test'
      ? `../${url.pathname.slice(1)}`
      : id;
  },
};

const matrixOriginal = linkMatrixSource();
const matrixBefore = structuredClone(matrixOriginal);
const matrixSnapshot = snapshotBxlCardSource(
  matrixOriginal,
  linkMatrixSchema,
  matrixOptions,
) as Record<string, any>;
strictEqual(matrixSnapshot.cardInfo.theme.id, 'https://realm.test/Theme/old');
strictEqual(matrixSnapshot.cardInfo.themes[0].id, '@catalog/theme/portable');
strictEqual(
  matrixSnapshot.cardInfo.themes[1].id,
  'https://external.test/Theme/absolute',
);
strictEqual(
  matrixSnapshot.collaborators[0].id,
  'https://realm.test/Person/relative',
);
strictEqual(
  matrixSnapshot.holders[0].peers[0].id,
  'https://realm.test/Person/nested-relative',
);

const matrixResult = mutateBxlCardSource(
  matrixOriginal,
  '.cardInfo.computedSummary = (1 / 0);\n' +
    '.cardInfo.theme = card("@catalog/theme/dark");\n' +
    'prepend(.cardInfo.themes; card("https://realm.test/Theme/new"));\n' +
    '.primary = card("https://realm.test/Person/new");\n' +
    'prepend(.collaborators; card("@catalog/person/new"));\n' +
    '.holders[0].owner = card("https://realm.test/Person/nested");\n' +
    'prepend(.holders[0].peers; card("https://external.test/Person/new"));',
  {
    schema: linkMatrixSchema,
    syntax: 'solidified',
    programId: 'link-cardinality-meta-reference-matrix',
    ...matrixOptions,
    resolveCard(id) {
      return { id };
    },
  },
);
deepStrictEqual(matrixOriginal, matrixBefore);
strictEqual(matrixResult.plan.statements[0].affected, 0);
strictEqual(matrixResult.plan.affected, 6);
strictEqual(
  matrixResult.document.data.attributes?.cardInfo &&
    (matrixResult.document.data.attributes.cardInfo as Record<string, unknown>)
      .computedSummary,
  undefined,
);
strictEqual(
  relationship(matrixResult.document, 'cardInfo.theme').links?.self,
  '@catalog/theme/dark',
);
strictEqual(
  relationship(matrixResult.document, 'cardInfo.theme').meta?.slot,
  'card-info-one',
);
deepStrictEqual(
  relationship(matrixResult.document, 'cardInfo.theme').extension,
  { preserve: true },
);
strictEqual(
  relationship(matrixResult.document, 'cardInfo.themes.0').links?.self,
  '../Theme/new',
);
strictEqual(
  relationship(matrixResult.document, 'cardInfo.themes.1').meta?.slot,
  'card-info-many-rri',
);
strictEqual(
  relationship(matrixResult.document, 'cardInfo.themes.2').meta?.slot,
  'card-info-many-absolute',
);
strictEqual(
  relationship(matrixResult.document, 'primary').links?.self,
  '../Person/new',
);
strictEqual(
  relationship(matrixResult.document, 'primary').meta?.slot,
  'root-one',
);
strictEqual(
  relationship(matrixResult.document, 'collaborators.0').links?.self,
  '@catalog/person/new',
);
strictEqual(
  relationship(matrixResult.document, 'collaborators.1').meta?.slot,
  'root-many-relative',
);
strictEqual(
  relationship(matrixResult.document, 'collaborators.2').meta?.slot,
  'root-many-rri',
);
strictEqual(
  relationship(matrixResult.document, 'holders.0.owner').links?.self,
  '../Person/nested',
);
strictEqual(
  relationship(matrixResult.document, 'holders.0.owner').meta?.slot,
  'nested-one',
);
strictEqual(
  relationship(matrixResult.document, 'holders.0.peers.0').links?.self,
  'https://external.test/Person/new',
);
strictEqual(
  relationship(matrixResult.document, 'holders.0.peers.1').meta?.slot,
  'nested-many-relative',
);
strictEqual(
  relationship(matrixResult.document, 'holders.0.peers.2').meta?.slot,
  'nested-many-absolute',
);
deepStrictEqual(matrixResult.document.data.meta, matrixBefore.data.meta);

const detachedSource = sourceFixture();
const detachedSnapshot = snapshotBxlCardSource(
  detachedSource,
  schema,
  projectionOptions,
);
const detachedPlan = prepareBxlMutation('.image = "planned";', {
  targetKind: 'card',
  schema,
  syntax: 'solidified',
}).plan(detachedSnapshot, {
  programId: 'detached-source-plan',
  targetId: projectionOptions.targetId,
});
detachedSource.data.attributes!.image = 'changed concurrently';
throws(
  () =>
    applyBxlMutationPlanToCardSource(
      detachedSource,
      detachedPlan,
      schema,
      projectionOptions,
    ),
  (error) =>
    error instanceof BxlMutationError &&
    error.code === 'card-source-snapshot-mismatch',
);

ok(result.plan.affected === 3);

const computedSkipSource = sourceFixture();
const computedSkip = mutateBxlCardSource(
  computedSkipSource,
  '.computedLabel = (1 / 0);\n' + '.image = "computed-write-was-skipped";',
  {
    schema,
    syntax: 'solidified',
    programId: 'skip-computed-field-write',
    ...projectionOptions,
  },
);
strictEqual(computedSkip.plan.statements[0].affected, 0);
deepStrictEqual(computedSkip.plan.statements[0].intents, []);
strictEqual(computedSkip.plan.affected, 1);
strictEqual(computedSkip.document.data.attributes?.computedLabel, undefined);
strictEqual(
  computedSkip.document.data.attributes?.image,
  'computed-write-was-skipped',
);
// --- Read-only overlays ------------------------------------------------------
//
// The realm hands BXL the computed values and the searchable Fields of linked
// Cards as read-only layers under the stored document. `computedLabel` is a
// computed Field and `cardInfo.theme.name` a Field of a linked Card; neither
// is ever written to the card's own JSON, so both read `null`/absent from the
// stored projection and only an overlay can answer them.

const overlays: BxlMutationOverlays = {
  computeds: {
    computedLabel: 'TypeScript · language',
    // A stale copy of a stored value: the stored document still wins.
    image: 'https://cdn.example.test/stale.svg',
  },
  linked: { cardInfo: { theme: { name: 'Original' } } },
};

function overlayMutation(
  source: string,
  options: {
    overlays?: BxlMutationOverlays;
    onRead?: (event: BxlMutationReadEvent) => void;
    resolveCard?: (id: string) => { id: string } | undefined;
  } = {},
) {
  return mutateBxlCardSource(sourceFixture(), source, {
    schema,
    syntax: 'solidified',
    programId: 'overlay-reads',
    ...projectionOptions,
    ...options,
  });
}

function overlayError(
  source: string,
  options: Parameters<typeof overlayMutation>[1] = {},
): BxlMutationError {
  try {
    overlayMutation(source, options);
  } catch (error) {
    if (error instanceof BxlMutationError) return error;
    throw error;
  }
  throw new Error(`expected ${JSON.stringify(source)} to fail`);
}

const computedRead = overlayMutation('.image = .computedLabel;', { overlays });
strictEqual(
  computedRead.document.data.attributes?.image,
  'TypeScript · language',
);

const linkedRead = overlayMutation('.image = .cardInfo.theme.name;', {
  overlays,
});
strictEqual(linkedRead.document.data.attributes?.image, 'Original');

// An overlay never reaches the committed document or the plan's output: it
// answers reads, and the plan hands back the stored document the program made.
strictEqual(linkedRead.document.data.attributes?.computedLabel, undefined);
const storedSnapshot = snapshotBxlCardSource(
  sourceFixture(),
  schema,
  projectionOptions,
) as Record<string, unknown>;
deepStrictEqual(linkedRead.plan.output, {
  ...storedSnapshot,
  image: 'Original',
});

// A stale overlay copy of a stored value loses to the stored value.
deepStrictEqual(
  overlayMutation('.tags = [.image];', { overlays }).document.data.attributes
    ?.tags,
  ['https://example.test/typescript.svg'],
);

// The schema is the authority on the Fields a Card declares. A Definition-
// derived schema marks every computed Field `writeBehavior: 'skip'`, so a
// write to one stays the intentional no-op it is without overlays — the same
// program plans the same way whether or not the indexer has answered.
for (const overlaid of [undefined, overlays]) {
  const skipped = overlayMutation('.computedLabel = "written";', {
    overlays: overlaid,
  });
  strictEqual(skipped.plan.statements[0].affected, 0);
  deepStrictEqual(skipped.plan.statements[0].intents, []);
  strictEqual(skipped.document.data.attributes?.computedLabel, undefined);
}

const linkedWrite = overlayError('.cardInfo.theme.name = "written";', {
  overlays,
});
strictEqual(linkedWrite.code, 'write-through-link');
deepStrictEqual(linkedWrite.details, {
  path: 'cardInfo.theme.name',
  tier: 'linked',
});

// Replacing the relationship edge is a write to the Card's own document, not a
// write through the link, so an overlay on the linked Card's Fields allows it.
const relinked = overlayMutation(
  `.cardInfo.theme = card(${JSON.stringify(darkTheme)});`,
  { overlays, resolveCard: (id) => (id === darkTheme ? { id } : undefined) },
);
strictEqual(
  relationship(relinked.document, 'cardInfo.theme').links?.self,
  darkTheme,
);

const unavailable = overlayError('.image = .computedLabel;', {
  overlays: {
    unavailable: [
      { path: 'computedLabel', tier: 'computed', reason: 'not-indexed' },
    ],
  },
});
strictEqual(unavailable.code, 'snapshot-unavailable');
deepStrictEqual(unavailable.details, {
  path: 'computedLabel',
  tier: 'computed',
  reason: 'not-indexed',
});

const notSearchable = overlayError('.image = .cardInfo.theme.name;', {
  overlays: {
    unavailable: [
      { path: 'cardInfo.theme', tier: 'linked', reason: 'not-searchable' },
    ],
  },
});
strictEqual(notSearchable.code, 'snapshot-unavailable');
// A path the host could not supply covers the paths nested inside it.
strictEqual(notSearchable.details?.path, 'cardInfo.theme');
strictEqual(notSearchable.details?.reason, 'not-searchable');

// A marker says what the host could not supply from the index; it says nothing
// about the Card's own document. The stored relationship edge still answers.
const shadowedEdge: BxlMutationOverlays = {
  unavailable: [
    { path: 'cardInfo.theme', tier: 'linked', reason: 'not-searchable' },
  ],
};
strictEqual(
  overlayMutation('.image = .cardInfo.theme.id;', { overlays: shadowedEdge })
    .document.data.attributes?.image,
  'https://example.test/Theme/original',
);
strictEqual(
  relationship(
    overlayMutation(`.cardInfo.theme = card(${JSON.stringify(darkTheme)});`, {
      overlays: shadowedEdge,
      resolveCard: (id) => (id === darkTheme ? { id } : undefined),
    }).document,
    'cardInfo.theme',
  ).links?.self,
  darkTheme,
);

// The same holds however the overlay shapes the value: a computed Field the
// schema declares is the schema's to answer for.
const computedContainer: BxlMutationOverlays = {
  computeds: { computedLabel: { text: 'TypeScript · language' } },
};
for (const program of ['.computedLabel = "written";', 'del(.computedLabel);']) {
  strictEqual(
    overlayMutation(program, { overlays: computedContainer }).plan.affected,
    0,
    program,
  );
}

// An assert over an overlay value must say it accepts a stale answer.
const bareAssert = overlayError(
  'assert(.computedLabel == "TypeScript · language"; "wrong label");',
  { overlays },
);
strictEqual(bareAssert.code, 'assert-snapshot-required');
deepStrictEqual(bareAssert.details, {
  path: 'computedLabel',
  tier: 'computed',
});

strictEqual(
  overlayMutation(
    'assert(.computedLabel == "TypeScript · language"; "wrong label"; { snapshot: true });\n' +
      '.image = "asserted";',
    { overlays },
  ).document.data.attributes?.image,
  'asserted',
);

const bestEffortUnavailable = overlayError(
  'assert(.computedLabel == "anything"; "label is not indexed yet"; { snapshot: true });',
  {
    overlays: {
      unavailable: [
        { path: 'computedLabel', tier: 'computed', reason: 'key-absent' },
      ],
    },
  },
);
strictEqual(bestEffortUnavailable.code, 'assertion-failed');
strictEqual(bestEffortUnavailable.message, 'label is not indexed yet');
deepStrictEqual(bestEffortUnavailable.details, {
  path: 'computedLabel',
  tier: 'computed',
  reason: 'key-absent',
});

throws(
  () => overlayMutation('assert(.image; "m"; { best: "effort" });'),
  (error) =>
    error instanceof BxlMutationError && error.code === 'assert-option-invalid',
);
// The option exists only to opt in; `assert/2` is how an assert says it wants
// stored values, so there is one spelling of each behavior.
throws(
  () => overlayMutation('assert(.image; "m"; { snapshot: false });'),
  (error) =>
    error instanceof BxlMutationError && error.code === 'assert-option-invalid',
);
throws(
  () => overlayMutation('assert(.image; "m"; { snapshot: true }; 1);'),
  (error) => error instanceof BxlMutationError && error.code === 'call-arity',
);

const readEvents: BxlMutationReadEvent[] = [];
overlayMutation(
  'assert(.cardInfo.theme.name == "Original"; "wrong theme"; { snapshot: true });\n' +
    '.image = .computedLabel;\n' +
    '.tags |= . + [.[0]];\n' +
    '.cardInfo.name = .unknownToTheIndex;',
  { overlays, onRead: (event) => readEvents.push(event) },
);
deepStrictEqual(readEvents, [
  { path: 'cardInfo.theme.name', tier: 'linked', outcome: 'value' },
  { path: 'computedLabel', tier: 'computed', outcome: 'value' },
  // `|=` evaluates its value expression against the assigned location, so both
  // reads report the paths they address in the document.
  { path: 'tags', tier: 'source', outcome: 'value' },
  { path: 'tags.0', tier: 'source', outcome: 'value' },
  { path: 'unknownToTheIndex', tier: 'source', outcome: 'null' },
]);

// Additive: a program the overlays do not answer plans and commits identically
// whether or not the host supplied them.
const additiveProgram =
  '.cardInfo.name = "C#";\n' +
  '.tags = ["language"];\n' +
  '.computedLabel = "skipped";';
const withoutOverlays = overlayMutation(additiveProgram);
const withOverlays = overlayMutation(additiveProgram, {
  overlays: { linked: overlays.linked },
});
strictEqual(
  JSON.stringify(withOverlays.document),
  JSON.stringify(withoutOverlays.document),
);
strictEqual(
  JSON.stringify(withOverlays.plan),
  JSON.stringify(withoutOverlays.plan),
);
// Without a computed overlay the write to a computed Field stays a no-op.
strictEqual(withoutOverlays.plan.statements[2].affected, 0);

// The card-source projection fills every schema Field, so these two rules —
// what an overlay leaves behind under a container the merge created, and which
// branches of an expression count as read — are exercised against the planner
// directly, where a Field can be genuinely absent.
const branchingSchema = {
  fields: [
    { key: 'image', label: 'Image', kind: 'scalar' as const, writable: true },
    { key: 'flag', label: 'Flag', kind: 'scalar' as const, writable: true },
    {
      key: 'status',
      label: 'Status',
      kind: 'scalar' as const,
      writable: false,
      writeBehavior: 'skip' as const,
    },
    {
      key: 'profile',
      label: 'Profile',
      kind: 'object' as const,
      fieldType: 'contains' as const,
      writable: true,
      fields: [
        { key: 'name', label: 'Name', kind: 'scalar' as const, writable: true },
      ],
    },
  ],
};

function plannerRun(
  source: string,
  overlays: BxlMutationOverlays,
  onRead?: (event: BxlMutationReadEvent) => void,
) {
  return prepareBxlMutation(source, {
    targetKind: 'card',
    schema: branchingSchema,
    syntax: 'solidified',
  }).plan(
    { image: 'a', flag: true, profile: null },
    { programId: 'overlay-planner', overlays, onRead },
  );
}

/** The planner's output as a record, for reading one Field out of it. */
function plannerOutput(
  source: string,
  overlays: BxlMutationOverlays,
  onRead?: (event: BxlMutationReadEvent) => void,
): Record<string, unknown> {
  return plannerRun(source, overlays, onRead).output as Record<string, unknown>;
}

// A write to a stored sibling keeps its own value and still sheds the overlay
// leaves that shared the container the merge created for them.
const derivedProfile: BxlMutationOverlays = {
  computeds: { profile: { derived: 'from the index' } },
};
deepStrictEqual(plannerRun('.profile.name = "Ada";', derivedProfile).output, {
  image: 'a',
  flag: true,
  profile: { name: 'Ada' },
});
deepStrictEqual(
  plannerRun('.image = .profile.derived;', derivedProfile).output,
  { image: 'from the index', flag: true, profile: null },
);

// A path read only on the branch not taken must not refuse the program.
const statusMissing: BxlMutationOverlays = {
  unavailable: [{ path: 'status', tier: 'computed', reason: 'not-indexed' }],
};
const branchEvents: BxlMutationReadEvent[] = [];
strictEqual(
  plannerOutput(
    '.image = (if .flag then "taken" else .status end);',
    statusMissing,
    (event) => branchEvents.push(event),
  ).image,
  'taken',
);
strictEqual(
  plannerOutput('.image = (.flag // .status);', statusMissing).image,
  true,
);
deepStrictEqual(branchEvents, [
  { path: 'flag', tier: 'source', outcome: 'value' },
]);
// The condition itself runs every time, so it is read every time.
throws(
  () =>
    plannerRun('.image = (if .status then "y" else "n" end);', statusMissing),
  (error) =>
    error instanceof BxlMutationError && error.code === 'snapshot-unavailable',
);

// An overlay layers values *under* the stored document, so it may fill a place
// the Card leaves empty but never change what the Card already is. Index drift
// is routine — a `pristine_doc` or `search_doc` row can lag a write, carry an
// extra collection row, or hold a value of a different shape — and none of it
// may reshape the document a program plans over.
const collectionSchema = {
  fields: [
    { key: 'image', label: 'Image', kind: 'scalar' as const, writable: true },
    {
      key: 'summary',
      label: 'Summary',
      kind: 'object' as const,
      fieldType: 'contains' as const,
      writable: true,
      fields: [
        { key: 'text', label: 'Text', kind: 'scalar' as const, writable: true },
      ],
    },
    {
      key: 'tags',
      label: 'Tags',
      kind: 'array' as const,
      fieldType: 'containsMany' as const,
      writable: true,
    },
    {
      key: 'meta',
      label: 'Meta',
      kind: 'object' as const,
      fieldType: 'contains' as const,
      writable: true,
      fields: [
        { key: 'note', label: 'Note', kind: 'scalar' as const, writable: true },
        {
          key: 'stamp',
          label: 'Stamp',
          kind: 'scalar' as const,
          writable: true,
        },
      ],
    },
    {
      key: 'rows',
      label: 'Rows',
      kind: 'array' as const,
      fieldType: 'containsMany' as const,
      writable: true,
      item: {
        fields: [
          { key: 'qty', label: 'Qty', kind: 'scalar' as const, writable: true },
          {
            key: 'total',
            label: 'Total',
            kind: 'scalar' as const,
            writable: false,
            writeBehavior: 'skip' as const,
          },
        ],
      },
    },
  ],
};
const collectionSnapshot = {
  image: 'stored',
  summary: null,
  tags: ['language', 'web'],
  meta: { note: 'kept', stamp: null },
  rows: [
    { qty: 2, total: null },
    { qty: 3, total: null },
  ],
};

function collectionPlan(source: string, overlays?: BxlMutationOverlays) {
  return prepareBxlMutation(source, {
    targetKind: 'card',
    schema: collectionSchema,
    syntax: 'solidified',
  }).plan(collectionSnapshot, {
    programId: 'overlay-collection',
    baseRevision: 'r1',
    currentRevision: 'r1',
    overlays,
  });
}

/** The planner's output as a record, for reading one Field out of it. */
function collectionOutput(
  source: string,
  overlays?: BxlMutationOverlays,
): Record<string, unknown> {
  return collectionPlan(source, overlays).output as Record<string, unknown>;
}

function collectionError(
  source: string,
  overlays?: BxlMutationOverlays,
): BxlMutationError {
  try {
    collectionPlan(source, overlays);
  } catch (error) {
    if (error instanceof BxlMutationError) return error;
    throw error;
  }
  throw new Error(`expected ${JSON.stringify(source)} to fail`);
}

// An overlay never participates inside a collection. It arrives keyed by
// position, and a position is an identity only while nothing moves: inserting,
// deleting, reordering or moving an item renumbers everything after it, and an
// indexed copy written before the program ran cannot say which item it meant.
// Contained items carry no id to re-key against, so the Card's own items are
// the whole answer there — whichever side of the path the collection sits on.
const indexedTags: BxlMutationOverlays = {
  linked: { tags: ['language', 'web', 'from-the-index'] },
};
for (const overlays of [undefined, indexedTags]) {
  strictEqual(
    collectionError('insert_at(.tags; 3; "new");', overlays).code,
    'insert-index-invalid',
  );
  deepStrictEqual(collectionPlan('del(.tags[0]);', overlays).output, {
    ...collectionSnapshot,
    tags: ['web'],
  });
  deepStrictEqual(
    collectionPlan('move_item_to_end(.tags[0]; .tags);', overlays).intents,
    [{ op: 'move', from: ['tags', 0], toCollection: ['tags'], toIndex: 1 }],
  );
  deepStrictEqual(collectionPlan('append(.tags; "z");', overlays).output, {
    ...collectionSnapshot,
    tags: ['language', 'web', 'z'],
  });
}

// An overlay whose value has a different shape than the stored one is dropped
// too: the stored value survives untouched.
deepStrictEqual(
  collectionPlan('.image = "written";', {
    computeds: { image: { nested: 'wrong shape' }, tags: { 0: 'wrong shape' } },
  }).output,
  { ...collectionSnapshot, image: 'written' },
);

// A computed Field inside a collection is the schema's to answer for, and the
// collection holding it stays writable.
const rowTotals: BxlMutationOverlays = {
  computeds: { rows: [{ total: 20 }, { total: 30 }] },
};
strictEqual(collectionPlan('.rows[0].total = 9;', rowTotals).affected, 0);
for (const source of [
  'append(.rows; {"qty": 5});',
  'del(.rows[0]);',
  '.rows[0].qty = 9;',
]) {
  ok(collectionPlan(source, rowTotals).affected > 0, source);
}
// Where the schema has no opinion — a Field it declares writable, under which
// an overlay supplied a value the Card does not store — the overlay is the
// backstop that refuses the write.
strictEqual(
  collectionError('.summary = {"text": "x"};', {
    computeds: { summary: { text: 'derived' } },
  }).code,
  'computed-read-only',
);
// A stale overlay copy of a value the Card does store neither answers reads
// nor makes the Field read-only.
deepStrictEqual(
  collectionPlan('.image = .image;', { computeds: { image: 'stale' } }).output,
  collectionSnapshot,
);

// An update is handed the layered value, so a Field an overlay filled into a
// stored container is in scope. What comes back is settled against the Card's
// own, so an overlay value the expression carried along is read but never
// stored, and one it wrote over is refused rather than quietly dropped.
const metaStamp: BxlMutationOverlays = {
  computeds: { meta: { stamp: 'derived' } },
};
deepStrictEqual(
  collectionOutput(
    '.meta |= (. + {"note": (.note + " " + .stamp)});',
    metaStamp,
  ).meta,
  { note: 'kept derived', stamp: null },
);
strictEqual(
  collectionError('.meta |= (. + {"stamp": "mine"});', metaStamp).code,
  'computed-read-only',
);
// An expression that simply omits the Field is not writing to it.
deepStrictEqual(collectionOutput('.meta |= {"note": .note};', metaStamp).meta, {
  note: 'kept',
});
// A copy intent carries paths, not values, and the adapter applies it by
// reading the source out of the stored document at commit time. An overlay
// source would commit the Card's own value under the overlay's name, so it is
// refused; reading it is the spelling that works.
strictEqual(
  collectionError('copy_value_to(.meta.stamp; .image);', metaStamp).code,
  'computed-read-only',
);
strictEqual(
  collectionOutput('.image = .meta.stamp;', metaStamp).image,
  'derived',
);

// Reads report the layer that answered them. A collection is never one of
// those layers, so reading one is a source read even where the host supplied a
// value for every row.
const rowEvents: BxlMutationReadEvent[] = [];
prepareBxlMutation('.image = (.rows | tostring);', {
  targetKind: 'card',
  schema: collectionSchema,
  syntax: 'solidified',
}).plan(collectionSnapshot, {
  programId: 'overlay-collection-reads',
  overlays: rowTotals,
  onRead: (event) => rowEvents.push(event),
});
deepStrictEqual(rowEvents, [
  { path: 'rows', tier: 'source', outcome: 'value' },
]);
// So an assert over a collection stands on the Card's own values, with no
// snapshot option to opt into.
strictEqual(
  collectionPlan(
    'assert((.rows | length) == 2; "wrong count");\n.image = "asserted";',
    rowTotals,
  ).affected,
  1,
);
// A read that does reach an overlay value still says which layer supplied it.
const metaEvents: BxlMutationReadEvent[] = [];
prepareBxlMutation('.image = .meta.stamp;', {
  targetKind: 'card',
  schema: collectionSchema,
  syntax: 'solidified',
}).plan(collectionSnapshot, {
  programId: 'overlay-collection-covered-reads',
  overlays: metaStamp,
  onRead: (event) => metaEvents.push(event),
});
deepStrictEqual(metaEvents, [
  { path: 'meta.stamp', tier: 'computed', outcome: 'value' },
]);

// An intent records what the Card stored, never what an overlay answered with.
deepStrictEqual(
  collectionPlan('.rows = [];', { computeds: { rows: [{ total: 20 }] } })
    .intents,
  [
    {
      op: 'set',
      path: ['rows'],
      before: [
        { qty: 2, total: null },
        { qty: 3, total: null },
      ],
      after: [],
    },
  ],
);

// A statement that restructures a collection an overlay named values inside
// plans, outputs and records intents exactly as it does with no overlays at
// all — including every form that renumbers, resizes or reorders it. That
// parity is the whole point of stopping the overlay layer at the boundary:
// there is no recorded position left to go stale.
const holesFilled: BxlMutationOverlays = {
  computeds: { tags: ['from-index-0', 'from-index-1'] },
};
for (const [source, overlays] of [
  ['del(.rows[0]);', rowTotals],
  ['prepend(.rows; {"qty": 1});', rowTotals],
  ['move_item_to_end(.rows[0]; .rows);', rowTotals],
  ['insert_item_before({"qty": 9}; .rows[1]);', rowTotals],
  ['.rows[* .qty > 0] |= (. + {"qty": (.qty + (.total // 10))});', rowTotals],
  ['.rows |= [.[1], .[0]];', rowTotals],
  ['.rows |= (. + [{"qty": 9}]);', rowTotals],
  ['.rows |= [.[0]];', rowTotals],
  ['del(.tags[0]);', holesFilled],
  ['prepend(.tags; "new");', holesFilled],
] as const) {
  deepStrictEqual(
    collectionPlan(source, overlays).output,
    collectionPlan(source).output,
    source,
  );
  deepStrictEqual(
    collectionPlan(source, overlays).intents,
    collectionPlan(source).intents,
    source,
  );
}

// The same holds across statements: a program that shifts a collection and
// then writes into it is not refused over a position anything used to occupy.
deepStrictEqual(
  collectionPlan('del(.rows[0]);\n.rows[0].qty = 9;', rowTotals).output,
  collectionPlan('del(.rows[0]);\n.rows[0].qty = 9;').output,
);

// `first` stops at its first output and `last` has to reach the end, so only
// `first`'s later comma branches are conditional. Both otherwise read what
// they are given, and the guards see it.
const derivedOnly: BxlMutationOverlays = {
  computeds: { summary: { text: 'derived' } },
};
for (const expression of ['.summary.text', 'first(.summary.text)']) {
  strictEqual(
    collectionError(`assert(${expression} == "derived"; "m");`, derivedOnly)
      .code,
    'assert-snapshot-required',
    expression,
  );
}
// A comma branch inside `first` may never run, so it is not a read.
strictEqual(
  collectionPlan('.image = first(.tags[0], .summary.text);', derivedOnly)
    .affected,
  1,
);

// A pipe whose left side is a static path is proven, and reported under it.
strictEqual(
  collectionError('assert((.summary | .text) == "derived"; "m");', derivedOnly)
    .code,
  'assert-snapshot-required',
);

// Where the walk cannot name the place it is reading, it names the widest one
// it can — the document itself. An overlay supplies values under that, so a
// read of the whole Card is an overlay read: an expression that indexes by a
// computed key, or pipes the Card into a builtin, is held to the same opt-in
// as a spelled-out path rather than deciding a precondition on index data
// unremarked. With the opt-in it sees the layered value.
for (const expression of [
  '.[("sum" + "mary")].text == "derived"',
  '(. | tostring | contains("derived"))',
]) {
  strictEqual(
    collectionError(`assert(${expression}; "m");`, derivedOnly).code,
    'assert-snapshot-required',
    expression,
  );
  strictEqual(
    collectionPlan(
      `assert(${expression}; "m"; { snapshot: true });\n` +
        '.image = "asserted";',
      derivedOnly,
    ).affected,
    1,
    expression,
  );
}
// A read of the whole Card carries whatever an overlay put under it, so the
// event says which layer answered rather than calling it a source read.
const rootEvents: BxlMutationReadEvent[] = [];
prepareBxlMutation('.image = (. | tostring);', {
  targetKind: 'card',
  schema: collectionSchema,
  syntax: 'solidified',
}).plan(collectionSnapshot, {
  programId: 'overlay-root-read',
  overlays: derivedOnly,
  onRead: (event) => rootEvents.push(event),
});
deepStrictEqual(rootEvents, [{ path: '', tier: 'computed', outcome: 'value' }]);

// The walk still reports a lower bound: `getpath` names no path at all, so the
// guards say nothing about it and the assert is allowed to stand. This is the
// documented limit of a syntactic walk, not an oversight; the read itself
// still sees the layered value.
strictEqual(
  collectionPlan(
    'assert(getpath(["summary","text"]) == "derived"; "m");\n' +
      '.image = "not refused";',
    derivedOnly,
  ).affected,
  1,
);

// `{ "snapshot": true }` is the same record as `{ snapshot: true }`.
strictEqual(
  collectionPlan(
    'assert(.summary.text == "derived"; "m"; { "snapshot": true });\n' +
      '.image = "asserted";',
    derivedOnly,
  ).affected,
  1,
);

// A path a statement clears belongs to the program from then on. The index
// carries a copy of every stored Field, so without that rule the overlay would
// fill the hole straight back in and refuse the write that follows.
const staleCopy: BxlMutationOverlays = { computeds: { image: 'stored' } };
for (const overlays of [undefined, staleCopy]) {
  deepStrictEqual(
    collectionOutput('del(.image);\n.image = "mine";', overlays).image,
    'mine',
  );
  deepStrictEqual(
    collectionOutput('.image = null;\n.tags = [(.image // "gone")];', overlays)
      .tags,
    ['gone'],
  );
}

// A selector reads the document to choose what it matches, so a value the host
// could not supply must not be allowed to quietly settle a write set.
strictEqual(
  collectionError('del(.tags[* . == "web"]);', {
    unavailable: [{ path: 'tags', tier: 'linked', reason: 'not-searchable' }],
  }).code,
  'snapshot-unavailable',
);
// A selector over a collection reaches no overlay, so it has nothing to report
// and decides on the Card's own values — matching exactly what it matches with
// no overlays at all, here nothing.
const selectorEvents: BxlMutationReadEvent[] = [];
prepareBxlMutation('del(.rows[* .qty > 2]);', {
  targetKind: 'card',
  schema: collectionSchema,
  syntax: 'solidified',
}).plan(collectionSnapshot, {
  programId: 'overlay-selector',
  overlays: rowTotals,
  onRead: (event) => selectorEvents.push(event),
});
deepStrictEqual(selectorEvents, []);
for (const overlays of [undefined, rowTotals]) {
  strictEqual(
    collectionError('del(.rows[* .total > 0]);', overlays).code,
    'bulk-target-empty',
  );
}
// A value the host could not supply stops the read that reaches it.
strictEqual(
  collectionError('.image = .meta.stamp;', {
    unavailable: [
      { path: 'meta.stamp', tier: 'computed', reason: 'key-absent' },
    ],
  }).code,
  'snapshot-unavailable',
);
// A marker inside a collection is dropped for the same reason a value there
// is: the Card's own items already are the whole answer, so there is nothing
// missing to report.
strictEqual(
  collectionError('del(.rows[* .total > 0]);', {
    ...rowTotals,
    unavailable: [
      { path: 'rows.0.total', tier: 'computed', reason: 'key-absent' },
    ],
  }).code,
  'bulk-target-empty',
);
strictEqual(
  collectionOutput('.image = ((.rows[0].total // "none") | tostring);', {
    unavailable: [
      { path: 'rows.0.total', tier: 'computed', reason: 'key-absent' },
    ],
  }).image,
  'none',
);
// A location that addresses one place selects nothing, so it adds no event.
const directEvents: BxlMutationReadEvent[] = [];
prepareBxlMutation('.image = "x";', {
  targetKind: 'card',
  schema: collectionSchema,
  syntax: 'solidified',
}).plan(collectionSnapshot, {
  programId: 'overlay-direct',
  overlays: rowTotals,
  onRead: (event) => directEvents.push(event),
});
deepStrictEqual(directEvents, []);

// The layered view is cached per statement and rebuilt after every write, so a
// value expression reading what an earlier location of the same statement left
// behind sees it. A missed invalidation would show up here as a stale read.
for (const source of [
  '.rows[* .qty > 0].qty = (.rows[0].qty + 100);',
  '.rows[* .qty > 0].qty = (.rows | map(.qty) | add);',
  'del(.rows[0]);\n.image = ((.rows | length) | tostring);',
]) {
  deepStrictEqual(
    collectionPlan(source, rowTotals).output,
    collectionPlan(source).output,
    source,
  );
}

// An overlay speaks only where it has something to say. `pristine_doc` and
// `search_doc` carry the Card's own Fields alongside the ones only they can
// answer, so a Field the Card leaves unset arrives as a `null` in both — and
// claiming it would make an ordinary writable Field read-only for no reason.
const wholeDocument: BxlMutationOverlays = {
  computeds: { image: null, summary: { text: 'derived' } },
  linked: { tags: null, meta: { note: null } },
};
deepStrictEqual(
  collectionOutput('.image = "written";', wholeDocument).image,
  'written',
);
deepStrictEqual(
  collectionOutput('del(.image);', wholeDocument).image,
  undefined,
);
deepStrictEqual(
  collectionOutput('.meta |= (. + {"note": "n"});', wholeDocument).meta,
  {
    note: 'n',
    stamp: null,
  },
);
deepStrictEqual(collectionPlan('append(.tags; "z");', wholeDocument).output, {
  ...collectionSnapshot,
  tags: ['language', 'web', 'z'],
});
// The Field only the index can answer is still covered by the same overlay.
strictEqual(
  collectionError('.summary = {"text": "x"};', wholeDocument).code,
  'computed-read-only',
);

// An overlay is host data read out of a column, so a key naming something on
// a JavaScript prototype is dropped rather than grafted — the same refusal the
// planner already gives a program that spells one out.
const hostileKey = JSON.parse('{"__proto__":{"pwned":"yes"},"image":"x"}');
deepStrictEqual(
  collectionPlan('.tags = ["z"];', { computeds: hostileKey }).output,
  { ...collectionSnapshot, tags: ['z'] },
);
strictEqual(({} as Record<string, unknown>).pwned, undefined);
strictEqual(
  collectionPlan('.tags = ["z"];', {
    unavailable: [
      { path: 'constructor.prototype', tier: 'computed', reason: 'key-absent' },
    ],
  }).affected,
  1,
);

// A list is one value, not a place to descend into. An overlay may hand over a
// whole list the Card does not store — a computed `containsMany` — and that
// list reads as itself and is read-only whole. A list the Card *does* store
// wins, so no overlay position ever sits beside one of the Card's own items.
const derivedList: BxlMutationOverlays = {
  computeds: { extras: ['from-the-index', 'and-another'] },
};
strictEqual(
  collectionOutput('.image = (.extras | tostring);', derivedList).image,
  '["from-the-index","and-another"]',
);
strictEqual(
  collectionError('append(.extras; "mine");', derivedList).code,
  'computed-read-only',
);
deepStrictEqual(
  collectionPlan('append(.tags; "z");', {
    computeds: { tags: ['from-the-index'] },
  }).output,
  { ...collectionSnapshot, tags: ['language', 'web', 'z'] },
);
// A position spelled as an object key is a position all the same, so a
// collection the Card does not store stays empty rather than taking the
// overlay's rows.
const objectKeyedRows: BxlMutationOverlays = {
  computeds: { extras: { 0: 'first', 1: 'second' } },
};
strictEqual(
  collectionOutput('.image = ((.extras | length) | tostring);', objectKeyedRows)
    .image,
  '0',
);

// Reaching a supplied value may take containers the Card does not hold either.
// An update that carries one along must not store it: what the Card held comes
// back, whether that was a `null` or nothing at all.
const graftedInto: BxlMutationOverlays = {
  computeds: { meta: { origin: { name: 'from-the-index' } } },
};
deepStrictEqual(
  collectionPlan('.meta |= (. + {"note": "x"});', graftedInto).output,
  collectionPlan('.meta |= (. + {"note": "x"});').output,
);
strictEqual(
  collectionOutput('.image = .meta.origin.name;', graftedInto).image,
  'from-the-index',
);

// The overlay layer is inert without overlays: no index, no grafts, and the
// planner's own view of the document is the snapshot it was handed.
const inert = mergeBxlMutationOverlays(collectionSnapshot, undefined);
strictEqual(inert.index, EMPTY_OVERLAY_INDEX);
deepStrictEqual(inert.root, collectionSnapshot);
ok(inert.root !== collectionSnapshot);
strictEqual(
  mergeBxlMutationOverlays(collectionSnapshot, {}).index,
  EMPTY_OVERLAY_INDEX,
);
strictEqual(
  mergeBxlMutationOverlays(collectionSnapshot, { unavailable: [] }).index,
  EMPTY_OVERLAY_INDEX,
);

console.log(
  'BXL Boxel card-source adapter: Definition schema, computed skips, recursive metadata, structural collections, RRI/relative relationship matrix, preservation, stale-plan safety, and read-only computed/linked overlays passed',
);
