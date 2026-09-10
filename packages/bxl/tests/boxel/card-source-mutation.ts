import {
  deepStrictEqual,
  doesNotThrow,
  ok,
  strictEqual,
  throws,
} from 'node:assert';
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
  type BxlMutationJson,
  type BxlMutationSchema,
  mergeBxlMutationOverlays,
  type BxlMutationOverlays,
  type BxlMutationUnavailableOverlay,
  type BxlMutationReadEvent,
} from '../../src/mutation/index.ts';
import { evaluateBxl } from '../../src/index.ts';
import { mutationBuiltinLibraries } from '../../src/bxl/registry/index.ts';
import { withRequestContext } from '../../src/jqtools/evaluate/runtimeState.ts';

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
// The request-context builtins. A card operation reads the caller's payload
// through `params`, the caller through `actor`, and the stored document
// through `instance`; the host supplies all three through `context`.
const requestContext = {
  params: { tag: 'typed', expectedStatus: 'language', caption: 'from Ada' },
  actor: { id: 'user:ada', displayName: 'Ada' },
  instance: { id: 'https://example.test/TierItem/typescript', revision: 7 },
};

const contextSource = sourceFixture();
const contextResult = mutateBxlCardSource(
  contextSource,
  'assert(.tags[0] == params("expectedStatus"), "tags must still lead with the language");\n' +
    'append(.tags; params("tag"));\n' +
    'append(.tags; actor("id"));\n' +
    '.image = instance("id");',
  {
    schema,
    syntax: 'solidified',
    programId: 'request-context-builtins',
    context: requestContext,
    ...projectionOptions,
  },
);
deepStrictEqual(
  contextResult.document.data.attributes?.tags,
  ['language', 'web', 'typed', 'user:ada'],
  'append reads the payload through params and the caller through actor',
);
strictEqual(
  contextResult.document.data.attributes?.image,
  'https://example.test/TierItem/typescript',
  'instance("id") is usable as a written value',
);
deepStrictEqual(
  contextSource,
  sourceFixture(),
  'the input source document is still immutable',
);

// `actor()` and `instance()` with no argument hand the program the whole
// object, so a caption can be composed from several of its fields.
const wholeObjectResult = mutateBxlCardSource(
  sourceFixture(),
  '.image = actor().displayName + " · " + (instance().revision | tostring);',
  {
    schema,
    syntax: 'solidified',
    programId: 'request-context-whole-objects',
    context: requestContext,
    ...projectionOptions,
  },
);
strictEqual(wholeObjectResult.document.data.attributes?.image, 'Ada · 7');

// A false `assert` reading the payload fails the program rather than the
// builtin: the value arrived, the precondition did not hold.
throws(
  () =>
    mutateBxlCardSource(
      sourceFixture(),
      'assert(.tags[0] == params("tag"), "tags must lead with the new tag");',
      {
        schema,
        syntax: 'solidified',
        programId: 'request-context-assert-fails',
        context: requestContext,
        ...projectionOptions,
      },
    ),
  (error: unknown) =>
    error instanceof BxlMutationError &&
    /tags must lead with the new tag/.test(error.message),
  'assert reads the payload and still fails on a false precondition',
);

// A host that supplies no context at all gets an error naming the call, not a
// program that quietly appended `null`.
throws(
  () =>
    mutateBxlCardSource(sourceFixture(), 'append(.tags; params("tag"));', {
      schema,
      syntax: 'solidified',
      programId: 'request-context-missing',
      ...projectionOptions,
    }),
  (error: unknown) =>
    error instanceof BxlMutationError &&
    /params\(key\) needs a request context/.test(error.message),
  'a program naming params without a context fails',
);

// The same for a slot the host left out of the context it did supply.
throws(
  () =>
    mutateBxlCardSource(sourceFixture(), 'append(.tags; actor("id"));', {
      schema,
      syntax: 'solidified',
      programId: 'request-context-missing-slot',
      context: { params: requestContext.params },
      ...projectionOptions,
    }),
  (error: unknown) =>
    error instanceof BxlMutationError &&
    /actor\(key\) needs the caller identity/.test(error.message),
  'a program naming actor without an actor in the context fails',
);

// The operation layer validates declared keys before a program runs; this is
// the backstop, and it names the keys that are there.
throws(
  () =>
    mutateBxlCardSource(
      sourceFixture(),
      'append(.tags; params("undeclared"));',
      {
        schema,
        syntax: 'solidified',
        programId: 'request-context-undeclared-key',
        context: requestContext,
        ...projectionOptions,
      },
    ),
  (error: unknown) =>
    error instanceof BxlMutationError &&
    /params\(key\) asks for "undeclared"/.test(error.message) &&
    /"caption", "expectedStatus", "tag"/.test(error.message),
  'an undeclared payload key fails and the error lists the declared ones',
);

// A plan never shares structure with the host's context object, and a host
// that reuses that object cannot change a plan already made. The isolation
// comes from the planner copying every value on its way into the result — the
// per-statement `clone(working)` and the intent recording — not from the
// context being copied on the way in, which is why this asserts the property
// rather than the mechanism.
//
// It has to read an *object* to assert anything at all: a string is copied by
// value wherever it lands, so a case reading one holds no matter what the
// planner does with references.
const contextSchema: BxlMutationSchema = {
  fields: [
    {
      key: 'blob',
      label: 'Blob',
      path: ['blob'],
      fieldType: 'contains',
      writable: true,
      fields: [
        {
          key: 'n',
          label: 'N',
          path: ['blob', 'n'],
          fieldType: 'contains',
          writable: true,
        },
      ],
    },
    {
      key: 'copy',
      label: 'Copy',
      path: ['copy'],
      fieldType: 'contains',
      writable: true,
    },
  ],
};
const isolationProbe = prepareBxlMutation(
  '.blob = params("payload");\n.copy = params("payload");\n.blob.n = 42;',
  { targetKind: 'card', syntax: 'solidified', schema: contextSchema },
);
const livePayload = { n: 1, nested: { deep: 'first' } };
const isolationPlan = isolationProbe.plan(
  { blob: null, copy: null },
  {
    programId: 'request-context-isolated',
    context: { params: { payload: livePayload } },
  },
);
const isolated = isolationPlan.output as {
  blob: { n: number; nested: unknown };
  copy: { nested: unknown };
};
ok(isolated.blob !== livePayload, 'the written value is not the host object');
ok(
  isolated.blob.nested !== livePayload.nested,
  'isolation reaches nested objects, not just the top level',
);
ok(
  isolated.blob.nested !== isolated.copy.nested,
  'two reads of one key do not alias each other in the result',
);
strictEqual(
  livePayload.n,
  1,
  'a later statement writing through the value it read does not reach the host object',
);

// The plan is settled: a host reusing its object afterwards cannot move it.
livePayload.n = 99;
livePayload.nested.deep = 'mutated-after-the-fact';
deepStrictEqual(isolationPlan.output, {
  blob: { n: 42, nested: { deep: 'first' } },
  copy: { n: 1, nested: { deep: 'first' } },
});
// `BxlMutationIntent` is a union and only the writing variants carry `after`.
const firstIntent = isolationPlan.intents[0];
ok(firstIntent && 'after' in firstIntent, 'the first intent writes a value');
deepStrictEqual(
  firstIntent && 'after' in firstIntent ? firstIntent.after : undefined,
  {
    n: 1,
    nested: { deep: 'first' },
  },
);

// A context carrying something that is not JSON fails the plan, naming the
// path, rather than putting a live Map or a bigint in front of the planner —
// `params("v") | tostring` on a bigint yields `undefined`, which is the
// silent unset these builtins exist to refuse.
for (const [typeName, value] of [
  ['Map', new Map([['k', 1]])],
  ['bigint', 10n],
  ['Date', new Date(0)],
  ['URL', new URL('https://example.test/')],
] as const) {
  throws(
    () =>
      isolationProbe.plan(
        { blob: null, copy: null },
        {
          programId: 'request-context-non-json',
          context: { params: { payload: value } } as never,
        },
      ),
    (error: unknown) =>
      error instanceof BxlMutationError &&
      error.code === 'context-not-json' &&
      error.message.includes('context.params.payload') &&
      error.message.includes(`its type is ${typeName}`),
    `a context holding a ${typeName} is refused`,
  );
}

// `NaN` and the infinities have no JSON form and would reach the document as
// `null` — a value the host never sent.
for (const notFinite of [NaN, Infinity, -Infinity] as const) {
  throws(
    () =>
      isolationProbe.plan(
        { blob: null, copy: null },
        {
          programId: 'request-context-non-finite',
          context: { params: { payload: notFinite } } as never,
        },
      ),
    (error: unknown) =>
      error instanceof BxlMutationError && error.code === 'context-not-json',
    `a context holding ${String(notFinite)} is refused`,
  );
}

// A value handed to a program is a copy. A builtin is free to write into its
// argument and several do — the two-argument validator.js helpers merge their
// defaults into the options object they are given — so without this the
// host's own context object would carry whatever a program's builtins wrote
// into it.
{
  const hostInstance = { nested: { n: 1 } };
  const handed = withRequestContext({ instance: hostInstance }, () =>
    evaluateBxl('instance()', null, {
      libraries: mutationBuiltinLibraries(),
    }),
  ).value as { nested: { n: number } };
  ok(handed !== hostInstance, 'the whole slot is handed over as a copy');
  ok(
    handed.nested !== hostInstance.nested,
    'the copy reaches nested objects, not just the top level',
  );
  handed.nested.n = 99;
  strictEqual(
    hostInstance.nested.n,
    1,
    'writing into what a program was handed does not reach the host object',
  );

  const hostPayload = { obj: { n: 1 } };
  const key = withRequestContext({ params: hostPayload }, () =>
    evaluateBxl('params("obj")', null, {
      libraries: mutationBuiltinLibraries(),
    }),
  ).value as { n: number };
  ok(key !== hostPayload.obj, 'a keyed read is handed over as a copy too');
  key.n = 99;
  strictEqual(
    hostPayload.obj.n,
    1,
    'and writing into it leaves the host alone',
  );
}

// An array entry cannot be absent the way an object member can: an absent
// member serializes as absent, an absent entry serializes as `null` — a value
// the host never sent. A hole reads as `undefined` and is refused the same
// way.
// Built rather than written as a literal: a sparse array literal is a lint
// error, and the point is a genuine hole.
const holed = new Array<unknown>(3);
holed[0] = 1;
holed[2] = 3;
for (const [description, payload] of [
  ['an explicit undefined entry', [1, undefined, 3]],
  ['a hole', holed],
  ['a nested undefined entry', [[undefined]]],
] as const) {
  throws(
    () =>
      isolationProbe.plan(
        { blob: null, copy: null },
        {
          programId: 'request-context-array-hole',
          context: { params: { payload } } as never,
        },
      ),
    (error: unknown) =>
      error instanceof BxlMutationError &&
      error.code === 'context-not-json' &&
      /has no value/.test(error.message),
    `${description} in a context array is refused`,
  );
}

// A `null` entry is a real value and passes. This writes the array whole, so
// it needs a program that does not also index into what it wrote.
deepStrictEqual(
  (
    prepareBxlMutation('.blob = params("payload");', {
      targetKind: 'card',
      syntax: 'solidified',
      schema: contextSchema,
    }).plan(
      { blob: null, copy: null },
      {
        programId: 'request-context-array-null',
        context: { params: { payload: [1, null, 3] } } as never,
      },
    ).output as { blob: unknown }
  ).blob,
  [1, null, 3],
);

// A `Symbol.toStringTag` can blank the built-in tag. An empty name has to be
// reported rather than read as "no problem found", or a branded exotic value
// reaches the document as itself.
for (const exotic of [new Map([['k', 1]]), new Date(0)] as const) {
  Object.defineProperty(exotic, Symbol.toStringTag, {
    value: '',
    configurable: true,
  });
  throws(
    () =>
      isolationProbe.plan(
        { blob: null, copy: null },
        {
          programId: 'request-context-blank-tag',
          context: { params: { payload: exotic } } as never,
        },
      ),
    (error: unknown) =>
      error instanceof BxlMutationError && error.code === 'context-not-json',
    'an exotic value whose type name was blanked is still refused',
  );
}

// A key name in a diagnostic is bounded, and cut by code point so the cut
// cannot leave a lone surrogate in the message. Keys come from host data, so
// a count cap alone still lets one key dominate its own error message.
{
  const longKey = `${'b'.repeat(59)}😀c`.repeat(20);
  let message = '';
  try {
    mutateBxlCardSource(sourceFixture(), 'Image = params("nope");', {
      schema,
      programId: 'request-context-key-length',
      context: { params: { [longKey]: 1 } } as never,
      ...projectionOptions,
    });
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  ok(message.includes('…'), 'a long key name is truncated');
  ok(!message.includes(longKey), 'the whole key does not reach the message');
  ok(
    message.length < 400,
    `the message stays bounded, got ${message.length} characters`,
  );
  // `encodeURIComponent` throws `URIError` on a lone surrogate, which is what
  // a cut landing inside a surrogate pair leaves behind.
  doesNotThrow(
    () => encodeURIComponent(message),
    'truncating by code point leaves no lone surrogate in the message',
  );
}

// A plain object is plain whatever its prototype chain says: an object
// carrying only a class's own data fields holds nothing but JSON, and
// refusing it for its prototype would reject data a host may legitimately
// send. The check reads the built-in tag, not the constructor.
class DataOnlyActor {
  id = 'user:ada';
}
strictEqual(
  (
    isolationProbe.plan(
      { blob: null, copy: null },
      {
        programId: 'request-context-plain-tag',
        context: { params: { payload: new DataOnlyActor() } } as never,
      },
    ).output as { blob: { id: string } }
  ).blob.id,
  'user:ada',
  'an object holding only its own data fields is accepted',
);

// Shared structure is walked once per object, not once per path to it. A
// graph that merely shares subtrees has exponentially many paths, so a walk
// without that memo does exponentially many reads rather than hanging
// outright — counted here so the assertion cannot be timing-dependent.
{
  let sharedReads = 0;
  const shared: Record<string, unknown> = {};
  Object.defineProperty(shared, 'leaf', {
    enumerable: true,
    get() {
      sharedReads += 1;
      return 1;
    },
  });
  let graph: unknown = shared;
  for (let level = 0; level < 20; level += 1) {
    graph = { left: graph, right: graph };
  }
  // A program that never names the context, so the only reads are the
  // plan-time check's own.
  prepareBxlMutation('.copy = "unrelated";', {
    targetKind: 'card',
    syntax: 'solidified',
    schema: contextSchema,
  }).plan(
    { blob: null, copy: null },
    {
      programId: 'request-context-shared-structure',
      context: { params: { payload: graph } } as never,
    },
  );
  strictEqual(
    sharedReads,
    1,
    'a shared subtree is validated once, not once per path reaching it',
  );
}

// The walk reaches nested values and does not loop on a cycle.
throws(
  () =>
    isolationProbe.plan(
      { blob: null, copy: null },
      {
        programId: 'request-context-non-json-nested',
        context: { params: { payload: [{ when: new Date(0) }] } } as never,
      },
    ),
  (error: unknown) =>
    error instanceof BxlMutationError &&
    error.message.includes('context.params.payload[0].when'),
);
const cyclicPayload: Record<string, unknown> = { v: 1 };
cyclicPayload.self = cyclicPayload;
throws(
  () =>
    isolationProbe.plan(
      { blob: null, copy: null },
      {
        programId: 'request-context-cyclic',
        context: { params: cyclicPayload } as never,
      },
    ),
  (error: unknown) =>
    error instanceof BxlMutationError &&
    /cyclic at context\.params\.self/.test(error.message),
);

// A program that names none of the builtins behaves the same whether or not a
// context is supplied.
const withoutContext = mutateBxlCardSource(
  sourceFixture(),
  'append(.tags; "plain");',
  {
    schema,
    syntax: 'solidified',
    programId: 'request-context-unused-absent',
    ...projectionOptions,
  },
);
const withContext = mutateBxlCardSource(
  sourceFixture(),
  'append(.tags; "plain");',
  {
    schema,
    syntax: 'solidified',
    programId: 'request-context-unused-absent',
    context: requestContext,
    ...projectionOptions,
  },
);
deepStrictEqual(withContext.document, withoutContext.document);
deepStrictEqual(withContext.plan, withoutContext.plan);

// Readable syntax reaches the same builtins. The call name passes through as
// written; the quoted key is held literal by the compiler, which is what the
// colliding-label case below relies on.
const readableResult = mutateBxlCardSource(
  sourceFixture(),
  'append(Tags, params("tag"));\nImage = actor("id");',
  {
    schema,
    programId: 'request-context-readable',
    context: requestContext,
    ...projectionOptions,
  },
);
deepStrictEqual(readableResult.document.data.attributes?.tags, [
  'language',
  'web',
  'typed',
]);
strictEqual(readableResult.document.data.attributes?.image, 'user:ada');

// How a key is read, and how the diagnostic lists keys. Both are properties
// of the accessor protocol rather than of any value, so they need host
// objects that observe being read.
{
  const readProbe = prepareBxlMutation('.title = actor("lazy");', {
    targetKind: 'card',
    syntax: 'solidified',
    schema: {
      fields: [
        {
          key: 'title',
          label: 'Title',
          path: ['title'],
          fieldType: 'contains',
          writable: true,
        },
      ],
    },
  });

  // An accessor is read once per lookup, and the program receives the value
  // that was checked — not whatever a second read would return.
  let reads = 0;
  const counting: Record<string, unknown> = { id: 'user:ada' };
  Object.defineProperty(counting, 'lazy', {
    enumerable: true,
    get() {
      reads += 1;
      return `read-${reads}`;
    },
  });
  const readPlan = readProbe.plan(
    { title: null },
    {
      programId: 'request-context-single-read',
      context: { actor: counting } as never,
    },
  );
  strictEqual(
    (readPlan.output as { title: string }).title,
    'read-2',
    'the program gets the value the lookup checked, not a later re-read',
  );
  strictEqual(
    reads,
    2,
    'one read for the plan-time context check and one for the lookup, never a third',
  );

  // The listing names what is actually readable: an own non-enumerable key
  // works, so it is listed, while a key held with `undefined` does not.
  const mixed: Record<string, unknown> = { visible: 1, absent: undefined };
  Object.defineProperty(mixed, 'hidden', {
    enumerable: false,
    value: 'readable',
  });
  strictEqual(
    mutateBxlCardSource(sourceFixture(), 'Image = params("hidden");', {
      schema,
      programId: 'request-context-non-enumerable',
      context: { params: mixed } as never,
      ...projectionOptions,
    }).document.data.attributes?.image,
    'readable',
    'an own non-enumerable key is readable',
  );
  throws(
    () =>
      mutateBxlCardSource(sourceFixture(), 'Image = params("nope");', {
        schema,
        programId: 'request-context-listing',
        context: { params: mixed } as never,
        ...projectionOptions,
      }),
    (error: unknown) =>
      error instanceof BxlMutationError &&
      error.message.includes('"hidden"') &&
      error.message.includes('"visible"') &&
      !error.message.includes('"absent"'),
    'the listing names every readable key and no unreadable one',
  );

  // Producing that diagnostic must not invoke host accessors, or one throwing
  // getter anywhere in the object replaces the message with its own error.
  const trapped: Record<string, unknown> = { ok: 1 };
  Object.defineProperty(trapped, 'trap', {
    enumerable: true,
    get() {
      throw new Error('accessor must not run for a diagnostic');
    },
  });
  throws(
    () =>
      prepareBxlMutation('.title = params("nope");', {
        targetKind: 'card',
        syntax: 'solidified',
        schema: {
          fields: [
            {
              key: 'title',
              label: 'Title',
              path: ['title'],
              fieldType: 'contains',
              writable: true,
            },
          ],
        },
      }).plan(
        { title: null },
        {
          programId: 'request-context-diagnostic-accessors',
          // The plan-time check reads accessors and reports this one; what
          // matters is that the message below is the one it produces.
          context: { params: { ok: 1 } } as never,
        },
      ),
    (error: unknown) =>
      error instanceof BxlMutationError &&
      /asks for "nope"/.test(error.message),
    'a missing key reports as a missing key',
  );
  ok(
    (() => {
      try {
        // Reached directly, so the plan-time check is not in the way and the
        // diagnostic itself has to survive the throwing accessor.
        withRequestContext({ params: trapped }, () =>
          evaluateBxl('params("nope")', null, {
            libraries: mutationBuiltinLibraries(),
          }),
        );
        return false;
      } catch (error) {
        return (
          error instanceof Error &&
          /asks for "nope"/.test(error.message) &&
          error.message.includes('"trap"') &&
          !error.message.includes('accessor must not run')
        );
      }
    })(),
    'the diagnostic lists a throwing accessor without invoking it',
  );
}

// A payload key named after a field of the card being edited. Readable syntax
// resolves a quoted string against the field labels, so this is the case where
// the key has to win: reading the card's own `image` here would silently write
// the value the program was replacing.
const collidingResult = mutateBxlCardSource(
  sourceFixture(),
  'Image = params("image");',
  {
    schema,
    programId: 'request-context-key-shadows-field',
    context: { params: { image: 'https://cdn.example.test/from-payload.svg' } },
    ...projectionOptions,
  },
);
strictEqual(
  collidingResult.document.data.attributes?.image,
  'https://cdn.example.test/from-payload.svg',
  'a payload key named after a field reads the payload, not the field',
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
      key: 'hints',
      label: 'Hints',
      kind: 'array' as const,
      fieldType: 'containsMany' as const,
      writable: true,
    },
    {
      key: 'extras',
      label: 'Extras',
      kind: 'array' as const,
      fieldType: 'containsMany' as const,
      writable: false,
      writeBehavior: 'skip' as const,
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
        {
          key: 'refs',
          label: 'Refs',
          kind: 'array' as const,
          fieldType: 'containsMany' as const,
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
  // What a projection manufactures for a list Field the Card never persists.
  hints: [],
  extras: [],
  meta: { note: 'kept', stamp: null, refs: [] },
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
  { note: 'kept derived', stamp: null, refs: [] },
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
  // `summary` and `meta.stamp` are `null` in the Card too, so these are the
  // leaves that would be claimed if a `null` counted as a value.
  computeds: { image: null, summary: null, meta: { stamp: null } },
  linked: { tags: null, meta: { note: null } },
};
deepStrictEqual(
  collectionOutput('.summary = {"text": "mine"};', wholeDocument).summary,
  { text: 'mine' },
);
deepStrictEqual(collectionOutput('.meta.stamp = "mine";', wholeDocument).meta, {
  note: 'kept',
  stamp: 'mine',
  refs: [],
});
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
  { note: 'n', stamp: null, refs: [] },
);
deepStrictEqual(collectionPlan('append(.tags; "z");', wholeDocument).output, {
  ...collectionSnapshot,
  tags: ['language', 'web', 'z'],
});
// A Field the index does answer, in the same overlay, is still covered.
strictEqual(
  collectionError('.summary = {"text": "x"};', {
    ...wholeDocument,
    computeds: { image: null, summary: { text: 'derived' } },
  }).code,
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
// Grafted onto a prototype, the value would read back at a path no overlay
// supplied — and be reported as the Card's own.
const hostileEvents: BxlMutationReadEvent[] = [];
prepareBxlMutation('.image = ((.pwned // "clean") | tostring);', {
  targetKind: 'card',
  schema: collectionSchema,
  syntax: 'solidified',
}).plan(collectionSnapshot, {
  programId: 'overlay-prototype',
  overlays: { computeds: hostileKey },
  onRead: (event) => hostileEvents.push(event),
});
deepStrictEqual(hostileEvents, [
  { path: 'pwned', tier: 'source', outcome: 'null' },
]);
// `prototype` and `constructor` are refused on the same grounds, and neither
// is spelled with the leading underscore that marks an index column, so this
// is the rule that has to catch them.
strictEqual(
  collectionOutput('.image = ((.prototype.pwned // "clean") | tostring);', {
    computeds: JSON.parse('{"prototype":{"pwned":"yes"}}'),
  }).image,
  'clean',
);
strictEqual(
  collectionPlan('.tags = ["z"];', {
    unavailable: [
      { path: 'constructor.prototype', tier: 'computed', reason: 'key-absent' },
    ],
  }).affected,
  1,
);

// `search_doc` carries the index's own bookkeeping beside the Card's
// searchable Fields. A Card declares none of it, so passing the column
// wholesale neither adds Fields to the Card nor makes reading it an overlay
// read — otherwise every whole-Card read on every Card would need the opt-in.
const searchDocShape: BxlMutationOverlays = {
  linked: {
    _title: 'derived title',
    _cardType: 'Card',
    _isCardInstanceFile: true,
  },
};
deepStrictEqual(
  collectionPlan('.image = (. | tostring);', searchDocShape).output,
  collectionPlan('.image = (. | tostring);').output,
);
strictEqual(
  collectionPlan(
    'assert((. | keys | length) > 0; "m");\n.image = "ran";',
    searchDocShape,
  ).affected,
  1,
);

// An empty list says nothing, the same as a `null`. A projection manufactures
// one for every list Field the Card leaves unset, so a host passing a column
// wholesale hands one over for each — and claiming those would make every
// empty writable list read-only.
const emptyLists: BxlMutationOverlays = {
  computeds: { image: null, hints: [] },
  linked: { extras: [] },
};
deepStrictEqual(
  collectionPlan('append(.hints; "z");', emptyLists).output,
  collectionPlan('append(.hints; "z");').output,
);
deepStrictEqual(
  collectionPlan('.hints = ["z"];', emptyLists).output,
  collectionPlan('.hints = ["z"];').output,
);
strictEqual(
  collectionPlan(
    'assert((.hints | length) == 0; "m");\n.image = "ran";',
    emptyLists,
  ).affected,
  1,
);
// An update settles the same way whether the Card holds `[]` or `null` under
// a supplied value, since an expression that omits the path is not writing to
// it either way.
deepStrictEqual(
  collectionPlan('.meta |= {"note": .note};', {
    computeds: { meta: { refs: ['from-the-index'] } },
  }).output,
  collectionPlan('.meta |= {"note": .note};').output,
);

// A list is one value, not a place to descend into. A projection manufactures
// an empty list for a list Field the Card never persists, so an empty list is
// an absence like a `null`: a computed `containsMany` reads as the overlay
// supplied it, and is read-only whole.
const derivedExtras: BxlMutationOverlays = {
  computeds: { extras: ['from-the-index', 'and-another'] },
};
strictEqual(
  collectionOutput('.image = (.extras | tostring);', derivedExtras).image,
  '["from-the-index","and-another"]',
);
// The schema still answers first for the Field itself: it declares `extras`
// computed, so a write to it is the intentional no-op it already was.
strictEqual(
  collectionPlan('append(.extras; "mine");', derivedExtras).affected,
  0,
);
strictEqual(collectionPlan('.extras = [];', derivedExtras).affected, 0);
// Where the schema has no opinion, the overlay is the backstop for a supplied
// list the same as for any other value.
strictEqual(
  collectionError('append(.hints; "mine");', {
    computeds: { hints: ['from-the-index'] },
  }).code,
  'computed-read-only',
);
deepStrictEqual(
  collectionPlan('append(.tags; "z");', {
    computeds: { tags: ['from-the-index'] },
  }).output,
  { ...collectionSnapshot, tags: ['language', 'web', 'z'] },
);
// A position spelled as an object key is a position all the same, so it is
// dropped wherever it appears — including under a container the Card holds
// nothing in, where nothing else would stop it.
strictEqual(
  collectionOutput('.image = ((.extras | length) | tostring);', {
    computeds: { extras: { 0: 'first', 1: 'second' } },
  }).image,
  '0',
);
strictEqual(
  collectionOutput('.image = ((.meta.list // "none") | tostring);', {
    computeds: { meta: { list: { 0: 'first' } } },
  }).image,
  'none',
);
// Nor is a list the Card stores reached into by a path that reads like a
// Field name: it is the list being a list that stops the graft, not the
// spelling of what comes after it. Were it grafted, the list would read as
// carrying an overlay value.
const listEvents: BxlMutationReadEvent[] = [];
prepareBxlMutation('.image = (.tags | tostring);', {
  targetKind: 'card',
  schema: collectionSchema,
  syntax: 'solidified',
}).plan(collectionSnapshot, {
  programId: 'overlay-into-list',
  overlays: { computeds: { tags: { name: 'from-the-index' } } },
  onRead: (event) => listEvents.push(event),
});
deepStrictEqual(listEvents, [
  { path: 'tags', tier: 'source', outcome: 'value' },
]);

// An `unavailable` entry the planner cannot read is a read it would wrongly
// allow, so it is refused rather than guessed at or quietly dropped.
for (const entry of [
  { path: 42, tier: 'computed', reason: 'key-absent' },
  { path: null, tier: 'computed', reason: 'key-absent' },
  { path: 'summary.text', tier: 'made-up', reason: 'key-absent' },
  { path: 'summary.text', tier: 'computed', reason: 'made-up' },
]) {
  strictEqual(
    collectionError('.image = "x";', {
      unavailable: [entry as unknown as BxlMutationUnavailableOverlay],
    }).code,
    'overlay-invalid',
    JSON.stringify(entry),
  );
}
// A path named twice is answered by the last entry, at the path and above it
// alike.
deepStrictEqual(
  collectionError('.image = .summary.text;', {
    unavailable: [
      { path: 'summary.text', tier: 'computed', reason: 'not-indexed' },
      { path: 'summary.text', tier: 'linked', reason: 'key-absent' },
    ],
  }).details,
  { path: 'summary.text', tier: 'linked', reason: 'key-absent' },
);
// The root has no name of its own, so a message says what it is.
ok(
  collectionError(
    'assert((. | tostring) != ""; "m");',
    derivedExtras,
  ).message.includes('the whole Card'),
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

// A relationship reached through a contained value. `card(…)` is resolved
// wherever it stands in the value a statement writes, and what it names
// becomes an edge in the Card's relationship map: a link has no member of the
// contained value to live in, so the stored value never carries one.
const zoe = 'https://example.test/Friend/zoe';
const ana = 'https://example.test/Friend/ana';
const ghost = 'https://example.test/Friend/ghost';
const nestedLinkCards: Record<string, BxlMutationJson> = {
  [zoe]: { id: zoe },
  [ana]: { id: ana },
};

function nestedLinkMutation(
  programId: string,
  program: string,
  baseRevision?: string,
) {
  return mutateBxlCardSource(richSourceFixture(), program, {
    schema: richSchema,
    syntax: 'solidified',
    programId,
    ...richProjectionOptions,
    ...(baseRevision === undefined ? {} : { baseRevision }),
    context: { params: { who: zoe } },
    resolveCard: (id: string) => nestedLinkCards[id],
    serializeContainedValue: () => ({
      meta: { adoptsFrom: { module: '../fields', name: 'ZetaExample' } },
    }),
  });
}

/** The same run with a pinned base revision, which `insert_at` requires. */
function nestedLinkMutationAt(programId: string, program: string) {
  return nestedLinkMutation(programId, program, 'revision-1');
}

function nestedLinkError(
  programId: string,
  program: string,
  run: (programId: string, program: string) => unknown = nestedLinkMutation,
) {
  try {
    run(programId, program);
  } catch (error) {
    if (error instanceof BxlMutationError) return error;
    throw error;
  }
  throw new Error(`${programId} was expected to fail`);
}

const zeta = '"key":"z","label":"Zeta","aliases":[]';

// An appended contained value: the link is an intent of its own, and the value
// the collection stores holds everything but the link.
const appendedLink = nestedLinkMutation(
  'append-nested-link',
  `append(.examples;{${zeta},"parts":[],"friend":card(params("who"))});`,
);
deepStrictEqual(appendedLink.plan.intents, [
  {
    op: 'insert',
    collection: ['examples'],
    index: 3,
    value: { key: 'z', label: 'Zeta', aliases: [], parts: [] },
  },
  { op: 'relate', field: ['examples', 3, 'friend'], cardId: zoe },
]);
deepStrictEqual(
  (
    appendedLink.document.data.attributes?.examples as Array<
      Record<string, unknown>
    >
  )[3],
  { key: 'z', label: 'Zeta', aliases: [], parts: [] },
);
deepStrictEqual(relationship(appendedLink.document, 'examples.3.friend'), {
  links: { self: '../Friend/zoe' },
});

// The same marker two levels down, inside a contained value of a contained
// value. Depth is not a special case: the marker's path inside the value names
// the Field once the two are joined.
const deepLink = nestedLinkMutation(
  'append-deep-nested-link',
  `append(.examples;{${zeta},"parts":[{"key":"p9","owner":card(params("who"))}]});`,
);
deepStrictEqual(deepLink.plan.intents, [
  {
    op: 'insert',
    collection: ['examples'],
    index: 3,
    value: { key: 'z', label: 'Zeta', aliases: [], parts: [{ key: 'p9' }] },
  },
  { op: 'relate', field: ['examples', 3, 'parts', 0, 'owner'], cardId: zoe },
]);
deepStrictEqual(relationship(deepLink.document, 'examples.3.parts.0.owner'), {
  links: { self: '../Friend/zoe' },
});

// An assignment rather than an append. Replacing a contained value clears the
// sidecars the old one had, and the marker writes the new edge after.
const assignedLink = nestedLinkMutation(
  'assign-nested-link',
  '.examples[1] = {"key":"b2","label":"Beta 2","aliases":[],"parts":[],' +
    '"friend":card(params("who"))};',
);
deepStrictEqual(assignedLink.plan.intents, [
  {
    op: 'set',
    path: ['examples', 1],
    before: {
      key: 'b',
      label: 'Beta',
      friend: { id: 'https://example.test/Friend/b' },
      aliases: [],
      parts: [],
    },
    after: { key: 'b2', label: 'Beta 2', aliases: [], parts: [] },
  },
  { op: 'relate', field: ['examples', 1, 'friend'], cardId: zoe },
]);
deepStrictEqual(relationship(assignedLink.document, 'examples.1.friend'), {
  links: { self: '../Friend/zoe' },
});

// An array of contained values where only some members carry a link.
const someLinked = nestedLinkMutation(
  'assign-collection-partly-linked',
  '.examples = [{"key":"x","label":"X","aliases":[],"parts":[],' +
    '"friend":card(params("who"))},' +
    '{"key":"y","label":"Y","aliases":[],"parts":[]}];',
);
deepStrictEqual(someLinked.plan.intents, [
  {
    op: 'set',
    path: ['examples'],
    before: [
      {
        key: 'a',
        label: 'Alpha',
        friend: { id: 'https://example.test/Friend/a' },
        aliases: ['A-one', 'A-two'],
        parts: [
          { key: 'p1', owner: { id: 'https://example.test/Friend/part-1' } },
          { key: 'p2', owner: { id: 'https://example.test/Friend/part-2' } },
        ],
      },
      {
        key: 'b',
        label: 'Beta',
        friend: { id: 'https://example.test/Friend/b' },
        aliases: [],
        parts: [],
      },
      {
        key: 'c',
        label: 'Gamma',
        friend: { id: 'https://example.test/Friend/c' },
        aliases: [],
        parts: [],
      },
    ],
    after: [
      { key: 'x', label: 'X', aliases: [], parts: [] },
      { key: 'y', label: 'Y', aliases: [], parts: [] },
    ],
  },
  { op: 'relate', field: ['examples', 0, 'friend'], cardId: zoe },
]);
deepStrictEqual(relationship(someLinked.document, 'examples.0.friend'), {
  links: { self: '../Friend/zoe' },
});
strictEqual(
  someLinked.document.data.relationships?.['examples.1.friend'],
  undefined,
);

// A marker naming a Card the Store did not hand over is refused wherever it
// stands, exactly as the whole-value form is.
strictEqual(
  nestedLinkError(
    'nested-marker-card-missing',
    `append(.examples;{${zeta},"parts":[],"friend":card(${JSON.stringify(ghost)})});`,
  ).code,
  'card-not-loaded',
);
strictEqual(
  nestedLinkError(
    'whole-value-marker-card-missing',
    `.examples[0].friend = card(${JSON.stringify(ghost)});`,
  ).code,
  'card-not-loaded',
);

// A marker in a slot the Card stores as a value has no edge to write.
strictEqual(
  nestedLinkError(
    'nested-marker-not-a-relationship',
    `append(.examples;{${zeta},"parts":[],"label":card(params("who"))});`,
  ).code,
  'card-reference-destination',
);

// The marker's argument is read against the input the value expression was
// handed, so the walk follows only the object, array and comma nodes that
// assemble a value. A marker somewhere that re-roots the input is reported
// rather than answered from the wrong place.
strictEqual(
  nestedLinkError(
    'nested-marker-reroots-input',
    '.examples |= map({"key":.key,"friend":card(params("who"))});',
  ).code,
  'card-marker-position',
);

// A whole-value marker plans as it always has, and so does a value with no
// marker in it.
deepStrictEqual(
  nestedLinkMutation(
    'whole-value-marker',
    '.examples[0].friend = card(params("who"));',
  ).plan.intents,
  [{ op: 'relate', field: ['examples', 0, 'friend'], cardId: zoe }],
);
deepStrictEqual(
  nestedLinkMutation(
    'append-without-marker',
    `append(.examples;{${zeta},"parts":[]});`,
  ).plan.intents,
  [
    {
      op: 'insert',
      collection: ['examples'],
      index: 3,
      value: { key: 'z', label: 'Zeta', aliases: [], parts: [] },
    },
  ],
);

// `card(id)` is the only spelling that names a relationship target. A marker
// is recognised by an identity the planner mints from a `card(…)` node the
// program itself wrote — whether that node is the whole value or sits inside
// one — so a value built to look like one is plain JSON wherever it stands: at
// a relationship Field it is refused the way any other value there is, and in
// a slot the Card stores as a value it is stored as it reads.
const forgedReference = `{"kind":"card-reference","id":${JSON.stringify(zoe)}}`;
strictEqual(
  nestedLinkError(
    'forged-reference-at-a-relationship',
    `.examples[0].friend = ${forgedReference};`,
  ).code,
  'relationship-value-required',
);
deepStrictEqual(
  nestedLinkMutation(
    'forged-reference-at-a-value-slot',
    `.examples[0].key = ${forgedReference};`,
  ).plan.intents,
  [
    {
      op: 'set',
      path: ['examples', 0, 'key'],
      before: 'a',
      after: { kind: 'card-reference', id: zoe },
    },
  ],
);
deepStrictEqual(
  nestedLinkMutation(
    'forged-reference-nested-in-a-contained-value',
    `append(.examples;{${zeta},"parts":[],"label":${forgedReference}});`,
  ).plan.intents,
  [
    {
      op: 'insert',
      collection: ['examples'],
      index: 3,
      value: {
        key: 'z',
        label: { kind: 'card-reference', id: zoe },
        aliases: [],
        parts: [],
      },
    },
  ],
);

// Every route that reaches a relationship refuses the forged shape, not just a
// root assignment: a `linksTo` below a contained value, an update, a branch
// that answers, and each of the three ways an edge joins a link collection.
for (const [programId, program] of [
  [
    'forged-below-a-contained-value',
    `.examples[0].parts[0].owner = ${forgedReference};`,
  ],
  ['forged-through-an-update', `.examples[0].friend |= ${forgedReference};`],
  [
    'forged-through-a-branch',
    `.examples[0].friend = (if true then ${forgedReference} else null end);`,
  ],
  [
    'forged-appended-to-a-link-collection',
    `append(.linked; ${forgedReference});`,
  ],
  [
    'forged-inserted-before-an-edge',
    `insert_item_before(${forgedReference}; .linked[0]);`,
  ],
] as const) {
  strictEqual(
    nestedLinkError(programId, program).code,
    'relationship-value-required',
    `${programId} refuses a value shaped like a reference`,
  );
}
// `insert_at` names a position, so it runs against a pinned base revision.
strictEqual(
  nestedLinkError(
    'forged-inserted-into-a-link-collection',
    `insert_at(.linked; 0; ${forgedReference});`,
    nestedLinkMutationAt,
  ).code,
  'relationship-value-required',
);

// `card(…)` reaches every one of those routes, so the refusals above are the
// spelling being enforced rather than the route being closed.
deepStrictEqual(
  nestedLinkMutationAt(
    'marker-inserted-into-a-link-collection',
    'insert_at(.linked; 0; card(params("who")));',
  ).plan.intents,
  [{ op: 'relate', field: ['linked'], cardId: zoe, index: 0 }],
);
deepStrictEqual(
  nestedLinkMutation(
    'marker-below-a-contained-value',
    '.examples[0].parts[0].owner = card(params("who"));',
  ).plan.intents,
  [{ op: 'relate', field: ['examples', 0, 'parts', 0, 'owner'], cardId: zoe }],
);
deepStrictEqual(
  nestedLinkMutation(
    'marker-through-an-update',
    '.examples[0].friend |= card(params("who"));',
  ).plan.intents,
  [{ op: 'relate', field: ['examples', 0, 'friend'], cardId: zoe }],
);
deepStrictEqual(
  nestedLinkMutation(
    'marker-inserted-before-an-edge',
    'insert_item_before(card(params("who")); .linked[0]);',
  ).plan.intents,
  [{ op: 'relate', field: ['linked'], cardId: zoe, index: 0 }],
);
deepStrictEqual(
  nestedLinkMutation(
    'marker-inserted-after-an-edge',
    'insert_item_after(card(params("who")); .linked[0]);',
  ).plan.intents,
  [{ op: 'relate', field: ['linked'], cardId: zoe, index: 1 }],
);

// A real marker in a slot the Card stores as a value still names a Field with
// no edge to write, which is the refusal the forged shape no longer draws.
strictEqual(
  nestedLinkError(
    'marker-at-a-value-slot',
    '.examples[0].key = card(params("who"));',
  ).code,
  'card-reference-destination',
);

// Compound assignment against a forged shape reaches the operator, because by
// then it is plain JSON: the refusal a marker draws is for a marker.
strictEqual(
  nestedLinkError(
    'forged-under-compound-assignment',
    `.examples[0].key += ${forgedReference};`,
  ).code,
  'statement-failed',
);
strictEqual(
  nestedLinkError(
    'marker-under-compound-assignment',
    '.examples[0].key += card(params("who"));',
  ).code,
  'relationship-arithmetic',
);

// A link collection is a set of edges rather than a value, so appending an
// array of markers to one is still refused: `append` adds one edge, and the
// operation that adds several is not spelled this way.
strictEqual(
  nestedLinkError(
    'append-array-of-markers-to-link-collection',
    'append(.linked;[card(params("who"))]);',
  ).code,
  'relationship-value-required',
);

// A link collection nested inside a contained value. Each marker is one edge,
// addressed by its position, and the collection leaves the stored value whole
// rather than a member at a time.
const crewDefinition: BxlBoxelSourceDefinition = {
  type: 'field-def',
  codeRef: ref('Crew'),
  displayName: 'Crew',
  fields: { name: 'f0', members: 'f1' },
  fieldDefs: {
    f0: field('contains', 'String', { primitive: true }),
    f1: field('linksToMany', 'Friend'),
  },
};
const voyageDefinition: BxlBoxelSourceDefinition = {
  type: 'card-def',
  codeRef: ref('Voyage'),
  displayName: 'Voyage',
  fields: { crews: 'f0' },
  fieldDefs: { f0: field('containsMany', 'Crew') },
};
const voyageDefinitions = new Map(
  [crewDefinition, voyageDefinition].map((definition) => [
    JSON.stringify(definition.codeRef),
    definition,
  ]),
);
const voyageSchema = await mutationSchemaForCardSource(voyageDefinition, {
  async lookupDefinition(codeRef) {
    return voyageDefinitions.get(JSON.stringify(codeRef));
  },
});

function voyageMutation(
  programId: string,
  program: string,
  runtimeLimits?: { maxSteps?: number },
) {
  return mutateBxlCardSource(
    {
      data: {
        type: 'card',
        attributes: { crews: [] },
        meta: { adoptsFrom: ref('Voyage') },
      },
    },
    program,
    {
      schema: voyageSchema,
      syntax: 'solidified',
      programId,
      targetId: 'https://example.test/Voyage/one',
      resolveReference: (reference: string) =>
        new URL(reference, 'https://example.test/Voyage/one').href,
      formatReference: (id: string) =>
        id.replace('https://example.test/', '../'),
      context: { params: { who: zoe } },
      resolveCard: (id: string) => nestedLinkCards[id],
      ...(runtimeLimits === undefined ? {} : { runtimeLimits }),
    },
  );
}

const crewed = voyageMutation(
  'append-nested-link-collection',
  `append(.crews;{"name":"alpha","members":[card(params("who")),card(${JSON.stringify(ana)})]});`,
);
deepStrictEqual(crewed.plan.intents, [
  {
    op: 'insert',
    collection: ['crews'],
    index: 0,
    value: { name: 'alpha' },
  },
  { op: 'relate', field: ['crews', 0, 'members'], cardId: zoe, index: 0 },
  { op: 'relate', field: ['crews', 0, 'members'], cardId: ana, index: 1 },
]);
deepStrictEqual(crewed.document.data.attributes?.crews, [{ name: 'alpha' }]);
deepStrictEqual(relationship(crewed.document, 'crews.0.members.0'), {
  links: { self: '../Friend/zoe' },
});
deepStrictEqual(relationship(crewed.document, 'crews.0.members.1'), {
  links: { self: '../Friend/ana' },
});

function voyageError(programId: string, program: string) {
  try {
    voyageMutation(programId, program);
  } catch (error) {
    if (error instanceof BxlMutationError) return error;
    throw error;
  }
  throw new Error(`${programId} was expected to fail`);
}

// The whole collection leaves the stored value, so a member written beside the
// edges would go with it rather than be stored as it reads.
strictEqual(
  voyageError(
    'nested-link-collection-mixed-members',
    'append(.crews;{"name":"alpha","members":[card(params("who")),"ana"]});',
  ).code,
  'relationship-value-required',
);

// A marker standing where the collection itself goes names no edge to change.
strictEqual(
  voyageError(
    'nested-link-collection-replaced',
    'append(.crews;{"name":"alpha","members":card(params("who"))});',
  ).code,
  'collection-replacement-forbidden',
);

// A path only descends through a Field that has Fields of its own. A marker
// under a scalar addresses something the schema does not describe, and reading
// its key against the parent schema instead would answer with the sibling
// beside it — resolving `label.friend` to the `friend` relationship and naming
// a Field the path never reaches.
strictEqual(
  nestedLinkError(
    'nested-marker-below-a-scalar',
    `append(.examples;{${zeta},"parts":[],"label":{"friend":card(params("who"))}});`,
  ).code,
  'field-unknown',
);

// Every runtime limit lives on the frame an evaluation opens — steps,
// milliseconds and output bytes all start again with each one — so what shares
// a frame shares a ceiling. A value expression and the `card(…)` arguments
// standing inside it are one evaluation: raising the marker count must not
// raise what the statement is allowed to spend. Calibrated against a single
// marker rather than a fixed count, so the claim survives a change in how
// steps are counted.
function markerBudgetOutcome(
  markers: number,
  maxSteps: number,
): 'completed' | 'refused' {
  // Only a refusal that names the step limit counts: any other
  // BxlMutationError would let this keep passing while the budget stopped
  // being shared.
  const spentTheBudget = (error: BxlMutationError) =>
    error.message.includes(`${maxSteps} step`);
  const costly =
    'card(([range(0;40)]|map(tostring)|join("-")|length|tostring) | ' +
    `${JSON.stringify(zoe)})`;
  const members = Array.from({ length: markers }, () => costly).join(',');
  try {
    voyageMutation(
      `marker-budget-${markers}-${maxSteps}`,
      `append(.crews;{"name":"alpha","members":[${members}]});`,
      { maxSteps },
    );
    return 'completed';
  } catch (error) {
    if (error instanceof BxlMutationError && spentTheBudget(error)) {
      return 'refused';
    }
    throw error;
  }
}

let oneMarkerBudget = 0;
for (const candidate of [500, 1000, 2000, 4000, 8000, 16000]) {
  if (markerBudgetOutcome(1, candidate) === 'completed') {
    oneMarkerBudget = candidate;
    break;
  }
}
ok(oneMarkerBudget > 0, 'one marker fits inside some step budget');
strictEqual(
  markerBudgetOutcome(8, oneMarkerBudget),
  'refused',
  'markers share the budget of the value they sit in',
);

// A marker resolves through any node that hands the value expression's own
// input straight down and can itself be the value: an `if` branch and a `//`
// operand, whole-value or nested. `try` needs no case of its own — the
// mutation profile refuses it outright.
deepStrictEqual(
  nestedLinkMutation(
    'whole-value-marker-through-a-conditional',
    '.examples[0].friend = (if true then card(params("who")) else null end);',
  ).plan.intents,
  [{ op: 'relate', field: ['examples', 0, 'friend'], cardId: zoe }],
);
deepStrictEqual(
  nestedLinkMutation(
    'whole-value-marker-through-an-alternative',
    '.examples[0].friend = (null // card(params("who")));',
  ).plan.intents,
  [{ op: 'relate', field: ['examples', 0, 'friend'], cardId: zoe }],
);
deepStrictEqual(
  nestedLinkMutation(
    'nested-marker-through-a-conditional',
    `append(.examples;{${zeta},"parts":[],` +
      '"friend":(if true then card(params("who")) else null end)});',
  ).plan.intents,
  [
    {
      op: 'insert',
      collection: ['examples'],
      index: 3,
      value: { key: 'z', label: 'Zeta', aliases: [], parts: [] },
    },
    { op: 'relate', field: ['examples', 3, 'friend'], cardId: zoe },
  ],
);
deepStrictEqual(
  nestedLinkMutation(
    'nested-marker-through-an-alternative',
    `append(.examples;{${zeta},"parts":[],` +
      '"friend":(null // card(params("who")))});',
  ).plan.intents,
  [
    {
      op: 'insert',
      collection: ['examples'],
      index: 3,
      value: { key: 'z', label: 'Zeta', aliases: [], parts: [] },
    },
    { op: 'relate', field: ['examples', 3, 'friend'], cardId: zoe },
  ],
);

// A condition chooses a branch rather than being the value, so a marker there
// is refused the same way one in a re-rooting position is.
strictEqual(
  nestedLinkError(
    'nested-marker-in-a-condition',
    `append(.examples;{${zeta},"parts":[],` +
      '"friend":(if card(params("who")) then null else null end)});',
  ).code,
  'card-marker-position',
);

// A marker reads its argument when the program reaches it, so a branch that is
// not taken costs nothing — no argument evaluated for it, and no error from one
// that only makes sense on the branch that runs. Falling back is the whole
// reason `if` and `//` carry markers, and an argument read ahead of time would
// refuse the fallback on the strength of the branch it exists to avoid.
deepStrictEqual(
  nestedLinkMutation(
    'marker-in-an-untaken-branch',
    '.examples[0].friend = ' +
      '(if false then card(params("missing")) else card(params("who")) end);',
  ).plan.intents,
  [{ op: 'relate', field: ['examples', 0, 'friend'], cardId: zoe }],
);
deepStrictEqual(
  nestedLinkMutation(
    'marker-in-a-short-circuited-operand',
    '.examples[0].friend = (card(params("who")) // card(params("missing")));',
  ).plan.intents,
  [{ op: 'relate', field: ['examples', 0, 'friend'], cardId: zoe }],
);

// An argument the program does reach still answers for itself.
strictEqual(
  nestedLinkError(
    'nested-marker-argument-not-a-string',
    `append(.examples;{${zeta},"parts":[],"friend":card(123)});`,
  ).code,
  'card-id-invalid',
);

// `.` merged with an object literal is how a program writes part of a
// contained value, so a marker rides through the merge.
deepStrictEqual(
  nestedLinkMutation(
    'nested-marker-through-a-merge',
    '.examples[1] |= (. + {"friend":card(params("who"))});',
  ).plan.intents,
  [
    {
      op: 'set',
      path: ['examples', 1],
      before: {
        key: 'b',
        label: 'Beta',
        friend: { id: 'https://example.test/Friend/b' },
        aliases: [],
        parts: [],
      },
      after: { key: 'b', label: 'Beta', aliases: [], parts: [] },
    },
    { op: 'relate', field: ['examples', 1, 'friend'], cardId: zoe },
  ],
);

// `*` merges recursively, so a marker at a key both operands hold would be
// merged into rather than replacing it, and the merge would drop its brand —
// losing the relationship while the rest of the write landed. The position is
// refused instead, whether or not the left operand happens to hold that key,
// so the same program cannot turn silent on a different document.
for (const [programId, program] of [
  [
    'marker-through-a-recursive-merge',
    '.examples[1] |= (. * {"label":"Beta II","friend":card(params("who"))});',
  ],
  [
    'marker-through-a-recursive-merge-of-a-fresh-object',
    '.examples[1] |= ({"key":.key} * {"friend":card(params("who"))});',
  ],
] as const) {
  strictEqual(
    nestedLinkError(programId, program).code,
    'card-marker-position',
    `${programId} refuses a marker in a recursive merge`,
  );
}

// `+` spreads its operands instead of descending into them, so it is the merge
// a marker rides through, and the edge lands where the marker stood.
deepStrictEqual(
  nestedLinkMutation(
    'marker-through-a-spreading-merge',
    '.examples[1] |= (. + {"label":"Beta II","friend":card(params("who"))});',
  ).plan.intents,
  [
    {
      op: 'set',
      path: ['examples', 1],
      before: {
        key: 'b',
        label: 'Beta',
        friend: { id: 'https://example.test/Friend/b' },
        aliases: [],
        parts: [],
      },
      after: { key: 'b', label: 'Beta II', aliases: [], parts: [] },
    },
    { op: 'relate', field: ['examples', 1, 'friend'], cardId: zoe },
  ],
);

// An `elif` branch is a branch like any other, and either operand of `//` can
// be the one that answers.
deepStrictEqual(
  nestedLinkMutation(
    'marker-in-an-elif-branch',
    '.examples[0].friend = (if false then null elif true then ' +
      'card(params("who")) else null end);',
  ).plan.intents,
  [{ op: 'relate', field: ['examples', 0, 'friend'], cardId: zoe }],
);

// An argument read as a plain value has no Field to relate a Card to, so a
// marker in one is reported rather than quietly leaving its slot empty. The
// message of an assertion that holds is never built at all, so there is
// nothing there to report.
for (const [programId, program] of [
  ['marker-in-an-assert-message', 'assert(false;{"a":card(params("who"))});'],
  [
    'marker-in-a-reorder-order',
    'reorder_by(.examples; .key; {"a":card(params("who"))});',
  ],
] as const) {
  strictEqual(
    nestedLinkError(programId, program).code,
    'card-marker-position',
    programId,
  );
}
doesNotThrow(() =>
  nestedLinkMutation(
    'marker-in-the-message-of-an-assertion-that-holds',
    'assert(true;{"a":card(params("who"))});',
  ),
);

// The other statements that write a contained value resolve markers the same
// way `append` does, each against the place its own value lands.
deepStrictEqual(
  nestedLinkMutation(
    'replace-a-contained-value-carrying-a-link',
    `replace(.examples[1];{"key":"b2","label":"B2","aliases":[],"parts":[],` +
      '"friend":card(params("who"))});',
  ).plan.intents.filter((intent) => intent.op === 'relate'),
  [{ op: 'relate', field: ['examples', 1, 'friend'], cardId: zoe }],
);
deepStrictEqual(
  nestedLinkMutation(
    'prepend-a-contained-value-carrying-a-link',
    `prepend(.examples;{${zeta},"parts":[],"friend":card(params("who"))});`,
  ).plan.intents.filter((intent) => intent.op === 'relate'),
  [{ op: 'relate', field: ['examples', 0, 'friend'], cardId: zoe }],
);
deepStrictEqual(
  nestedLinkMutation(
    'insert-a-contained-value-carrying-a-link-before-another',
    `insert_item_before({${zeta},"parts":[],"friend":card(params("who"))};` +
      '.examples[2]);',
  ).plan.intents.filter((intent) => intent.op === 'relate'),
  [{ op: 'relate', field: ['examples', 2, 'friend'], cardId: zoe }],
);

// A prepared program is planned many times, so resolution must not consume the
// parsed tree or hold a Card from an earlier run.
const preparedWithMarker = prepareBxlMutation(
  `append(.examples;{${zeta},"parts":[],"friend":card(params("who"))});`,
  { schema: richSchema, syntax: 'solidified', targetKind: 'card' },
);
const preparedSnapshot = snapshotBxlCardSource(
  richSourceFixture(),
  richSchema,
  richProjectionOptions,
);
const planWith = (who: string) =>
  preparedWithMarker.plan(preparedSnapshot, {
    programId: 'prepared-twice',
    ...richProjectionOptions,
    context: { params: { who } },
    resolveCard: (id: string) => nestedLinkCards[id],
  }).intents;
deepStrictEqual(planWith(zoe), planWith(zoe));
deepStrictEqual(
  planWith(ana).filter((intent) => intent.op === 'relate'),
  [{ op: 'relate', field: ['examples', 3, 'friend'], cardId: ana }],
);

// A relationship is an edge whatever the value says. The schema decides which
// Fields are links, so a link-shaped object written as ordinary data lands on
// the same rule `card(…)` does rather than being stored as an attribute: the
// planner reaches every relationship Field inside a written value through the
// schema, not through the markers the value happens to carry.

// A `linksTo` written as plain data names a Card the way `card(…)` does and
// means the same thing, but a stored attribute is not an edge: nothing
// downstream follows it, reindexes it, or notices when it goes stale.
strictEqual(
  nestedLinkError(
    'nested-link-written-as-data',
    `append(.examples;{${zeta},"parts":[],"friend":{"id":${JSON.stringify(zoe)}}});`,
  ).code,
  'relationship-value-required',
);

// The same for a `linksToMany`, whose members need not even look like Cards to
// end up sitting at a link collection's slot.
strictEqual(
  voyageError(
    'nested-link-collection-written-as-data',
    'append(.crews;{"name":"alpha","members":["ana"]});',
  ).code,
  'relationship-value-required',
);

// The snapshot projection presents a link as `{"id": …}`, so the most natural
// partial update there is — read a subtree, write back the parts that stay —
// carries every link it read along with it. Those are the links the Card
// already holds, so the update keeps its edges: the ones it wrote back
// unchanged, and the ones it never mentioned.
const roundTripped = nestedLinkMutation(
  'update-round-trips-its-links',
  '.examples[0] |= {"key":.key,"parts":.parts};',
);
deepStrictEqual(roundTripped.plan.intents, [
  {
    op: 'set',
    path: ['examples', 0],
    before: {
      key: 'a',
      label: 'Alpha',
      friend: { id: 'https://example.test/Friend/a' },
      aliases: ['A-one', 'A-two'],
      parts: [
        { key: 'p1', owner: { id: 'https://example.test/Friend/part-1' } },
        { key: 'p2', owner: { id: 'https://example.test/Friend/part-2' } },
      ],
    },
    after: { key: 'a', parts: [{ key: 'p1' }, { key: 'p2' }] },
    keepRelationships: [
      ['friend'],
      ['parts', 0, 'owner'],
      ['parts', 1, 'owner'],
    ],
  },
]);
// The link the value carried back is shed rather than stored, so nothing is
// left behind holding a frozen copy of what the link pointed at.
deepStrictEqual(
  (roundTripped.document.data.attributes?.examples as unknown[])[0],
  { key: 'a', parts: [{ key: 'p1' }, { key: 'p2' }] },
);
// An edge left alone keeps everything the Card was holding on it, which is
// more than a `relate` intent could put back: it carries only a Card id.
deepStrictEqual(relationship(roundTripped.document, 'examples.0.friend'), {
  links: { self: '../Friend/a', related: 'keep-a' },
  meta: { slot: 'a' },
});
deepStrictEqual(
  relationship(roundTripped.document, 'examples.0.parts.0.owner'),
  {
    links: { self: '../Friend/part-1' },
    meta: { part: 'p1' },
  },
);
deepStrictEqual(
  relationship(roundTripped.document, 'examples.1.friend'),
  relationship(richSourceFixture(), 'examples.1.friend'),
);

// A kept edge is still an edge, so the planner reads it back the way it reads
// one the document already held: `plan.output` agrees with the committed Card,
// and a later statement in the same program can follow the link. Leaving the
// slot standing empty would read as a link the write removed.
const keptLinkStaysReadable = nestedLinkMutation(
  'a-kept-link-is-readable-by-a-later-statement',
  '.examples[0] |= {"key":.key,"parts":.parts};\n.codes = [.examples[0].friend.id];',
);
deepStrictEqual(
  (
    (keptLinkStaysReadable.plan.output as Record<string, unknown>)
      .examples as Array<Record<string, unknown>>
  )[0]!.friend,
  { id: 'https://example.test/Friend/a' },
);
deepStrictEqual(keptLinkStaysReadable.document.data.attributes?.codes, [
  'https://example.test/Friend/a',
]);
// It is read as a link, not stored as one: the value the Card keeps still
// holds no `friend` member.
strictEqual(
  (
    keptLinkStaysReadable.document.data.attributes?.examples as Array<
      Record<string, unknown>
    >
  )[0]!.friend,
  undefined,
);

// Carrying a link back *changed* is a different thing entirely, and the one
// case shedding must not swallow: the author asked for an edge to move, and
// silently doing nothing would be its own quiet surprise.
strictEqual(
  nestedLinkError(
    'update-rewrites-a-link-as-data',
    `.examples[0] |= (. + {"friend":{"id":${JSON.stringify(zoe)}}});`,
  ).code,
  'relationship-value-required',
);

// An update reaches an edge the way everything else reaches one: through a
// marker, which plans the `relate` and sheds the link from the stored value.
const updatedThroughMarker = nestedLinkMutation(
  'update-moves-a-link-through-a-marker',
  '.examples[0] |= (. + {"friend":card(params("who"))});',
);
deepStrictEqual(
  updatedThroughMarker.plan.intents.filter((intent) => intent.op === 'relate'),
  [{ op: 'relate', field: ['examples', 0, 'friend'], cardId: zoe }],
);
deepStrictEqual(
  relationship(updatedThroughMarker.document, 'examples.0.friend'),
  { links: { self: '../Friend/zoe' } },
);
deepStrictEqual(
  relationship(updatedThroughMarker.document, 'examples.0.parts.0.owner'),
  { links: { self: '../Friend/part-1' }, meta: { part: 'p1' } },
);

// A slot the value empties names no Card, so it clears the edge rather than
// being refused for holding something that is not a marker.
const clearedLink = nestedLinkMutation(
  'update-empties-a-link',
  '.examples[0] |= (. + {"friend":null});',
);
deepStrictEqual(
  (clearedLink.plan.intents[0] as { keepRelationships?: unknown })
    .keepRelationships,
  [
    ['parts', 0, 'owner'],
    ['parts', 1, 'owner'],
  ],
);
strictEqual(
  clearedLink.document.data.relationships?.['examples.0.friend'],
  undefined,
);
strictEqual(
  (
    clearedLink.document.data.attributes?.examples as Array<
      Record<string, unknown>
    >
  )[0]!.friend,
  undefined,
);

// An edge survives only as long as the value that holds it. Dropping `parts`
// takes the owners with it, because there is no longer a part for them to be
// the owner of.
const droppedContainer = nestedLinkMutation(
  'update-drops-the-value-holding-a-link',
  '.examples[0] |= {"key":.key};',
);
deepStrictEqual(
  (droppedContainer.plan.intents[0] as { keepRelationships?: unknown })
    .keepRelationships,
  [['friend']],
);
strictEqual(
  relationship(droppedContainer.document, 'examples.0.friend').links?.self,
  '../Friend/a',
);
strictEqual(
  droppedContainer.document.data.relationships?.['examples.0.parts.0.owner'],
  undefined,
);

// `=` replaces where `|=` updates, and that is the whole difference for the
// links inside: a replacement's silence drops an edge the way it drops
// everything else the new value no longer holds.
const replacedWholesale = nestedLinkMutation(
  'assignment-drops-an-unmentioned-link',
  '.examples[0] = {"key":"a","parts":[]};',
);
deepStrictEqual(
  (replacedWholesale.plan.intents[0] as { keepRelationships?: unknown })
    .keepRelationships,
  undefined,
);
strictEqual(
  replacedWholesale.document.data.relationships?.['examples.0.friend'],
  undefined,
);

// A replacement that carries the link back is still saying it does not change,
// so the edge stands.
const replacedInPlace = nestedLinkMutation(
  'replace-round-trips-its-link',
  'replace(.examples[0];{"key":"a","friend":.examples[0].friend,"parts":[]});',
);
deepStrictEqual(
  (replacedInPlace.plan.intents[0] as { keepRelationships?: unknown })
    .keepRelationships,
  [['friend']],
);
deepStrictEqual(relationship(replacedInPlace.document, 'examples.0.friend'), {
  links: { self: '../Friend/a', related: 'keep-a' },
  meta: { slot: 'a' },
});

// An insertion has no link to carry back. Its value lands where the Card held
// nothing of its own — the item at that index is the one being pushed aside —
// so reading that item's link into the new value writes data at a link slot
// and nothing more.
strictEqual(
  nestedLinkError(
    'insertion-cannot-round-trip-the-item-it-displaces',
    `insert_item_before({${zeta},"friend":.examples[0].friend,"parts":[]};.examples[0]);`,
  ).code,
  'relationship-value-required',
);

// A write that rebuilds a collection reassigns every index in it, and an edge
// has nothing but its index to hold onto: a contained value carries no
// identity, and the projection shows every link as `{"id": …}`, so two edges
// to the same Card read alike. Such a write is refused wherever an edge would
// have to be matched back to a value.
strictEqual(
  nestedLinkError(
    'collection-rebuild-cannot-place-its-edges',
    '.examples |= map(. + {"label":"renamed"});',
  ).code,
  'relationship-collection-rebuilt',
);

// Addressing the items instead pins each write to one index, so nothing can
// shift underneath it and every edge stays with its value.
const bulkUpdated = nestedLinkMutation(
  'per-item-update-keeps-every-edge',
  '.examples[* .key != ""] |= (. + {"label":"renamed"});',
);
deepStrictEqual(
  bulkUpdated.plan.intents.map((intent) =>
    intent.op === 'set'
      ? [
          intent.path,
          (intent as { keepRelationships?: unknown }).keepRelationships,
        ]
      : intent.op,
  ),
  [
    [
      ['examples', 0],
      [['friend'], ['parts', 0, 'owner'], ['parts', 1, 'owner']],
    ],
    [['examples', 1], [['friend']]],
    [['examples', 2], [['friend']]],
  ],
);
deepStrictEqual(relationship(bulkUpdated.document, 'examples.2.friend'), {
  links: { self: '../Friend/c', related: 'keep-c' },
  meta: { slot: 'c' },
});
deepStrictEqual(
  relationship(bulkUpdated.document, 'examples.0.parts.1.owner'),
  {
    links: { self: '../Friend/part-2' },
    meta: { part: 'p2' },
  },
);

// A rebuild that copies its items through untouched leaves each one where it
// was, so those edges are still the edges of the values holding them; the
// item the rebuild drops takes its edge with it.
const bulkFiltered = nestedLinkMutation(
  'collection-rebuild-that-moves-nothing',
  '.examples |= map(select(.key != "c"));',
);
strictEqual(
  relationship(bulkFiltered.document, 'examples.1.friend').links?.self,
  '../Friend/b',
);
strictEqual(
  bulkFiltered.document.data.relationships?.['examples.2.friend'],
  undefined,
);

// The refusal is not the id comparison in disguise. Where every edge points at
// the same Card, the projection presents them identically and only their
// sidecars differ, so a shift reads as every slot round-tripping unchanged —
// and keeping them by index would hand each value the neighbour's sidecars.
function collidingSourceFixture(): BxlCardSourceDocument {
  return {
    data: {
      type: 'card',
      attributes: {
        examples: [
          { key: 'a', aliases: [], parts: [] },
          { key: 'b', aliases: [], parts: [] },
        ],
        codes: [],
      },
      relationships: {
        'examples.0.friend': {
          links: { self: '../Friend/zoe', related: 'belongs-to-a' },
          meta: { slot: 'a' },
        },
        'examples.1.friend': {
          links: { self: '../Friend/zoe', related: 'belongs-to-b' },
          meta: { slot: 'b' },
        },
      },
      meta: { adoptsFrom: ref('SpecLike') },
    },
  };
}
function collidingError(programId: string, program: string) {
  try {
    mutateBxlCardSource(collidingSourceFixture(), program, {
      schema: richSchema,
      syntax: 'solidified',
      programId,
      ...richProjectionOptions,
      serializeContainedValue: () => ({
        meta: { adoptsFrom: { module: '../fields', name: 'ZetaExample' } },
      }),
    });
  } catch (error) {
    if (error instanceof BxlMutationError) return error;
    throw error;
  }
  throw new Error(`${programId} was expected to fail`);
}
strictEqual(
  collidingError(
    'colliding-edges-cannot-be-placed-by-index',
    '.examples |= map(select(.key != "a"));',
  ).code,
  'relationship-collection-rebuilt',
);

// The author who drops an item ahead of the others moved values, and wrote no
// data at all, so both fixtures answer the same way: whether the shifted links
// happen to read alike decides nothing.
strictEqual(
  nestedLinkError(
    'collection-update-cannot-shift-its-links',
    '.examples |= map(select(.key != "a"));',
  ).code,
  'relationship-collection-rebuilt',
);

// An edge two levels down inside an item that moved sits in a subtree that may
// well be identical to the one that used to be there, so the item itself has
// to be the thing compared. Here every `lead` is alike and only the item's own
// `key` tells them apart.
const deepPart: BxlBoxelSourceDefinition = {
  type: 'field-def',
  codeRef: ref('DeepPart'),
  displayName: 'Deep Part',
  fields: { key: 'f0', owner: 'f1' },
  fieldDefs: {
    f0: field('contains', 'String', { primitive: true }),
    f1: field('linksTo', 'Friend'),
  },
};
const deepExample: BxlBoxelSourceDefinition = {
  type: 'field-def',
  codeRef: ref('DeepExample'),
  displayName: 'Deep Example',
  fields: { key: 'f0', lead: 'f1' },
  fieldDefs: {
    f0: field('contains', 'String', { primitive: true }),
    f1: field('contains', 'DeepPart'),
  },
};
const deepSpec: BxlBoxelSourceDefinition = {
  type: 'card-def',
  codeRef: ref('DeepSpec'),
  displayName: 'Deep Spec',
  fields: { examples: 'f0' },
  fieldDefs: { f0: field('containsMany', 'DeepExample') },
};
const deepDefinitions = new Map(
  [deepPart, deepExample, deepSpec].map((definition) => [
    JSON.stringify(definition.codeRef),
    definition,
  ]),
);
const deepSchema = await mutationSchemaForCardSource(deepSpec, {
  async lookupDefinition(codeRef) {
    return deepDefinitions.get(JSON.stringify(codeRef));
  },
});
function deepError(programId: string, program: string) {
  try {
    mutateBxlCardSource(
      {
        data: {
          type: 'card',
          attributes: {
            examples: [
              { key: 'FIRST', lead: { key: 'L' } },
              { key: 'SECOND', lead: { key: 'L' } },
            ],
          },
          relationships: {
            'examples.0.lead.owner': {
              links: { self: '../Friend/zoe', related: 'sidecar-of-first' },
            },
            'examples.1.lead.owner': {
              links: { self: '../Friend/zoe', related: 'sidecar-of-second' },
            },
          },
          meta: { adoptsFrom: ref('DeepSpec') },
        },
      },
      program,
      {
        schema: deepSchema,
        syntax: 'solidified',
        programId,
        targetId: 'https://example.test/DeepSpec/one',
        resolveReference: (reference: string) =>
          new URL(reference, 'https://example.test/DeepSpec/one').href,
        formatReference: (id: string) =>
          id.replace('https://example.test/', '../'),
        serializeContainedValue: () => ({
          meta: { adoptsFrom: { module: '../fields', name: 'ZetaExample' } },
        }),
      },
    );
  } catch (error) {
    if (error instanceof BxlMutationError) return error;
    throw error;
  }
  throw new Error(`${programId} was expected to fail`);
}
strictEqual(
  deepError('edge-below-a-moved-item', '.examples |= .[1:];').code,
  'relationship-collection-rebuilt',
);

// A relationship inside a collection item, where an index stands between the
// write's own path and the slot. The item is what has to be compared, and its
// links are not part of that comparison — they are not members of the value,
// so a value that carried one back and one that never mentioned it are the
// same item.
const holderDefinition: BxlBoxelSourceDefinition = {
  type: 'field-def',
  codeRef: ref('Holder'),
  displayName: 'Holder',
  fields: { key: 'f0', owner: 'f1', crew: 'f2' },
  fieldDefs: {
    f0: field('contains', 'String', { primitive: true }),
    f1: field('linksTo', 'Friend'),
    f2: field('linksToMany', 'Friend'),
  },
};
const holdingDefinition: BxlBoxelSourceDefinition = {
  type: 'card-def',
  codeRef: ref('Holding'),
  displayName: 'Holding',
  fields: { parts: 'f0' },
  fieldDefs: { f0: field('containsMany', 'Holder') },
};
const holdingDefinitions = new Map(
  [holderDefinition, holdingDefinition].map((definition) => [
    JSON.stringify(definition.codeRef),
    definition,
  ]),
);
const holdingSchema = await mutationSchemaForCardSource(holdingDefinition, {
  async lookupDefinition(codeRef) {
    return holdingDefinitions.get(JSON.stringify(codeRef));
  },
});
function holdingMutation(programId: string, program: string) {
  return mutateBxlCardSource(
    {
      data: {
        type: 'card',
        attributes: { parts: [{ key: 'p1' }, { key: 'p2' }] },
        relationships: {
          'parts.0.owner': {
            links: { self: '../Friend/zoe', related: 'own-1' },
          },
          'parts.0.crew.0': {
            links: { self: '../Friend/ana', related: 'crew-a' },
          },
          'parts.0.crew.1': {
            links: { self: '../Friend/bo', related: 'crew-b' },
          },
          'parts.1.owner': {
            links: { self: '../Friend/cy', related: 'own-2' },
          },
        },
        meta: { adoptsFrom: ref('Holding') },
      },
    },
    program,
    {
      schema: holdingSchema,
      syntax: 'solidified',
      programId,
      targetId: 'https://example.test/Holding/one',
      resolveReference: (reference: string) =>
        new URL(reference, 'https://example.test/Holding/one').href,
      formatReference: (id: string) =>
        id.replace('https://example.test/', '../'),
      serializeContainedValue: () => ({
        meta: { adoptsFrom: { module: '../fields', name: 'ZetaHolder' } },
      }),
    },
  );
}

// The item is unchanged once its links are set aside, so both edges stand —
// the singular one and every member of the collection, each with its sidecar.
const heldOver = holdingMutation(
  'links-under-an-index-are-keepable',
  '.parts[0] |= {"key":.key};',
);
deepStrictEqual(
  (heldOver.plan.intents[0] as { keepRelationships?: unknown })
    .keepRelationships,
  [['owner'], ['crew']],
);
deepStrictEqual(relationship(heldOver.document, 'parts.0.owner'), {
  links: { self: '../Friend/zoe', related: 'own-1' },
});
deepStrictEqual(relationship(heldOver.document, 'parts.0.crew.0'), {
  links: { self: '../Friend/ana', related: 'crew-a' },
});
deepStrictEqual(relationship(heldOver.document, 'parts.0.crew.1'), {
  links: { self: '../Friend/bo', related: 'crew-b' },
});
// A kept collection is kept whole: its edges are stored one key per index, so
// naming the Field has to reach the keys beneath it.
strictEqual(
  Object.keys(heldOver.document.data.relationships ?? {}).filter((key) =>
    key.startsWith('parts.0.crew'),
  ).length,
  2,
);

// Emptying the collection names no Card, so it clears rather than being
// refused, and leaves the singular edge beside it alone.
const crewCleared = holdingMutation(
  'emptying-a-nested-link-collection-clears-it',
  '.parts[0] |= (. + {"crew":[]});',
);
deepStrictEqual(
  (crewCleared.plan.intents[0] as { keepRelationships?: unknown })
    .keepRelationships,
  [['owner']],
);
strictEqual(
  Object.keys(crewCleared.document.data.relationships ?? {}).filter((key) =>
    key.startsWith('parts.0.crew'),
  ).length,
  0,
);
deepStrictEqual(relationship(crewCleared.document, 'parts.0.owner'), {
  links: { self: '../Friend/zoe', related: 'own-1' },
});

// A value written from nothing spells an empty link `null`, whichever kind of
// Field it sits at — it names no Card either way — so a collection reads that
// the same as the `[]` its projection shows.
const crewNulled = holdingMutation(
  'a-null-empties-a-link-collection-too',
  '.parts[0] |= (. + {"crew":null});',
);
deepStrictEqual(
  (crewNulled.plan.intents[0] as { keepRelationships?: unknown })
    .keepRelationships,
  [['owner']],
);
strictEqual(
  Object.keys(crewNulled.document.data.relationships ?? {}).filter((key) =>
    key.startsWith('parts.0.crew'),
  ).length,
  0,
);
strictEqual(
  (
    crewNulled.document.data.attributes?.parts as Array<Record<string, unknown>>
  )[0]!.crew,
  undefined,
);

// A compound assignment merges the current value into its result, links and
// all, so the same reading applies to what the merge produced.
const merged = nestedLinkMutation(
  'compound-merge-keeps-its-links',
  '.examples[0] += {"label":"merged"};',
);
deepStrictEqual(
  (merged.plan.intents[0] as { keepRelationships?: unknown }).keepRelationships,
  [['friend'], ['parts', 0, 'owner'], ['parts', 1, 'owner']],
);
deepStrictEqual(relationship(merged.document, 'examples.0.friend'), {
  links: { self: '../Friend/a', related: 'keep-a' },
  meta: { slot: 'a' },
});
strictEqual(
  (
    merged.document.data.attributes?.examples as Array<Record<string, unknown>>
  )[0]!.friend,
  undefined,
);

// A value with no link-typed Field anywhere in it is untouched by any of this:
// the walk finds no slot, and the plan says exactly what it said before.
deepStrictEqual(
  nestedLinkMutation('value-with-no-link-field', 'append(.codes;"four");').plan
    .intents,
  [{ op: 'insert', collection: ['codes'], index: 3, value: 'four' }],
);

console.log(
  'BXL Boxel card-source adapter: Definition schema, computed skips, recursive metadata, structural collections, RRI/relative relationship matrix, preservation, request-context builtins, stale-plan safety, and read-only computed/linked overlays passed',
);
