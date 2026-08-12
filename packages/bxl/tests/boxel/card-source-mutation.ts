import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert';
import {
  BxlMutationError,
  applyBxlMutationPlanToCardSource,
  mutateBxlCardSource,
  mutationSchemaForCardSource,
  prepareBxlMutation,
  snapshotBxlCardSource,
  type BxlBoxelSourceDefinition,
  type BxlCardSourceDocument,
  type BxlCardSourceRelationship,
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
console.log(
  'BXL Boxel card-source adapter: Definition schema, computed skips, recursive metadata, structural collections, RRI/relative relationship matrix, preservation, and stale-plan safety passed',
);
