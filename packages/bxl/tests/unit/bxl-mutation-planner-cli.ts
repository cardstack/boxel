import { deepStrictEqual, strictEqual, throws } from 'node:assert';
import {
  bxlMutationExamples,
  mutationSchemaFixtures,
  type AcceptedMutationFixture,
  type BxlMutationExample,
  type MutationJson,
} from '../../examples/bxl-mutation-examples.js';
import {
  BxlMutationError,
  createBxlMutationStatementStream,
  prepareBxlMutation,
  prepareBxlMutationOperations,
  type BxlMutationField,
  type BxlMutationFieldType,
  type BxlMutationJson,
  type BxlMutationSchema,
  type BxlStructuredMutationOperation,
} from '../../src/index.js';

function titleCase(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, (value) => value.toUpperCase());
}

function fieldFromFixture(key: string, fixture: any): BxlMutationField {
  const fieldType = ['contains', 'containsMany', 'linksTo', 'linksToMany'].includes(fixture.kind)
    ? fixture.kind as BxlMutationFieldType
    : undefined;
  const itemFields = fixture.itemFields
    ? Object.entries(fixture.itemFields).map(([itemKey, value]) => fieldFromFixture(itemKey, value))
    : fieldType === 'linksTo' || fieldType === 'linksToMany'
      ? [{ key: 'id', label: 'ID' }]
      : undefined;
  return {
    key,
    label: fixture.label ?? titleCase(key),
    kind:
      fieldType === 'containsMany' || fieldType === 'linksToMany'
        ? 'array'
        : fieldType === 'contains' || fieldType === 'linksTo'
          ? 'object'
          : 'scalar',
    fieldType,
    writable: fixture.writable,
    ...(itemFields ? { item: { fields: itemFields } } : {}),
  };
}

function plannerSchema(example: BxlMutationExample): {
  schema: BxlMutationSchema;
  targetKind: 'card' | 'field';
} {
  const fixture = mutationSchemaFixtures[example.schema] as any;
  if (fixture.root === 'card') {
    return {
      targetKind: 'card',
      schema: {
        fields: Object.entries(fixture.fields).map(([key, value]) => fieldFromFixture(key, value)),
      },
    };
  }
  const root = fixture.field;
  const itemFields = root.itemFields
    ? Object.entries(root.itemFields).map(([key, value]) => fieldFromFixture(key, value))
    : root.kind === 'linksTo' || root.kind === 'linksToMany'
      ? [{ key: 'id', label: 'ID' }]
      : [];
  return {
    targetKind: 'field',
    schema: {
      fields: itemFields,
      rootField: {
        label: root.label,
        fieldType: ['contains', 'containsMany', 'linksTo', 'linksToMany'].includes(root.kind)
          ? root.kind
          : undefined,
        writable: root.writable,
        ...(itemFields.length > 0 ? { item: { fields: itemFields } } : {}),
      },
    },
  };
}

function normalizeNumbers(value: unknown): unknown {
  if (typeof value === 'number') return Number(value.toPrecision(14));
  if (Array.isArray(value)) return value.map(normalizeNumbers);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, normalizeNumbers(entry)]),
    );
  }
  return value;
}

function planFixture(fixture: AcceptedMutationFixture) {
  const shape = plannerSchema(fixture);
  const prepared = prepareBxlMutation(fixture.readableSource, {
    ...shape,
    syntax: 'readable',
  });
  return prepared.plan(fixture.before as BxlMutationJson, {
    programId: fixture.execution.programId,
    targetId: fixture.execution.target.id,
    targetPath: fixture.execution.target.path,
    delivery: fixture.execution.delivery,
    transaction: fixture.execution.transaction,
    baseRevision: fixture.execution.baseRevision,
    currentRevision: fixture.execution.baseRevision,
    returning: fixture.execution.returning,
    cards: fixture.store as Record<string, BxlMutationJson> | undefined,
  });
}

const accepted = bxlMutationExamples.filter(
  (fixture): fixture is AcceptedMutationFixture => fixture.outcome === 'accepted',
);

for (const fixture of accepted) {
  const plan = planFixture(fixture);
  deepStrictEqual(
    normalizeNumbers(plan.output),
    normalizeNumbers(fixture.after),
    `${fixture.id}: planner output`,
  );
  deepStrictEqual(
    normalizeNumbers(plan.statements.map(({ canonical: _canonical, source: _source, statement: _statement, paths: _paths, ...value }) => value)),
    normalizeNumbers(fixture.plan.map(({ canonical: _canonical, ...value }) => value)),
    `${fixture.id}: statement intents and affected count`,
  );
  strictEqual(plan.programId, fixture.execution.programId, `${fixture.id}: program identity`);

  const shape = plannerSchema(fixture);
  const operationsPlan = prepareBxlMutationOperations(
    fixture.operations as BxlStructuredMutationOperation[],
    shape,
  ).plan(fixture.before as BxlMutationJson, {
    programId: fixture.execution.programId,
    targetId: fixture.execution.target.id,
    delivery: fixture.execution.delivery,
    transaction: fixture.execution.transaction,
    baseRevision: fixture.execution.baseRevision,
    currentRevision: fixture.execution.baseRevision,
    cards: fixture.store as Record<string, BxlMutationJson> | undefined,
  });
  deepStrictEqual(
    normalizeNumbers(operationsPlan.output),
    normalizeNumbers(fixture.after),
    `${fixture.id}: structured operation output`,
  );
  deepStrictEqual(
    normalizeNumbers(operationsPlan.intents),
    normalizeNumbers(fixture.plan.flatMap((statement) => statement.intents)),
    `${fixture.id}: structured operation intents`,
  );
}

const rejectedPlannerCases = bxlMutationExamples.filter(
  (fixture) =>
    fixture.outcome === 'rejected' &&
    !['revision-conflict', 'authorization-denied', 'duplicate-operation-id'].includes(fixture.error.code),
);

for (const fixture of rejectedPlannerCases) {
  const shape = plannerSchema(fixture);
  throws(
    () => prepareBxlMutation(fixture.source, {
      ...shape,
      syntax: 'solidified',
    }).plan(fixture.before as BxlMutationJson, {
      programId: fixture.execution.programId,
      delivery: fixture.execution.delivery,
      transaction: fixture.execution.transaction,
      baseRevision: fixture.execution.baseRevision,
      currentRevision: fixture.execution.baseRevision,
      cards: fixture.store as Record<string, BxlMutationJson> | undefined,
    }),
    (error: unknown) =>
      error instanceof BxlMutationError && error.code === fixture.error.code,
    `${fixture.id}: rejects with ${fixture.error.code}`,
  );
}

const revisionFixture = bxlMutationExamples.find(
  (fixture) => fixture.id === 'reject-revision-conflict',
)!;
const revisionShape = plannerSchema(revisionFixture);
throws(
  () => prepareBxlMutation(revisionFixture.source, {
    ...revisionShape,
    syntax: 'solidified',
  }).plan(revisionFixture.before as BxlMutationJson, {
    programId: revisionFixture.execution.programId,
    baseRevision: revisionFixture.execution.baseRevision,
    currentRevision: 'rev-current',
  }),
  (error: unknown) => error instanceof BxlMutationError && error.code === 'revision-conflict',
  'revision mismatch rejects before planning',
);

const authorizationFixture = bxlMutationExamples.find(
  (fixture) => fixture.id === 'reject-authorization-write',
)!;
const authorizationShape = plannerSchema(authorizationFixture);
throws(
  () => prepareBxlMutation(authorizationFixture.source, {
    ...authorizationShape,
    syntax: 'solidified',
  }).plan(authorizationFixture.before as BxlMutationJson, {
    programId: authorizationFixture.execution.programId,
    authorize(statement) {
      return statement.statement !== 2;
    },
  }),
  (error: unknown) => error instanceof BxlMutationError && error.code === 'authorization-denied',
  'authorization sees and rejects the concrete second-statement write set',
);

const duplicateFixture = bxlMutationExamples.find(
  (fixture) => fixture.id === 'reject-duplicate-operation-id',
)!;
const duplicateShape = plannerSchema(duplicateFixture);
throws(
  () => prepareBxlMutationOperations(
    duplicateFixture.operations as BxlStructuredMutationOperation[],
    duplicateShape,
  ),
  (error: unknown) => error instanceof BxlMutationError && error.code === 'duplicate-operation-id',
  'structured operation IDs are unique within a program',
);

// Planning is pure: a rejected atomic program never mutates the supplied snapshot.
const atomicInput: MutationJson = { title: 'Draft', status: 'draft' };
const atomicBefore = structuredClone(atomicInput);
throws(() => prepareBxlMutation('Title = "Final"; Status = "published";', {
  schema: {
    fields: [
      { key: 'title', label: 'Title' },
      { key: 'status', label: 'Status' },
    ],
  },
  targetKind: 'card',
}).plan(atomicInput, {
  programId: 'atomic:purity',
  authorize(statement) {
    return statement.statement === 1;
  },
}));
deepStrictEqual(atomicInput, atomicBefore, 'rejected atomic planning leaves caller snapshot untouched');

throws(
  () => prepareBxlMutation('Title = RAND();', {
    schema: { fields: [{ key: 'title', label: 'Title' }] },
    targetKind: 'card',
  }),
  (error: unknown) =>
    error instanceof BxlMutationError &&
    error.code === 'expression-syntax' &&
    error.message.includes('mutation-call-banned'),
  'volatile value expressions are rejected while preparing the program',
);

throws(
  () => prepareBxlMutation('.__proto__.polluted = true;', {
    schema: {
      fields: [{
        key: '__proto__',
        label: '__proto__',
        kind: 'object',
        fields: [{ key: 'polluted', label: 'polluted' }],
      }],
    },
    targetKind: 'card',
    syntax: 'solidified',
  }).plan({} as BxlMutationJson, { programId: 'unsafe:path' }),
  (error: unknown) => error instanceof BxlMutationError && error.code === 'prototype-path-forbidden',
  'prototype paths are rejected even if supplied by a hostile schema',
);

const streamedSource = 'Note = "keep; this semicolon";\nStatus = "ready";';
const expectedStreamedStatements = [
  'Note = "keep; this semicolon";',
  'Status = "ready";',
];
for (let split = 0; split <= streamedSource.length; split++) {
  const stream = createBxlMutationStatementStream();
  const statements = [
    ...stream.push(streamedSource.slice(0, split)),
    ...stream.push(streamedSource.slice(split)),
  ];
  stream.finish();
  deepStrictEqual(statements, expectedStreamedStatements, `stream split ${split}`);
}
const characterStream = createBxlMutationStatementStream();
const characterStatements = [...streamedSource].flatMap((character) =>
  characterStream.push(character),
);
characterStream.finish();
deepStrictEqual(characterStatements, expectedStreamedStatements, 'one-character chunks frame complete statements only');

const incompleteStream = createBxlMutationStatementStream();
incompleteStream.push('Title = "Final"');
throws(
  () => incompleteStream.finish(),
  (error: unknown) => error instanceof BxlMutationError && error.code === 'stream-incomplete',
  'stream finish rejects an unterminated final statement',
);

console.log(
  `BXL mutation planner: ${accepted.length} dual-encoding fixtures and ${rejectedPlannerCases.length + 3} rejected boundaries passed`,
);
