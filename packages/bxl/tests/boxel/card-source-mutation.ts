import {
  deepStrictEqual,
  ok,
  strictEqual,
  throws,
} from 'node:assert';
import {
  BxlMutationError,
  applyBxlMutationPlanToCardSource,
  mutateBxlCardSource,
  mutationSchemaForCardSource,
  prepareBxlMutation,
  snapshotBxlCardSource,
  type BxlBoxelSourceDefinition,
  type BxlCardSourceDocument,
} from '../../src/mutation/index.js';

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
  [cardInfoDefinition, themeDefinition, tierItemDefinition].map((definition) => [
    JSON.stringify(definition.codeRef),
    definition,
  ]),
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
  schema.fields.some((entry) => entry.key === 'computedLabel'),
  false,
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

deepStrictEqual(snapshotBxlCardSource(sourceFixture(), schema, projectionOptions), {
  id: 'https://example.test/TierItem/typescript',
  cardInfo: {
    name: 'TypeScript',
    theme: { id: 'https://example.test/Theme/original' },
  },
  image: 'https://example.test/typescript.svg',
  tags: ['language', 'web'],
  recommendations: [],
});

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
throws(
  () =>
    mutateBxlCardSource(structuralSource, 'append(.tags; "native");', {
      schema,
      syntax: 'solidified',
      programId: 'reject-source-structure',
      ...projectionOptions,
    }),
  (error) =>
    error instanceof BxlMutationError &&
    error.code === 'card-source-structural-write-unsupported',
);
deepStrictEqual(structuralSource, sourceFixture());

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
console.log(
  'BXL Boxel card-source adapter: Definition schema, immutable scalar/link writes, preservation, and safety boundaries passed',
);
