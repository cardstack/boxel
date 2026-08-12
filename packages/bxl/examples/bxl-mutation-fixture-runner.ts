import {
  bxlMutationExamples,
  mutationSchemaFixtures,
  type AcceptedMutationFixture,
  type BxlMutationExample,
  type MutationJson,
  type MutationPath,
  type MutationPlanIntent,
} from './bxl-mutation-examples.ts';

export interface MutationFixtureVerification {
  fixtureId: string;
  passed: boolean;
  checks: string[];
  durationMs: number;
  computedAfter?: MutationJson;
  error?: string;
}

export interface MutationCorpusVerification {
  passed: boolean;
  results: MutationFixtureVerification[];
  checks: string[];
  errors: string[];
  durationMs: number;
  accepted: number;
  rejected: number;
  readableSolidifications: number;
  groups: number;
}

function now(): number {
  return globalThis.performance?.now() ?? Date.now();
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function fail(message: string): never {
  throw new Error(message);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

function assertEqual(
  actual: unknown,
  expected: unknown,
  message: string,
): void {
  if (!Object.is(actual, expected)) {
    fail(`${message}: expected ${json(expected)}, received ${json(actual)}`);
  }
}

function assertDeepEqual(
  actual: unknown,
  expected: unknown,
  message: string,
): void {
  if (json(actual) !== json(expected)) {
    fail(`${message}: expected ${json(expected)}, received ${json(actual)}`);
  }
}

function valueAt(
  root: MutationJson,
  path: MutationPath,
): MutationJson | undefined {
  let value: MutationJson | undefined = root;
  for (const segment of path) {
    if (value === null || typeof value !== 'object') return undefined;
    value = (value as MutationJson[] | Record<string, MutationJson>)[
      segment as never
    ];
  }
  return value;
}

function setAt(
  root: MutationJson,
  path: MutationPath,
  value: MutationJson,
): MutationJson {
  if (path.length === 0) return clone(value);
  const parentPath = path.slice(0, -1);
  const key = path[path.length - 1]!;
  const parent = valueAt(root, parentPath);
  assert(
    parent !== undefined && parent !== null && typeof parent === 'object',
    `missing parent ${json(parentPath)}`,
  );
  (parent as MutationJson[] | Record<string, MutationJson>)[key as never] =
    clone(value) as never;
  return root;
}

function deleteAt(root: MutationJson, path: MutationPath): MutationJson {
  assert(
    path.length > 0,
    'the fixture reference adapter does not delete a root',
  );
  const parent = valueAt(root, path.slice(0, -1));
  const key = path[path.length - 1]!;
  assert(
    parent !== undefined && parent !== null && typeof parent === 'object',
    `missing delete parent for ${json(path)}`,
  );
  if (Array.isArray(parent)) {
    assertEqual(
      typeof key,
      'number',
      'array deletion requires a numeric path segment',
    );
    parent.splice(key as number, 1);
  } else {
    delete parent[String(key)];
  }
  return root;
}

function collectionAt(root: MutationJson, path: MutationPath): MutationJson[] {
  const collection = valueAt(root, path);
  assert(Array.isArray(collection), `expected collection at ${json(path)}`);
  return collection;
}

function objectId(value: MutationJson): string | undefined {
  if (value !== null && !Array.isArray(value) && typeof value === 'object') {
    return typeof value.id === 'string' ? value.id : undefined;
  }
  return undefined;
}

function applyIntent(
  root: MutationJson,
  intent: MutationPlanIntent,
  fixture: AcceptedMutationFixture,
): MutationJson {
  switch (intent.op) {
    case 'set':
      if ('before' in intent)
        assertDeepEqual(
          valueAt(root, intent.path),
          intent.before,
          `${fixture.id}: set before value`,
        );
      return setAt(root, intent.path, intent.after);
    case 'delete':
      assertDeepEqual(
        valueAt(root, intent.path),
        intent.before,
        `${fixture.id}: delete before value`,
      );
      return deleteAt(root, intent.path);
    case 'copy': {
      const source = valueAt(root, intent.from);
      assert(source !== undefined, `${fixture.id}: copy source must exist`);
      return setAt(root, intent.path, source);
    }
    case 'insert':
      collectionAt(root, intent.collection).splice(
        intent.index,
        0,
        clone(intent.value),
      );
      return root;
    case 'move': {
      const sourceCollection = collectionAt(root, intent.from.slice(0, -1));
      const sourceIndex = intent.from[intent.from.length - 1];
      assert(
        typeof sourceIndex === 'number',
        `${fixture.id}: move source must end in an index`,
      );
      const [value] = sourceCollection.splice(sourceIndex, 1);
      assert(value !== undefined, `${fixture.id}: move source must exist`);
      collectionAt(root, intent.toCollection).splice(intent.toIndex, 0, value);
      return root;
    }
    case 'reorder': {
      const collection = collectionAt(root, intent.collection);
      const byKey = new Map(
        collection.map((value) => [json(valueAt(value, intent.key)), value]),
      );
      const reordered = intent.order.map((key) => {
        const value = byKey.get(json(key));
        assert(
          value !== undefined,
          `${fixture.id}: reorder key ${json(key)} must exist`,
        );
        return value;
      });
      collection.splice(0, collection.length, ...reordered);
      return root;
    }
    case 'relate': {
      const loadedCard = fixture.store?.[intent.cardId] ?? {
        id: intent.cardId,
      };
      const current = valueAt(root, intent.field);
      if (Array.isArray(current)) {
        current.splice(intent.index ?? current.length, 0, clone(loadedCard));
        return root;
      }
      return setAt(root, intent.field, loadedCard);
    }
    case 'unrelate': {
      const current = valueAt(root, intent.field);
      if (Array.isArray(current)) {
        const index = current.findIndex(
          (value) => objectId(value) === intent.cardId,
        );
        assert(
          index >= 0,
          `${fixture.id}: linked card ${intent.cardId} must exist`,
        );
        current.splice(index, 1);
        return root;
      }
      assertEqual(
        objectId(current as MutationJson),
        intent.cardId,
        `${fixture.id}: singular link must match`,
      );
      return deleteAt(root, intent.field);
    }
    case 'move-relation': {
      const current = collectionAt(root, intent.field);
      const index = current.findIndex(
        (value) => objectId(value) === intent.cardId,
      );
      assert(
        index >= 0,
        `${fixture.id}: linked card ${intent.cardId} must exist`,
      );
      const [value] = current.splice(index, 1);
      current.splice(intent.toIndex, 0, value!);
      return root;
    }
  }
}

export function applyMutationFixturePlan(
  fixture: AcceptedMutationFixture,
): MutationJson {
  let output = clone(fixture.before);
  for (const statement of fixture.plan) {
    assert(
      statement.affected >= 0,
      `${fixture.id}: affected count is non-negative`,
    );
    for (const intent of statement.intents)
      output = applyIntent(output, intent, fixture);
  }
  return output;
}

export function completeMutationStatements(source: string): string[] {
  const statements: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (let index = 0; index < source.length; index++) {
    const character = source[index]!;
    if (quote !== null) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === '(' || character === '[' || character === '{')
      depth++;
    else if (character === ')' || character === ']' || character === '}') {
      depth--;
      assert(depth >= 0, 'fixture source has balanced delimiters');
    } else if (character === ';' && depth === 0) {
      statements.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }
  assert(depth >= 0, 'fixture source has balanced delimiters');
  return statements;
}

export function verifyMutationFixture(
  fixture: BxlMutationExample,
): MutationFixtureVerification {
  const started = now();
  const checks: string[] = [];
  const check = (label: string, assertion: () => void) => {
    assertion();
    checks.push(label);
  };

  try {
    check('targets the loaded Card model', () =>
      assertEqual(
        fixture.execution.model,
        'loaded-card',
        `${fixture.id}: model`,
      ),
    );
    check('defaults to readable syntax', () =>
      assertEqual(
        fixture.execution.syntax,
        'readable',
        `${fixture.id}: syntax`,
      ),
    );
    check('references a known Card/Field shape', () =>
      assert(
        fixture.schema in mutationSchemaFixtures,
        `${fixture.id}: schema fixture exists`,
      ),
    );
    check('documents human intent', () =>
      assert(fixture.intent.length > 0, `${fixture.id}: intent is documented`),
    );

    if (fixture.chunks) {
      check('stream chunks reconstruct solidified source', () =>
        assertEqual(
          fixture.chunks!.join(''),
          fixture.source,
          `${fixture.id}: chunks`,
        ),
      );
    }

    check('operation identities follow the contract', () => {
      const operationIds = fixture.operations.map((operation) => operation.id);
      const hasDuplicate = new Set(operationIds).size !== operationIds.length;
      const expectsDuplicate =
        fixture.outcome === 'rejected' &&
        fixture.error.code === 'duplicate-operation-id';
      assertEqual(
        hasDuplicate,
        expectsDuplicate,
        `${fixture.id}: duplicate operation IDs`,
      );
    });

    if (fixture.readableSource) {
      check('text and tool calls agree on bulk cardinality', () => {
        const textIsBulk = fixture.readableSource!.includes('[*');
        const toolIsBulk = fixture.operations.some((operation) =>
          operation.op.endsWith('-all'),
        );
        assertEqual(toolIsBulk, textIsBulk, `${fixture.id}: bulk encoding`);
      });
    }

    let computedAfter: MutationJson | undefined;
    if (fixture.outcome === 'accepted') {
      check('readable source is statement-framed', () =>
        assert(
          fixture.readableSource.trim().endsWith(';'),
          `${fixture.id}: readable framing`,
        ),
      );
      check('readable statements match planned statements', () =>
        assertEqual(
          completeMutationStatements(fixture.readableSource).length,
          fixture.plan.length,
          `${fixture.id}: readable statement count`,
        ),
      );
      check('solidified source is statement-framed', () =>
        assert(
          fixture.source.trim().endsWith(';'),
          `${fixture.id}: solidified framing`,
        ),
      );
      check('solidified statements match planned statements', () =>
        assertEqual(
          completeMutationStatements(fixture.source).length,
          fixture.plan.length,
          `${fixture.id}: solidified statement count`,
        ),
      );
      check('tool operations match planned statements', () =>
        assertEqual(
          fixture.operations.length,
          fixture.plan.length,
          `${fixture.id}: operation count`,
        ),
      );
      check('normalized plan produces the expected loaded model', () => {
        computedAfter = applyMutationFixturePlan(fixture);
        assertDeepEqual(
          computedAfter,
          fixture.after,
          `${fixture.id}: after snapshot`,
        );
      });
      if (fixture.execution.returning) {
        check('returning projection has an expected result', () =>
          assert(
            fixture.expectedReturning !== undefined,
            `${fixture.id}: returning`,
          ),
        );
      }
    } else if (fixture.error.code !== 'stream-incomplete') {
      check('rejected complete source is statement-framed', () =>
        assert(
          fixture.source.trim().endsWith(';'),
          `${fixture.id}: rejected framing`,
        ),
      );
    }

    if (
      fixture.features.includes('relationship') &&
      fixture.outcome === 'accepted'
    ) {
      check('relationship syntax hides JSON:API storage', () =>
        assert(
          !fixture.source.includes('.relationships'),
          `${fixture.id}: storage projection`,
        ),
      );
      check(
        'relationship tool calls carry Card IDs, not embedded Cards',
        () => {
          for (const operation of fixture.operations) {
            if (operation.op !== 'relate') continue;
            assert(
              typeof operation.cardId === 'string',
              `${fixture.id}: relate cardId`,
            );
            assert(
              !('value' in operation),
              `${fixture.id}: relate embeds Card value`,
            );
          }
        },
      );
    }

    return {
      fixtureId: fixture.id,
      passed: true,
      checks,
      computedAfter,
      durationMs: now() - started,
    };
  } catch (error) {
    return {
      fixtureId: fixture.id,
      passed: false,
      checks,
      durationMs: now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function verifyMutationCorpus(
  fixtures: BxlMutationExample[] = bxlMutationExamples,
): MutationCorpusVerification {
  const started = now();
  const results = fixtures.map(verifyMutationFixture);
  const checks: string[] = [];
  const errors: string[] = [];
  const accepted = fixtures.filter(
    (fixture) => fixture.outcome === 'accepted',
  ).length;
  const rejected = fixtures.length - accepted;
  const readableSolidifications = fixtures.filter(
    (fixture) =>
      fixture.outcome === 'accepted' &&
      fixture.readableSource !== fixture.source,
  ).length;
  const acceptedReadableSources = fixtures.flatMap((fixture) =>
    fixture.outcome === 'accepted' ? [fixture.readableSource] : [],
  );
  const textualSources = fixtures.flatMap((fixture) => [
    fixture.source,
    ...(fixture.readableSource ? [fixture.readableSource] : []),
    ...(fixture.outcome === 'accepted'
      ? fixture.plan.map((statement) => statement.canonical)
      : []),
  ]);
  const operationKinds = new Set(
    fixtures.flatMap((fixture) =>
      fixture.operations.map((operation) => operation.op),
    ),
  );
  const groups = new Set(fixtures.map((fixture) => fixture.group)).size;
  const errorCodes = new Set(
    fixtures.flatMap((fixture) =>
      fixture.outcome === 'rejected' ? [fixture.error.code] : [],
    ),
  );
  const corpusCheck = (label: string, condition: boolean) => {
    if (condition) checks.push(label);
    else errors.push(label);
  };

  corpusCheck('at least 20 accepted fixtures', accepted >= 20);
  corpusCheck('at least 10 rejected fixtures', rejected >= 10);
  corpusCheck(
    'at least 15 readable solidifications',
    readableSolidifications >= 15,
  );
  corpusCheck('at least 15 fixture groups', groups >= 15);
  corpusCheck(
    'readable syntax omits deprecated copy and insert spellings',
    acceptedReadableSources.every(
      (source) => !/\b(?:copy_to|insert_after|insert_before)\s*\(/.test(source),
    ),
  );
  corpusCheck(
    '[* predicate] is the only textual bulk marker',
    textualSources.every(
      (source) => !/\b(?:update_all|delete_all)\s*\(/.test(source),
    ),
  );
  corpusCheck(
    'bulk update uses an explicit all-selector with compound assignment',
    acceptedReadableSources.includes(
      '"Line Item"[* Taxable].Discount += 0.05;',
    ),
  );
  corpusCheck(
    'bulk set uses the same explicit all-selector',
    acceptedReadableSources.includes('"Line Item"[* Taxable].Discount = 0;'),
  );
  corpusCheck(
    'bulk delete uses the same explicit all-selector',
    acceptedReadableSources.includes('del(Tag[* . = "obsolete"]);'),
  );
  corpusCheck(
    'field-root fixtures use schema labels instead of a bare root',
    fixtures.every(
      (fixture) =>
        fixture.outcome !== 'accepted' ||
        !fixture.features.includes('field-root') ||
        !/(?:^\s*\.|\b(?:append|prepend|del)\s*\(\s*\.)/.test(
          fixture.readableSource,
        ),
    ),
  );
  corpusCheck(
    'the closed structural statement set has executable examples',
    [
      'replace(',
      'prepend(',
      'append(',
      'insert_at(',
      'insert_item_before(',
      'insert_item_after(',
      'move_item_before(',
      'move_item_after(',
      'move_item_to_start(',
      'move_item_to_end(',
      'reorder_by(',
    ].every((spelling) =>
      acceptedReadableSources.some((source) => source.includes(spelling)),
    ),
  );
  corpusCheck(
    'every structured operation kind has a corpus case',
    [
      'set',
      'update',
      'set-all',
      'update-all',
      'replace',
      'copy',
      'delete',
      'delete-all',
      'insert',
      'move',
      'reorder',
      'assert',
      'relate',
      'unrelate',
      'move-relation',
    ].every((operation) => operationKinds.has(operation)),
  );
  corpusCheck(
    'raw JSON:API relationship writes are rejected',
    errorCodes.has('storage-projection-forbidden'),
  );
  corpusCheck(
    'query-backed linksToMany writes are rejected',
    errorCodes.has('field-read-only'),
  );

  return {
    passed: results.every((result) => result.passed) && errors.length === 0,
    results,
    checks,
    errors,
    durationMs: now() - started,
    accepted,
    rejected,
    readableSolidifications,
    groups,
  };
}
