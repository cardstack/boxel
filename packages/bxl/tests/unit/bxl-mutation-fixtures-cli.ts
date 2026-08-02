import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import {
  bxlMutationExamples,
  mutationSchemaFixtures,
  type AcceptedMutationFixture,
  type MutationJson,
  type MutationPath,
  type MutationPlanIntent,
} from '../../examples/bxl-mutation-examples.js';

function clone<T>(value: T): T {
  return structuredClone(value);
}

function valueAt(root: MutationJson, path: MutationPath): MutationJson | undefined {
  let value: MutationJson | undefined = root;
  for (const segment of path) {
    if (value === null || typeof value !== 'object') {
      return undefined;
    }
    value = (value as MutationJson[] | Record<string, MutationJson>)[segment as never];
  }
  return value;
}

function setAt(root: MutationJson, path: MutationPath, value: MutationJson): MutationJson {
  if (path.length === 0) {
    return clone(value);
  }
  const parentPath = path.slice(0, -1);
  const key = path[path.length - 1]!;
  const parent = valueAt(root, parentPath);
  ok(parent !== undefined && parent !== null && typeof parent === 'object', `missing parent ${JSON.stringify(parentPath)}`);
  (parent as MutationJson[] | Record<string, MutationJson>)[key as never] = clone(value) as never;
  return root;
}

function deleteAt(root: MutationJson, path: MutationPath): MutationJson {
  ok(path.length > 0, 'the fixture reference adapter does not delete a root');
  const parent = valueAt(root, path.slice(0, -1));
  const key = path[path.length - 1]!;
  ok(parent !== undefined && parent !== null && typeof parent === 'object', `missing delete parent for ${JSON.stringify(path)}`);
  if (Array.isArray(parent)) {
    strictEqual(typeof key, 'number', 'array deletion requires a numeric path segment');
    parent.splice(key, 1);
  } else {
    delete parent[String(key)];
  }
  return root;
}

function collectionAt(root: MutationJson, path: MutationPath): MutationJson[] {
  const collection = valueAt(root, path);
  ok(Array.isArray(collection), `expected collection at ${JSON.stringify(path)}`);
  return collection;
}

function objectId(value: MutationJson): string | undefined {
  if (value !== null && !Array.isArray(value) && typeof value === 'object') {
    const id = value.id;
    return typeof id === 'string' ? id : undefined;
  }
  return undefined;
}

function applyIntent(
  root: MutationJson,
  intent: MutationPlanIntent,
  fixture: AcceptedMutationFixture,
): MutationJson {
  switch (intent.op) {
    case 'set': {
      if ('before' in intent) {
        deepStrictEqual(valueAt(root, intent.path), intent.before, `${fixture.id}: set before value`);
      }
      return setAt(root, intent.path, intent.after);
    }
    case 'delete': {
      deepStrictEqual(valueAt(root, intent.path), intent.before, `${fixture.id}: delete before value`);
      return deleteAt(root, intent.path);
    }
    case 'copy': {
      const source = valueAt(root, intent.from);
      ok(source !== undefined, `${fixture.id}: copy source must exist`);
      return setAt(root, intent.path, source);
    }
    case 'add-to-set': {
      const collection = collectionAt(root, intent.collection);
      if (!collection.some((value) => JSON.stringify(value) === JSON.stringify(intent.value))) {
        collection.push(clone(intent.value));
      }
      return root;
    }
    case 'remove-from-set': {
      const collection = collectionAt(root, intent.collection);
      const index = collection.findIndex((value) => JSON.stringify(value) === JSON.stringify(intent.value));
      ok(index >= 0, `${fixture.id}: set value to remove must exist`);
      collection.splice(index, 1);
      return root;
    }
    case 'insert': {
      const collection = collectionAt(root, intent.collection);
      collection.splice(intent.index, 0, clone(intent.value));
      return root;
    }
    case 'move': {
      const sourceCollection = collectionAt(root, intent.from.slice(0, -1));
      const sourceIndex = intent.from[intent.from.length - 1];
      ok(typeof sourceIndex === 'number', `${fixture.id}: move source must end in an index`);
      const [value] = sourceCollection.splice(sourceIndex, 1);
      ok(value !== undefined, `${fixture.id}: move source must exist`);
      const targetCollection = collectionAt(root, intent.toCollection);
      targetCollection.splice(intent.toIndex, 0, value);
      return root;
    }
    case 'reorder': {
      const collection = collectionAt(root, intent.collection);
      const byKey = new Map(
        collection.map((value) => [JSON.stringify(valueAt(value, intent.key)), value]),
      );
      const reordered = intent.order.map((key) => {
        const value = byKey.get(JSON.stringify(key));
        ok(value !== undefined, `${fixture.id}: reorder key ${JSON.stringify(key)} must exist`);
        return value;
      });
      collection.splice(0, collection.length, ...reordered);
      return root;
    }
    case 'relate': {
      const loadedCard = fixture.store?.[intent.cardId] ?? { id: intent.cardId };
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
        const index = current.findIndex((value) => objectId(value) === intent.cardId);
        ok(index >= 0, `${fixture.id}: linked card ${intent.cardId} must exist`);
        current.splice(index, 1);
        return root;
      }
      strictEqual(objectId(current as MutationJson), intent.cardId, `${fixture.id}: singular link must match`);
      return deleteAt(root, intent.field);
    }
    case 'move-relation': {
      const current = collectionAt(root, intent.field);
      const index = current.findIndex((value) => objectId(value) === intent.cardId);
      ok(index >= 0, `${fixture.id}: linked card ${intent.cardId} must exist`);
      const [value] = current.splice(index, 1);
      current.splice(intent.toIndex, 0, value!);
      return root;
    }
  }
}

function applyPlan(fixture: AcceptedMutationFixture): MutationJson {
  let output = clone(fixture.before);
  for (const statement of fixture.plan) {
    strictEqual(statement.affected >= 0, true, `${fixture.id}: affected count is non-negative`);
    for (const intent of statement.intents) {
      output = applyIntent(output, intent, fixture);
    }
  }
  return output;
}

function completeStatements(source: string): string[] {
  const statements: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (let index = 0; index < source.length; index++) {
    const character = source[index]!;
    if (quote !== null) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '(' || character === '[' || character === '{') {
      depth++;
    } else if (character === ')' || character === ']' || character === '}') {
      depth--;
      ok(depth >= 0, 'fixture source has balanced delimiters');
    } else if (character === ';' && depth === 0) {
      statements.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }
  ok(depth >= 0, 'fixture source has balanced delimiters');
  return statements;
}

let accepted = 0;
let rejected = 0;
let readableSolidifications = 0;
const groups = new Set<string>();
const errorCodes = new Set<string>();

for (const fixture of bxlMutationExamples) {
  groups.add(fixture.group);
  strictEqual(fixture.execution.model, 'loaded-card', `${fixture.id}: mutations target loaded Cards`);
  strictEqual(fixture.execution.syntax, 'readable', `${fixture.id}: corpus defaults to human-readable syntax`);
  ok(fixture.schema in mutationSchemaFixtures, `${fixture.id}: schema fixture exists`);
  ok(fixture.intent.length > 0, `${fixture.id}: intent is documented`);

  if (fixture.chunks) {
    strictEqual(fixture.chunks.join(''), fixture.source, `${fixture.id}: chunks reconstruct source exactly`);
  }

  const operationIds = fixture.operations.map((operation) => operation.id);
  const hasDuplicateOperationId = new Set(operationIds).size !== operationIds.length;
  strictEqual(
    hasDuplicateOperationId,
    fixture.id === 'reject-duplicate-operation-id',
    `${fixture.id}: duplicate operation IDs are rejected explicitly`,
  );

  if (fixture.outcome === 'accepted') {
    accepted++;
    strictEqual(fixture.readableSource.trim().endsWith(';'), true, `${fixture.id}: readable source is framed`);
    strictEqual(
      completeStatements(fixture.readableSource).length,
      fixture.plan.length,
      `${fixture.id}: readable source and normalized plan have equal statement counts`,
    );
    if (fixture.readableSource !== fixture.source) {
      readableSolidifications++;
    }
    strictEqual(fixture.source.trim().endsWith(';'), true, `${fixture.id}: accepted source is framed`);
    strictEqual(
      completeStatements(fixture.source).length,
      fixture.plan.length,
      `${fixture.id}: source and normalized plan have equal statement counts`,
    );
    strictEqual(
      fixture.operations.length,
      fixture.plan.length,
      `${fixture.id}: structured and textual encodings have equal operation counts`,
    );
    deepStrictEqual(applyPlan(fixture), fixture.after, `${fixture.id}: normalized plan produces after snapshot`);
    if (fixture.execution.returning) {
      ok(fixture.expectedReturning !== undefined, `${fixture.id}: returning selection has an expected result`);
    }
  } else {
    rejected++;
    errorCodes.add(fixture.error.code);
    if (fixture.error.code !== 'stream-incomplete') {
      strictEqual(fixture.source.trim().endsWith(';'), true, `${fixture.id}: completed rejected source is framed`);
    }
  }

  if (fixture.features.includes('relationship') && fixture.outcome === 'accepted') {
    strictEqual(
      fixture.source.includes('.relationships'),
      false,
      `${fixture.id}: accepted relationship syntax never exposes JSON:API storage`,
    );
    for (const operation of fixture.operations) {
      if (operation.op === 'relate') {
        strictEqual(typeof operation.cardId, 'string', `${fixture.id}: relate operation carries cardId`);
        strictEqual('value' in operation, false, `${fixture.id}: relate operation does not embed a Card`);
      }
    }
  }
}

ok(accepted >= 20, `expected at least 20 accepted mutation fixtures, found ${accepted}`);
ok(rejected >= 10, `expected at least 10 rejected mutation fixtures, found ${rejected}`);
ok(
  readableSolidifications >= 15,
  `expected at least 15 readable-to-canonical examples, found ${readableSolidifications}`,
);
ok(groups.size >= 15, `expected at least 15 fixture groups, found ${groups.size}`);
ok(errorCodes.has('storage-projection-forbidden'), 'raw JSON:API relationship writes are rejected');
ok(errorCodes.has('field-read-only'), 'query-backed linksToMany writes are rejected');

console.log(
  `BXL mutation fixtures: ${bxlMutationExamples.length} cases passed (${accepted} accepted, ${rejected} rejected, ${readableSolidifications} readable solidifications, ${groups.size} groups)`,
);
