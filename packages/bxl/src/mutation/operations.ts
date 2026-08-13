import {
  BxlMutationError,
  type BxlMutationJson,
  type BxlMutationPath,
  type BxlMutationPlan,
  type BxlMutationPrepareOptions,
  type BxlStructuredMutationOperation,
  type PreparedBxlMutation,
} from './types.ts';
import { prepareBxlMutation } from './planner.ts';

type RecordValue = Record<string, unknown>;

function record(value: unknown, label: string, statement: number): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BxlMutationError(
      'parse',
      'operation-shape',
      statement,
      `${label} must be an object.`,
    );
  }
  return value as RecordValue;
}

function path(
  value: unknown,
  label: string,
  statement: number,
): BxlMutationPath {
  if (
    !Array.isArray(value) ||
    !value.every(
      (part) =>
        typeof part === 'string' ||
        (typeof part === 'number' && Number.isInteger(part)),
    )
  ) {
    throw new BxlMutationError(
      'parse',
      'operation-path',
      statement,
      `${label} must be an array of string/integer path parts.`,
    );
  }
  return value as BxlMutationPath;
}

function pathSource(parts: BxlMutationPath): string {
  let source = '.';
  for (const part of parts) {
    if (typeof part === 'number') source += `[${part}]`;
    else if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(part))
      source += source === '.' ? part : `.${part}`;
    else source += `[${JSON.stringify(part)}]`;
  }
  return source;
}

function jsonSource(value: unknown, label: string, statement: number): string {
  const source = JSON.stringify(value);
  if (source === undefined) {
    throw new BxlMutationError(
      'parse',
      'operation-value',
      statement,
      `${label} must be JSON serializable.`,
    );
  }
  return source;
}

function selectorPredicate(where: unknown, statement: number): string {
  if (!Array.isArray(where) || where.length === 0) {
    throw new BxlMutationError(
      'parse',
      'operation-selector',
      statement,
      'Selector where must contain at least one equality term.',
    );
  }
  return where
    .map((term, index) => {
      const condition = record(term, `where[${index}]`, statement);
      if (!('equals' in condition)) {
        throw new BxlMutationError(
          'parse',
          'operation-selector',
          statement,
          'Version 1 structured selectors require equals.',
        );
      }
      return `${pathSource(path(condition.path, `where[${index}].path`, statement))}==${jsonSource(condition.equals, 'equals', statement)}`;
    })
    .join(' and ');
}

function targetSource(
  targetValue: unknown,
  statement: number,
  bulk = false,
): string {
  const target = record(targetValue, 'target', statement);
  if ('path' in target)
    return pathSource(path(target.path, 'target.path', statement));
  const collection = path(target.collection, 'target.collection', statement);
  const predicate = selectorPredicate(target.where, statement);
  const relative = path(
    target.relativePath ?? [],
    'target.relativePath',
    statement,
  );
  if (bulk) {
    return `${pathSource(collection)}[* ${predicate}]${relative.length === 0 ? '' : pathSource(relative)}`;
  }
  return `(${pathSource(collection)}[]|select(${predicate})${relative.length === 0 ? '' : `|${pathSource(relative)}`})`;
}

function expressionOrValue(operation: RecordValue, statement: number): string {
  if (typeof operation.expression === 'string') return operation.expression;
  if ('value' in operation)
    return jsonSource(operation.value, 'operation.value', statement);
  throw new BxlMutationError(
    'parse',
    'operation-value',
    statement,
    'Operation requires value or expression.',
  );
}

function positionCall(
  operation: RecordValue,
  value: string,
  collection: string,
  statement: number,
): string {
  const position = record(operation.position, 'position', statement);
  if (position.at === 'start') return `prepend(${collection};${value})`;
  if (position.at === 'end') return `append(${collection};${value})`;
  if (typeof position.index === 'number')
    return `insert_at(${collection};${position.index};${value})`;
  if (position.before)
    return `insert_item_before(${value};${targetSource(position.before, statement)})`;
  if (position.after)
    return `insert_item_after(${value};${targetSource(position.after, statement)})`;
  throw new BxlMutationError(
    'parse',
    'operation-position',
    statement,
    'Unsupported insertion position.',
  );
}

function moveCall(operation: RecordValue, statement: number): string {
  const item = targetSource(operation.target, statement);
  const collection = pathSource(
    path(
      record(operation.into, 'into', statement).path,
      'into.path',
      statement,
    ),
  );
  const position = record(operation.position, 'position', statement);
  if (position.at === 'start')
    return `move_item_to_start(${item};${collection})`;
  if (position.at === 'end') return `move_item_to_end(${item};${collection})`;
  if (position.before)
    return `move_item_before(${item};${targetSource(position.before, statement)})`;
  if (position.after)
    return `move_item_after(${item};${targetSource(position.after, statement)})`;
  throw new BxlMutationError(
    'parse',
    'operation-position',
    statement,
    'Unsupported move position.',
  );
}

function relationSelector(
  target: unknown,
  cardId: string,
  statement: number,
): string {
  const field = targetSource(target, statement);
  return `(${field}[]|select(.id==${JSON.stringify(cardId)}))`;
}

function relationshipType(
  targetValue: unknown,
  options: Omit<BxlMutationPrepareOptions, 'syntax'> | undefined,
  statement: number,
): 'linksTo' | 'linksToMany' | undefined {
  if (!options) return undefined;
  const target = record(targetValue, 'target', statement);
  if (!('path' in target)) return undefined;
  const parts = path(target.path, 'target.path', statement);
  if (parts.length === 0) {
    const type = options.schema.rootField?.fieldType;
    return type === 'linksTo' || type === 'linksToMany' ? type : undefined;
  }
  let schema = options.schema;
  for (const part of parts) {
    if (typeof part === 'number') continue;
    const field = schema.fields.find((candidate) => candidate.key === part);
    if (!field) return undefined;
    if (field.fieldType === 'linksTo' || field.fieldType === 'linksToMany')
      return field.fieldType;
    if (field.item) schema = field.item;
    else if (field.fields) schema = { fields: field.fields };
  }
  return undefined;
}

function operationSource(
  operation: BxlStructuredMutationOperation,
  statement: number,
  options?: Omit<BxlMutationPrepareOptions, 'syntax'>,
): string {
  const value = operation as RecordValue;
  switch (operation.op) {
    case 'assert':
      if (
        typeof value.expression !== 'string' ||
        typeof value.message !== 'string'
      ) {
        throw new BxlMutationError(
          'parse',
          'operation-value',
          statement,
          'assert requires string expression and message fields.',
        );
      }
      return `assert(${value.expression};${JSON.stringify(value.message)})`;
    case 'set':
      return `${targetSource(value.target, statement)}=${expressionOrValue(value, statement)}`;
    case 'set-all':
      return `${targetSource(value.target, statement, true)}=${expressionOrValue(value, statement)}`;
    case 'update':
      if (typeof value.expression !== 'string')
        throw new BxlMutationError(
          'parse',
          'operation-value',
          statement,
          'update requires expression.',
        );
      return `${targetSource(value.target, statement)}|=${value.expression}`;
    case 'update-all':
      if (typeof value.expression !== 'string')
        throw new BxlMutationError(
          'parse',
          'operation-value',
          statement,
          'update-all requires expression.',
        );
      return `${targetSource(value.target, statement, true)}|=${value.expression}`;
    case 'replace':
      return `replace(${targetSource(value.target, statement)};${expressionOrValue(value, statement)})`;
    case 'copy':
      return `copy_value_to(${targetSource(value.from, statement)};${targetSource(value.target, statement)})`;
    case 'delete':
      return `del(${targetSource(value.target, statement)})`;
    case 'delete-all':
      return `del(${targetSource(value.target, statement, true)})`;
    case 'insert': {
      const collection = pathSource(
        path(
          record(value.into, 'into', statement).path,
          'into.path',
          statement,
        ),
      );
      return positionCall(
        value,
        expressionOrValue(value, statement),
        collection,
        statement,
      );
    }
    case 'move':
      return moveCall(value, statement);
    case 'reorder':
      return `reorder_by(${targetSource(value.target, statement)};${pathSource(path(value.key, 'key', statement))};${jsonSource(value.order, 'order', statement)})`;
    case 'relate': {
      if (typeof value.cardId !== 'string')
        throw new BxlMutationError(
          'parse',
          'operation-card-id',
          statement,
          'relate requires cardId.',
        );
      const target = targetSource(value.target, statement);
      const card = `card(${JSON.stringify(value.cardId)})`;
      if (value.position) return positionCall(value, card, target, statement);
      if (
        relationshipType(value.target, options, statement) === 'linksToMany'
      ) {
        return `append(${target};${card})`;
      }
      return `${target}=${card}`;
    }
    case 'unrelate':
      if (typeof value.cardId !== 'string')
        throw new BxlMutationError(
          'parse',
          'operation-card-id',
          statement,
          'unrelate requires cardId.',
        );
      return `del(${relationSelector(value.target, value.cardId, statement)})`;
    case 'move-relation': {
      if (typeof value.cardId !== 'string')
        throw new BxlMutationError(
          'parse',
          'operation-card-id',
          statement,
          'move-relation requires cardId.',
        );
      const item = relationSelector(value.target, value.cardId, statement);
      const position = record(value.position, 'position', statement);
      if (position.before)
        return `move_item_before(${item};${targetSource(position.before, statement)})`;
      if (position.after)
        return `move_item_after(${item};${targetSource(position.after, statement)})`;
      const field = targetSource(value.target, statement);
      if (position.at === 'start')
        return `move_item_to_start(${item};${field})`;
      if (position.at === 'end') return `move_item_to_end(${item};${field})`;
      throw new BxlMutationError(
        'parse',
        'operation-position',
        statement,
        'Unsupported relationship move position.',
      );
    }
  }
}

export function solidifyBxlMutationOperations(
  operations: ReadonlyArray<BxlStructuredMutationOperation>,
  options?: Omit<BxlMutationPrepareOptions, 'syntax'>,
): string {
  if (operations.length === 0) {
    throw new BxlMutationError(
      'parse',
      'program-empty',
      1,
      'Structured mutation program must contain operations.',
    );
  }
  const ids = new Set<string>();
  return operations
    .map((operation, index) => {
      const statement = index + 1;
      if (!operation.id)
        throw new BxlMutationError(
          'parse',
          'operation-id-required',
          statement,
          'Every operation requires a stable id.',
        );
      if (ids.has(operation.id))
        throw new BxlMutationError(
          'parse',
          'duplicate-operation-id',
          statement,
          `Duplicate operation id ${JSON.stringify(operation.id)}.`,
        );
      ids.add(operation.id);
      return `${operationSource(operation, statement, options)};`;
    })
    .join('\n');
}

export function prepareBxlMutationOperations(
  operations: ReadonlyArray<BxlStructuredMutationOperation>,
  options: Omit<BxlMutationPrepareOptions, 'syntax'>,
): PreparedBxlMutation {
  const source = solidifyBxlMutationOperations(operations, options);
  const prepared = prepareBxlMutation(source, {
    ...options,
    syntax: 'solidified',
  });
  return Object.freeze({
    ...prepared,
    language: 'bxl-mutation-ops/1' as const,
    source: JSON.stringify(operations),
    plan(
      snapshot: BxlMutationJson,
      planOptions: Parameters<PreparedBxlMutation['plan']>[1],
    ): BxlMutationPlan {
      return {
        ...prepared.plan(snapshot, planOptions),
        language: 'bxl-mutation-ops/1',
        source: JSON.stringify(operations),
      };
    },
  });
}
