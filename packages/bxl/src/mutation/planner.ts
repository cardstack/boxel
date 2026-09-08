import { parseNativeJq } from '../bxl/bridge/native.ts';
import {
  DEFAULT_BUILTIN_LIBRARIES,
  resolveBuiltinRegistry,
  type ResolvedBuiltinRegistry,
} from '../bxl/registry/index.ts';
import { applyNormalBinaryOperator } from '../jqtools/evaluate/applyBinary.ts';
import { evaluateItemsWithRegistry } from '../jqtools/evaluate/evaluate.ts';
import {
  createItem,
  type Item,
  isTrue,
} from '../jqtools/evaluate/utils/utils.ts';
import { withRuntimeDiagnostics } from '../jqtools/evaluate/runtimeState.ts';
import type {
  ExpressionAst,
  NormalBinaryOperator,
} from '../jqtools/parser/AST.ts';
import {
  parseBxlMutationProgram,
  printMutationAst,
  readAssertSnapshotOption,
  type MutationAssignmentOperator,
  type ParsedMutationArgument,
  type ParsedMutationStatement,
} from './syntax.ts';
import {
  clone,
  deleteAt,
  equalJson,
  hasAt,
  pathKey,
  setAt,
  valueAt,
} from './json-path.ts';
import {
  classifyOverlayRead,
  EMPTY_OVERLAY_INDEX,
  mergeBxlMutationOverlays,
  overlayWriteOwner,
  type OverlayIndex,
} from './overlays.ts';
import {
  BxlMutationError,
  type BxlMutationField,
  type BxlMutationFieldType,
  type BxlMutationIntent,
  type BxlMutationJson,
  type BxlMutationOverlays,
  type BxlMutationPath,
  type BxlMutationPlan,
  type BxlMutationPlanOptions,
  type BxlMutationPrepareOptions,
  type BxlMutationReadEvent,
  type BxlMutationReturning,
  type BxlMutationSchema,
  type BxlMutationStatementPlan,
  type BxlMutationUnavailableOverlay,
  type PreparedBxlMutation,
} from './types.ts';

interface CardReference {
  readonly kind: 'card-reference';
  readonly id: string;
}

function isCardReference(value: unknown): value is CardReference {
  return Boolean(
    value &&
    typeof value === 'object' &&
    (value as Partial<CardReference>).kind === 'card-reference' &&
    typeof (value as Partial<CardReference>).id === 'string',
  );
}

interface ResolvedLocation {
  path: BxlMutationPath;
  value: BxlMutationJson | undefined;
  exists: boolean;
}

interface FieldResolution {
  field?: BxlMutationField;
  fieldType?: BxlMutationFieldType;
  fieldPath: BxlMutationPath;
  relationship?: { type: 'linksTo' | 'linksToMany'; path: BxlMutationPath };
  writeBehavior?: 'write' | 'skip';
}

interface PlannerContext {
  prepare: BxlMutationPrepareOptions;
  plan: BxlMutationPlanOptions;
  registry: ResolvedBuiltinRegistry;
  /** The host's overlay values, if any, as supplied to `plan`. */
  source?: BxlMutationOverlays;
  /** What the overlays answer for, against the document as it now stands. */
  overlays: OverlayIndex;
  onRead?: (event: BxlMutationReadEvent) => void;
}

/**
 * The document an expression is evaluated against: the Card's own document
 * with the overlays layered under it.
 *
 * The planner's working state is the Card's document alone, so a plan's output
 * and its intents carry stored values without anything having to be undone.
 * The view exists only for the duration of an evaluation, and shares the
 * working document's shape — an overlay never adds or retypes a container —
 * so a path resolved in one addresses the same element in the other.
 */
function readView(
  root: BxlMutationJson,
  context: PlannerContext,
): BxlMutationJson {
  if (context.overlays.empty) return root;
  return mergeBxlMutationOverlays(root, context.source).root;
}

/**
 * What a statement's reads resolved to. `strict` reads raise
 * `snapshot-unavailable` on a path the host could not supply; a best-effort
 * assert takes the unavailability back instead and fails with its own message.
 */
interface RecordedReads {
  events: BxlMutationReadEvent[];
  overlay: boolean;
  unavailable?: BxlMutationUnavailableOverlay;
}

/**
 * Where an expression's reads are anchored, and whether an unavailable one
 * stops the statement. A value expression reads from the Card root; the value
 * side of `|=` reads from the location it updates.
 */
interface ReadContext {
  prefix?: BxlMutationPath;
  policy?: 'strict' | 'best-effort';
}

function recordReads(
  argument: ParsedMutationArgument,
  input: BxlMutationJson,
  context: PlannerContext,
  statement: number,
  reads: ReadContext = {},
): RecordedReads {
  const result: RecordedReads = { events: [], overlay: false };
  if (context.onRead === undefined && context.overlays.empty) return result;
  const prefix = reads.prefix ?? [];
  for (const relative of argument.readPaths) {
    const path = [...prefix, ...relative];
    if (path.length === 0) continue;
    const resolved = classifyOverlayRead(
      context.overlays,
      path,
      valueAt(input, relative),
    );
    result.events.push(resolved.event);
    if (resolved.event.tier !== 'source') result.overlay = true;
    if (resolved.unavailable && !result.unavailable) {
      result.unavailable = resolved.unavailable;
    }
    context.onRead?.(resolved.event);
  }
  if ((reads.policy ?? 'strict') === 'strict' && result.unavailable) {
    const { path, tier, reason } = result.unavailable;
    throw new BxlMutationError(
      'plan',
      'snapshot-unavailable',
      statement,
      `The ${tier} value at ${path} is unavailable (${reason}).`,
      { details: { path, tier, reason } },
    );
  }
  return result;
}

/** Overlay values are read-only: a write that lands on one is refused. */
function assertWritableOverlayPath(
  path: BxlMutationPath,
  context: PlannerContext,
  statement: number,
): void {
  const owner = overlayWriteOwner(context.overlays, path);
  if (!owner) return;
  throw new BxlMutationError(
    'validate',
    owner.tier === 'computed' ? 'computed-read-only' : 'write-through-link',
    statement,
    owner.tier === 'computed'
      ? `${owner.path} is a computed value and cannot be written.`
      : `${owner.path} belongs to a linked Card and cannot be written through the link.`,
    { details: { path: owner.path, tier: owner.tier } },
  );
}

function collectionAt(
  root: BxlMutationJson,
  path: BxlMutationPath,
): BxlMutationJson[] {
  const value = valueAt(root, path);
  if (!Array.isArray(value))
    throw new Error(`Location ${pathKey(path)} is not a collection.`);
  return value;
}

function objectId(value: BxlMutationJson | undefined): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined;
  return typeof value.id === 'string' ? value.id : undefined;
}

function evaluateItems(
  ast: ExpressionAst,
  input: Item[],
  context: PlannerContext,
): Item[] {
  const runtime = withRuntimeDiagnostics(
    () => Array.from(evaluateItemsWithRegistry(ast, input, context.registry)),
    context.prepare.runtimeLimits,
  );
  if (runtime.error) throw runtime.error;
  return runtime.result ?? [];
}

function evaluateSingleJson(
  argument: ParsedMutationArgument,
  input: BxlMutationJson,
  context: PlannerContext,
  statement: number,
  reads: ReadContext = {},
): BxlMutationJson | CardReference {
  recordReads(argument, input, context, statement, reads);
  if (
    argument.ast.type === 'filter' &&
    argument.ast.name === 'card/1' &&
    argument.ast.args.length === 1
  ) {
    const cardIdItems = evaluateItems(
      argument.ast.args[0]!,
      [createItem(input)],
      context,
    );
    if (cardIdItems.length !== 1 || typeof cardIdItems[0]!.value !== 'string') {
      throw new BxlMutationError(
        'plan',
        'card-id-invalid',
        statement,
        'card(id) requires exactly one string Card ID.',
      );
    }
    return { kind: 'card-reference', id: cardIdItems[0]!.value };
  }
  const values = evaluateItems(argument.ast, [createItem(input)], context);
  if (values.length !== 1) {
    throw new BxlMutationError(
      'plan',
      'value-cardinality',
      statement,
      `Mutation value expressions must produce exactly one value; received ${values.length}.`,
    );
  }
  return clone(values[0]!.value) as BxlMutationJson;
}

function resolveLocations(
  argument: ParsedMutationArgument,
  root: BxlMutationJson,
  context: PlannerContext,
  statement: number,
  cardinality: 'one' | 'bulk' = argument.bulk ? 'bulk' : 'one',
): ResolvedLocation[] {
  let items: Item[];
  try {
    items = evaluateItems(
      argument.ast,
      [createItem(readView(root, context))],
      context,
    );
  } catch (error) {
    throw new BxlMutationError(
      'plan',
      'target-evaluation',
      statement,
      `Could not resolve mutation target ${argument.canonical}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  const locations = items.map((item) => {
    if (
      !item.path.every(
        (part) => typeof part === 'string' || typeof part === 'number',
      )
    ) {
      throw new BxlMutationError(
        'validate',
        'location-not-concrete',
        statement,
        'Mutation locations must resolve to concrete string/number paths.',
      );
    }
    const path = item.path as BxlMutationPath;
    return { path, value: valueAt(root, path), exists: hasAt(root, path) };
  });
  const unique = new Map(
    locations.map((location) => [pathKey(location.path), location]),
  );
  if (unique.size !== locations.length) {
    throw new BxlMutationError(
      'plan',
      'target-duplicate',
      statement,
      'A mutation selector resolved the same concrete path more than once.',
    );
  }
  const deduplicated = [...unique.values()];
  if (cardinality === 'one' && deduplicated.length === 0) {
    throw new BxlMutationError(
      'plan',
      'target-not-found',
      statement,
      'Mutation target matched no locations.',
    );
  }
  if (cardinality === 'one' && deduplicated.length > 1) {
    throw new BxlMutationError(
      'plan',
      'target-ambiguous',
      statement,
      `Mutation target must match exactly one location; received ${deduplicated.length}.`,
    );
  }
  if (cardinality === 'bulk' && deduplicated.length === 0) {
    throw new BxlMutationError(
      'plan',
      'bulk-target-empty',
      statement,
      'Explicit bulk target matched no locations.',
    );
  }
  return deduplicated;
}

function fieldByKey(
  schema: BxlMutationSchema,
  key: string,
): BxlMutationField | undefined {
  return schema.fields.find((field) => field.key === key);
}

function nestedSchema(field: BxlMutationField): BxlMutationSchema | undefined {
  if (field.item) return field.item;
  if (field.fields) return { fields: field.fields };
  return undefined;
}

function resolveField(
  path: BxlMutationPath,
  context: PlannerContext,
  statement: number,
): FieldResolution {
  const unsafeParts = new Set(['__proto__', 'prototype', 'constructor']);
  if (path.some((part) => typeof part === 'string' && unsafeParts.has(part))) {
    throw new BxlMutationError(
      'validate',
      'prototype-path-forbidden',
      statement,
      'Mutation paths cannot address JavaScript prototype keys.',
    );
  }
  if (path.some((part) => part === 'relationships' || part === 'included')) {
    throw new BxlMutationError(
      'plan',
      'storage-projection-forbidden',
      statement,
      'Mutation paths address the loaded Card model, not JSON:API storage projections.',
    );
  }
  if (path.length === 0) {
    const root = context.prepare.schema.rootField;
    const relationship =
      root?.fieldType === 'linksTo' || root?.fieldType === 'linksToMany'
        ? { type: root.fieldType, path: [] as BxlMutationPath }
        : undefined;
    if (root?.writable === false && root.writeBehavior !== 'skip') {
      throw new BxlMutationError(
        'validate',
        'field-read-only',
        statement,
        'The targeted Field is read-only.',
      );
    }
    return {
      fieldType: root?.fieldType,
      fieldPath: [],
      relationship,
      writeBehavior: root?.writeBehavior,
    };
  }

  let schema = context.prepare.schema;
  const rootField =
    context.prepare.targetKind === 'field'
      ? context.prepare.schema.rootField
      : undefined;
  let field: BxlMutationField | undefined = rootField
    ? {
        key: '',
        fieldType: rootField.fieldType,
        writable: rootField.writable,
        writeBehavior: rootField.writeBehavior,
        item: rootField.item,
        kind:
          rootField.fieldType === 'containsMany' ||
          rootField.fieldType === 'linksToMany'
            ? 'array'
            : rootField.item
              ? 'object'
              : 'scalar',
      }
    : undefined;
  let fieldPath: BxlMutationPath = [];
  let relationship: FieldResolution['relationship'] =
    rootField?.fieldType === 'linksTo' || rootField?.fieldType === 'linksToMany'
      ? { type: rootField.fieldType, path: [] }
      : undefined;
  let writeBehavior = rootField?.writeBehavior;
  if (rootField?.writable === false && writeBehavior !== 'skip') {
    throw new BxlMutationError(
      'validate',
      'field-read-only',
      statement,
      'The targeted Field is read-only.',
    );
  }
  for (let index = 0; index < path.length; index++) {
    const part = path[index]!;
    if (
      relationship &&
      typeof part === 'string' &&
      index > relationship.path.length
    ) {
      throw new BxlMutationError(
        'validate',
        'relationship-traversal',
        statement,
        'Mutation may change a relationship edge but cannot traverse it to mutate the related Card.',
      );
    }
    if (typeof part === 'number') {
      if (
        !field ||
        (field.fieldType !== 'containsMany' &&
          field.fieldType !== 'linksToMany' &&
          field.kind !== 'array')
      ) {
        throw new BxlMutationError(
          'validate',
          'path-schema-mismatch',
          statement,
          `Unexpected collection index at ${pathKey(path.slice(0, index + 1))}.`,
        );
      }
      const item = nestedSchema(field);
      if (item) schema = item;
      field = undefined;
      continue;
    }
    field = fieldByKey(schema, part);
    if (!field) {
      throw new BxlMutationError(
        'validate',
        'field-unknown',
        statement,
        `Mutation path references unknown schema field ${pathKey(path.slice(0, index + 1))}.`,
      );
    }
    fieldPath = path.slice(0, index + 1);
    writeBehavior = field.writeBehavior;
    if (field.writable === false && writeBehavior !== 'skip') {
      throw new BxlMutationError(
        'validate',
        'field-read-only',
        statement,
        `Field ${field.key} is read-only.`,
      );
    }
    if (field.fieldType === 'linksTo' || field.fieldType === 'linksToMany') {
      relationship = { type: field.fieldType, path: [...fieldPath] };
      const selectsRelationshipItem =
        field.fieldType === 'linksToMany' &&
        index === path.length - 2 &&
        typeof path[index + 1] === 'number';
      if (index < path.length - 1 && !selectsRelationshipItem) {
        throw new BxlMutationError(
          'validate',
          'relationship-traversal',
          statement,
          'Mutation may change a relationship edge but cannot traverse it to mutate the related Card.',
        );
      }
    }
    const next = nestedSchema(field);
    if (next) schema = next;
  }
  return {
    field,
    fieldType: field?.fieldType,
    fieldPath,
    relationship,
    writeBehavior,
  };
}

function validateWritableLocations(
  locations: ResolvedLocation[],
  argument: ParsedMutationArgument,
  context: PlannerContext,
  statement: number,
): FieldResolution[] {
  if (
    context.prepare.targetKind === 'card' &&
    locations.some((location) => location.path.length === 0)
  ) {
    throw new BxlMutationError(
      'plan',
      'card-root-write',
      statement,
      'Mutation profile cannot replace a complete Card root.',
    );
  }
  if (
    argument.explicitIndex &&
    context.plan.delivery === 'streaming' &&
    !context.plan.baseRevision
  ) {
    throw new BxlMutationError(
      'validate',
      'position-unstable',
      statement,
      'Numeric collection positions require a pinned base revision during streaming execution.',
    );
  }
  return locations.map((location) => {
    let field: FieldResolution;
    try {
      field = resolveField(location.path, context, statement);
    } catch (error) {
      // The overlay often has the more specific reason to refuse a path the
      // schema rejects — a write through a link, which the schema can only
      // report as traversal. Let it speak first.
      assertWritableOverlayPath(location.path, context, statement);
      throw error;
    }
    // The schema is the authority on the Fields a Card declares. Where it
    // already answers a write with an intentional no-op, an overlay does not
    // turn that into an error: the refusal is a backstop for paths the schema
    // has no opinion about, not a second opinion about the ones it does.
    if (field.writeBehavior !== 'skip') {
      assertWritableOverlayPath(location.path, context, statement);
    }
    return field;
  });
}

function loadedCard(
  id: string,
  context: PlannerContext,
  statement: number,
): BxlMutationJson {
  const card = context.plan.resolveCard?.(id) ?? context.plan.cards?.[id];
  if (card === undefined) {
    throw new BxlMutationError(
      'plan',
      'card-not-loaded',
      statement,
      `card(${JSON.stringify(id)}) is not present in the supplied loaded Card Store projection.`,
    );
  }
  return clone(card);
}

function applyCompound(
  operator: MutationAssignmentOperator,
  current: BxlMutationJson | undefined,
  right: BxlMutationJson,
): BxlMutationJson {
  if (operator === '//=')
    return (
      current !== null && current !== false && current !== undefined
        ? current
        : right
    ) as BxlMutationJson;
  return applyNormalBinaryOperator(
    operator.slice(0, -1) as NormalBinaryOperator,
    current,
    right,
  ) as BxlMutationJson;
}

function intentPaths(intent: BxlMutationIntent): BxlMutationPath[] {
  switch (intent.op) {
    case 'set':
    case 'delete':
    case 'copy':
      return [[...intent.path]];
    case 'insert':
      return [[...intent.collection, intent.index]];
    case 'move':
      return [[...intent.from], [...intent.toCollection, intent.toIndex]];
    case 'reorder':
      return [[...intent.collection]];
    case 'relate':
      return [[...intent.field]];
    case 'unrelate':
    case 'move-relation':
      return [[...intent.field]];
  }
}

function statementPlan(
  statement: ParsedMutationStatement,
  intents: BxlMutationIntent[],
): BxlMutationStatementPlan {
  const seen = new Set<string>();
  const paths = intents.flatMap(intentPaths).filter((path) => {
    const key = pathKey(path);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return {
    statement: statement.statement,
    source: statement.source,
    canonical: statement.canonical,
    affected: intents.reduce(
      (count, intent) =>
        count + (intent.op === 'reorder' ? intent.order.length : 1),
      0,
    ),
    intents,
    paths,
  };
}

function planAssignment(
  statement: Extract<ParsedMutationStatement, { kind: 'assignment' }>,
  root: BxlMutationJson,
  context: PlannerContext,
): { root: BxlMutationJson; plan: BxlMutationStatementPlan } {
  const locations = resolveLocations(
    statement.location,
    root,
    context,
    statement.statement,
  );
  const fields = validateWritableLocations(
    locations,
    statement.location,
    context,
    statement.statement,
  );
  const intents: BxlMutationIntent[] = [];
  let output = root;

  for (let index = 0; index < locations.length; index++) {
    const location = locations[index]!;
    const field = fields[index]!;
    if (field.writeBehavior === 'skip') continue;
    let next: BxlMutationJson | CardReference;
    if (statement.operator === '=') {
      next = evaluateSingleJson(
        statement.value,
        readView(output, context),
        context,
        statement.statement,
      );
    } else if (statement.operator === '|=') {
      next = evaluateSingleJson(
        statement.value,
        (location.value ?? null) as BxlMutationJson,
        context,
        statement.statement,
        { prefix: location.path },
      );
    } else {
      const right = evaluateSingleJson(
        statement.value,
        readView(output, context),
        context,
        statement.statement,
      );
      if (isCardReference(right)) {
        throw new BxlMutationError(
          'validate',
          'relationship-arithmetic',
          statement.statement,
          'Relationship references cannot be used with compound assignment.',
        );
      }
      next = applyCompound(
        statement.operator,
        location.value,
        right as BxlMutationJson,
      );
    }

    if (field.relationship) {
      if (!isCardReference(next)) {
        throw new BxlMutationError(
          'validate',
          'relationship-value-required',
          statement.statement,
          'Relationship assignment requires card("id"); loaded Card JSON is not accepted as a value.',
        );
      }
      if (field.relationship.type === 'linksToMany') {
        throw new BxlMutationError(
          'validate',
          'collection-replacement-forbidden',
          statement.statement,
          'Use relationship collection operations instead of replacing linksToMany wholesale.',
        );
      }
      intents.push({
        op: 'relate',
        field: field.relationship.path,
        cardId: next.id,
      });
      output = setAt(
        output,
        field.relationship.path,
        loadedCard(next.id, context, statement.statement),
      );
      continue;
    }
    if (isCardReference(next)) {
      throw new BxlMutationError(
        'validate',
        'card-reference-destination',
        statement.statement,
        'card(id) may only be assigned to a relationship Field.',
      );
    }
    const intent: BxlMutationIntent = {
      op: 'set',
      path: [...location.path],
      ...(location.exists ? { before: clone(location.value!) } : {}),
      after: clone(next as BxlMutationJson),
    };
    intents.push(intent);
    output = setAt(output, location.path, next as BxlMutationJson);
  }
  return { root: output, plan: statementPlan(statement, intents) };
}

function exactLocation(
  argument: ParsedMutationArgument,
  root: BxlMutationJson,
  context: PlannerContext,
  statement: number,
): { location: ResolvedLocation; field: FieldResolution } {
  const locations = resolveLocations(argument, root, context, statement, 'one');
  const fields = validateWritableLocations(
    locations,
    argument,
    context,
    statement,
  );
  return { location: locations[0]!, field: fields[0]! };
}

function jsonValue(
  argument: ParsedMutationArgument,
  root: BxlMutationJson,
  context: PlannerContext,
  statement: number,
  reads: ReadContext = {},
): BxlMutationJson | CardReference {
  return evaluateSingleJson(
    argument,
    readView(root, context),
    context,
    statement,
    reads,
  );
}

function planCall(
  statement: Extract<ParsedMutationStatement, { kind: 'call' }>,
  root: BxlMutationJson,
  context: PlannerContext,
): { root: BxlMutationJson; plan: BxlMutationStatementPlan } {
  const intents: BxlMutationIntent[] = [];
  let output = root;
  const number = statement.statement;

  switch (statement.name) {
    case 'assert': {
      const bestEffort =
        statement.args.length === 3 &&
        readAssertSnapshotOption(statement.args[2]!, number);
      const reads = recordReads(
        statement.args[0]!,
        readView(root, context),
        context,
        number,
        { policy: 'best-effort' },
      );
      if (reads.overlay && !bestEffort) {
        const overlay = reads.events.find((event) => event.tier !== 'source')!;
        throw new BxlMutationError(
          'validate',
          'assert-snapshot-required',
          number,
          `assert reads the ${overlay.tier} value at ${overlay.path}, which can lag the stored document. Mark the assert best-effort with { snapshot: true }.`,
          { details: { path: overlay.path, tier: overlay.tier } },
        );
      }
      // A best-effort assert fails with its own message rather than raising
      // `snapshot-unavailable`, so the author's wording reaches the caller.
      const condition = reads.unavailable
        ? []
        : evaluateItems(
            statement.args[0]!.ast,
            [createItem(readView(root, context))],
            context,
          );
      if (
        reads.unavailable ||
        condition.length !== 1 ||
        !isTrue(condition[0]!.value)
      ) {
        // The whole statement is best-effort, message included: an author who
        // marked the assert tolerant of stale values gets their wording back
        // even when the message itself reads an unavailable path.
        const message = jsonValue(statement.args[1]!, root, context, number, {
          policy: bestEffort ? 'best-effort' : 'strict',
        });
        throw new BxlMutationError(
          'plan',
          'assertion-failed',
          number,
          typeof message === 'string' ? message : 'Mutation assertion failed.',
          reads.unavailable
            ? {
                details: {
                  path: reads.unavailable.path,
                  tier: reads.unavailable.tier,
                  reason: reads.unavailable.reason,
                },
              }
            : {},
        );
      }
      break;
    }
    case 'replace': {
      const { location, field } = exactLocation(
        statement.args[0]!,
        root,
        context,
        number,
      );
      if (field.writeBehavior === 'skip') break;
      if (!location.exists) {
        throw new BxlMutationError(
          'plan',
          'replace-target-missing',
          number,
          'replace requires an existing target.',
        );
      }
      if (field.relationship) {
        throw new BxlMutationError(
          'validate',
          'replace-relationship-forbidden',
          number,
          'Use relationship operations for relationship Fields.',
        );
      }
      const value = jsonValue(statement.args[1]!, root, context, number);
      if (isCardReference(value)) {
        throw new BxlMutationError(
          'validate',
          'card-reference-destination',
          number,
          'card(id) may only target relationships.',
        );
      }
      intents.push({
        op: 'set',
        path: location.path,
        before: clone(location.value!),
        after: clone(value as BxlMutationJson),
      });
      output = setAt(output, location.path, value as BxlMutationJson);
      break;
    }
    case 'copy_value_to': {
      const source = exactLocation(statement.args[0]!, root, context, number);
      const destination = exactLocation(
        statement.args[1]!,
        root,
        context,
        number,
      );
      if (destination.field.writeBehavior === 'skip') break;
      if (!source.location.exists)
        throw new BxlMutationError(
          'plan',
          'copy-source-missing',
          number,
          'Copy source does not exist.',
        );
      if (source.field.relationship || destination.field.relationship) {
        throw new BxlMutationError(
          'validate',
          'copy-relationship-forbidden',
          number,
          'Relationship edges must be changed with relationship operations.',
        );
      }
      intents.push({
        op: 'copy',
        from: source.location.path,
        path: destination.location.path,
      });
      output = setAt(output, destination.location.path, source.location.value!);
      break;
    }
    case 'del': {
      const locations = resolveLocations(
        statement.args[0]!,
        root,
        context,
        number,
      );
      const fields = validateWritableLocations(
        locations,
        statement.args[0]!,
        context,
        number,
      );
      const ordered = [...locations.keys()].sort((a, b) => {
        const ap = locations[a]!.path;
        const bp = locations[b]!.path;
        const sameParent = equalJson(ap.slice(0, -1), bp.slice(0, -1));
        if (
          sameParent &&
          typeof ap.at(-1) === 'number' &&
          typeof bp.at(-1) === 'number'
        ) {
          return (bp.at(-1) as number) - (ap.at(-1) as number);
        }
        return b - a;
      });
      for (const index of ordered) {
        const location = locations[index]!;
        const field = fields[index]!;
        if (field.writeBehavior === 'skip') continue;
        if (!location.exists)
          throw new BxlMutationError(
            'plan',
            'delete-target-missing',
            number,
            'Delete target does not exist.',
          );
        if (field.relationship) {
          const id = objectId(location.value);
          if (!id)
            throw new BxlMutationError(
              'plan',
              'relationship-card-id-missing',
              number,
              'Loaded related Card has no string id.',
            );
          intents.push({
            op: 'unrelate',
            field: field.relationship.path,
            cardId: id,
          });
        } else {
          intents.push({
            op: 'delete',
            path: location.path,
            before: clone(location.value!),
          });
        }
        output = deleteAt(output, location.path);
      }
      break;
    }
    case 'prepend':
    case 'append':
    case 'insert_at': {
      const target = exactLocation(statement.args[0]!, root, context, number);
      if (target.field.writeBehavior === 'skip') break;
      const collection = collectionAt(output, target.location.path);
      let index = statement.name === 'prepend' ? 0 : collection.length;
      let valueArg = statement.args[1]!;
      if (statement.name === 'insert_at') {
        if (!context.plan.baseRevision) {
          throw new BxlMutationError(
            'validate',
            'position-requires-revision',
            number,
            'insert_at requires a pinned base revision.',
          );
        }
        const requested = jsonValue(statement.args[1]!, root, context, number);
        if (
          typeof requested !== 'number' ||
          !Number.isInteger(requested) ||
          requested < 0 ||
          requested > collection.length
        ) {
          throw new BxlMutationError(
            'plan',
            'insert-index-invalid',
            number,
            'insert_at index must be an in-range non-negative integer.',
          );
        }
        index = requested;
        valueArg = statement.args[2]!;
      }
      const value = jsonValue(valueArg, root, context, number);
      if (target.field.relationship) {
        if (!isCardReference(value)) {
          throw new BxlMutationError(
            'validate',
            'relationship-value-required',
            number,
            'Relationship insertion requires card("id").',
          );
        }
        intents.push({
          op: 'relate',
          field: target.field.relationship.path,
          cardId: value.id,
          index,
        });
        collection.splice(index, 0, loadedCard(value.id, context, number));
      } else {
        if (isCardReference(value)) {
          throw new BxlMutationError(
            'validate',
            'card-reference-destination',
            number,
            'card(id) may only target relationships.',
          );
        }
        intents.push({
          op: 'insert',
          collection: target.location.path,
          index,
          value: clone(value as BxlMutationJson),
        });
        collection.splice(index, 0, clone(value as BxlMutationJson));
      }
      break;
    }
    case 'insert_item_before':
    case 'insert_item_after': {
      const anchor = exactLocation(statement.args[1]!, root, context, number);
      if (anchor.field.writeBehavior === 'skip') break;
      const anchorIndex = anchor.location.path.at(-1);
      if (typeof anchorIndex !== 'number')
        throw new BxlMutationError(
          'plan',
          'anchor-not-item',
          number,
          'Insertion anchor must be a collection item.',
        );
      const collectionPath = anchor.location.path.slice(0, -1);
      const collection = collectionAt(output, collectionPath);
      const index =
        anchorIndex + (statement.name === 'insert_item_after' ? 1 : 0);
      const value = jsonValue(statement.args[0]!, root, context, number);
      if (anchor.field.relationship) {
        if (!isCardReference(value)) {
          throw new BxlMutationError(
            'validate',
            'relationship-value-required',
            number,
            'Relationship insertion requires card("id").',
          );
        }
        intents.push({
          op: 'relate',
          field: anchor.field.relationship.path,
          cardId: value.id,
          index,
        });
        collection.splice(index, 0, loadedCard(value.id, context, number));
      } else {
        if (isCardReference(value)) {
          throw new BxlMutationError(
            'validate',
            'card-reference-destination',
            number,
            'card(id) may only target relationships.',
          );
        }
        intents.push({
          op: 'insert',
          collection: collectionPath,
          index,
          value: clone(value as BxlMutationJson),
        });
        collection.splice(index, 0, clone(value as BxlMutationJson));
      }
      break;
    }
    case 'move_item_before':
    case 'move_item_after':
    case 'move_item_to_start':
    case 'move_item_to_end': {
      const item = exactLocation(statement.args[0]!, root, context, number);
      if (item.field.writeBehavior === 'skip') break;
      const sourceIndex = item.location.path.at(-1);
      if (typeof sourceIndex !== 'number')
        throw new BxlMutationError(
          'plan',
          'move-source-not-item',
          number,
          'Move source must be a collection item.',
        );
      const sourceCollectionPath = item.location.path.slice(0, -1);
      let targetCollectionPath: BxlMutationPath;
      let targetIndex: number;
      if (
        statement.name === 'move_item_before' ||
        statement.name === 'move_item_after'
      ) {
        const anchor = exactLocation(statement.args[1]!, root, context, number);
        if (equalJson(anchor.location.path, item.location.path)) {
          throw new BxlMutationError(
            'plan',
            'source-is-anchor',
            number,
            'Move source and anchor must be different items.',
          );
        }
        const anchorIndex = anchor.location.path.at(-1);
        if (typeof anchorIndex !== 'number')
          throw new BxlMutationError(
            'plan',
            'anchor-not-item',
            number,
            'Move anchor must be a collection item.',
          );
        targetCollectionPath = anchor.location.path.slice(0, -1);
        if (!equalJson(sourceCollectionPath, targetCollectionPath)) {
          throw new BxlMutationError(
            'validate',
            'cross-collection-move',
            number,
            'Version 1 moves require source and anchor in the same collection.',
          );
        }
        const adjustedAnchor =
          anchorIndex - (sourceIndex < anchorIndex ? 1 : 0);
        targetIndex =
          adjustedAnchor + (statement.name === 'move_item_after' ? 1 : 0);
      } else {
        const collection = exactLocation(
          statement.args[1]!,
          root,
          context,
          number,
        );
        targetCollectionPath = collection.location.path;
        if (!equalJson(sourceCollectionPath, targetCollectionPath)) {
          throw new BxlMutationError(
            'validate',
            'cross-collection-move',
            number,
            'Version 1 moves require the same source and target collection.',
          );
        }
        targetIndex =
          statement.name === 'move_item_to_start'
            ? 0
            : collectionAt(output, targetCollectionPath).length - 1;
      }
      const sourceCollection = collectionAt(output, sourceCollectionPath);
      const [moved] = sourceCollection.splice(sourceIndex, 1);
      if (moved === undefined)
        throw new BxlMutationError(
          'plan',
          'move-source-missing',
          number,
          'Move source no longer exists.',
        );
      sourceCollection.splice(targetIndex, 0, moved);
      if (item.field.relationship) {
        const id = objectId(moved);
        if (!id)
          throw new BxlMutationError(
            'plan',
            'relationship-card-id-missing',
            number,
            'Loaded related Card has no string id.',
          );
        intents.push({
          op: 'move-relation',
          field: item.field.relationship.path,
          cardId: id,
          toIndex: targetIndex,
        });
      } else {
        intents.push({
          op: 'move',
          from: item.location.path,
          toCollection: targetCollectionPath,
          toIndex: targetIndex,
        });
      }
      break;
    }
    case 'reorder_by': {
      const target = exactLocation(statement.args[0]!, root, context, number);
      if (target.field.writeBehavior === 'skip') break;
      if (target.field.relationship) {
        throw new BxlMutationError(
          'validate',
          'relationship-reorder-operation',
          number,
          'Use relationship move operations to reorder linksToMany.',
        );
      }
      const collection = collectionAt(output, target.location.path);
      const keyPathItems = evaluateItems(
        statement.args[1]!.ast,
        [createItem(collection[0] ?? null)],
        context,
      );
      if (
        keyPathItems.length !== 1 ||
        !keyPathItems[0]!.path.every(
          (part) => typeof part === 'string' || typeof part === 'number',
        )
      ) {
        throw new BxlMutationError(
          'plan',
          'reorder-key-invalid',
          number,
          'reorder_by key must resolve to one item-relative path.',
        );
      }
      const keyPath = keyPathItems[0]!.path as BxlMutationPath;
      const order = jsonValue(statement.args[2]!, root, context, number);
      if (
        !Array.isArray(order) ||
        order.some(
          (value) =>
            value !== null &&
            !['string', 'number', 'boolean'].includes(typeof value),
        )
      ) {
        throw new BxlMutationError(
          'plan',
          'order-invalid',
          number,
          'reorder_by order must be an array of scalar keys.',
        );
      }
      const currentKeys = collection.map((item) => valueAt(item, keyPath));
      const uniqueCurrent = new Set(
        currentKeys.map((value) => JSON.stringify(value)),
      );
      const uniqueOrder = new Set(order.map((value) => JSON.stringify(value)));
      if (
        currentKeys.length !== order.length ||
        uniqueCurrent.size !== currentKeys.length ||
        uniqueOrder.size !== order.length ||
        [...uniqueCurrent].some((key) => !uniqueOrder.has(key))
      ) {
        throw new BxlMutationError(
          'plan',
          'order-not-permutation',
          number,
          'reorder_by order must be an exact permutation of unique current keys.',
        );
      }
      const byKey = new Map(
        collection.map((value) => [
          JSON.stringify(valueAt(value, keyPath)),
          value,
        ]),
      );
      const reordered = order.map((key) => byKey.get(JSON.stringify(key))!);
      collection.splice(0, collection.length, ...reordered);
      intents.push({
        op: 'reorder',
        collection: target.location.path,
        key: keyPath,
        order: order as Array<null | boolean | number | string>,
      });
      break;
    }
  }
  return { root: output, plan: statementPlan(statement, intents) };
}

function projection(
  root: BxlMutationJson,
  paths: BxlMutationPath[],
): BxlMutationJson {
  if (paths.some((path) => path.length === 0)) return clone(root);
  let result: BxlMutationJson = {};
  for (const path of paths) {
    const value = valueAt(root, path);
    if (value !== undefined) result = setAt(result, path, value);
  }
  return result;
}

function returningProjection(
  requested: BxlMutationPlanOptions['returning'],
  before: BxlMutationJson,
  output: BxlMutationJson,
  intents: BxlMutationIntent[],
  affected: number,
  paths: BxlMutationPath[],
): BxlMutationReturning {
  const returning: BxlMutationReturning = {};
  const fields = requested ?? ['affected', 'paths', 'changes'];
  if (fields.includes('old')) returning.old = projection(before, paths);
  if (fields.includes('new')) returning.new = projection(output, paths);
  if (fields.includes('changes')) returning.changes = clone(intents);
  if (fields.includes('affected')) returning.affected = affected;
  if (fields.includes('paths')) returning.paths = clone(paths);
  return returning;
}

export function prepareBxlMutation(
  source: string,
  options: BxlMutationPrepareOptions,
): PreparedBxlMutation {
  const syntax = options.syntax ?? 'readable';
  const preparedOptions = { ...options, syntax };
  const parsed = parseBxlMutationProgram(source, preparedOptions);
  const registry = resolveBuiltinRegistry(
    options.libraries ?? DEFAULT_BUILTIN_LIBRARIES,
  );

  return Object.freeze({
    language: 'bxl-mutation/1' as const,
    source,
    canonicalSource: parsed.canonicalSource,
    syntax,
    warnings: Object.freeze([
      ...parsed.warnings,
    ]) as unknown as typeof parsed.warnings,
    statementCount: parsed.statements.length,
    plan(
      snapshot: BxlMutationJson,
      planOptions: BxlMutationPlanOptions,
    ): BxlMutationPlan {
      if (!planOptions.programId) {
        throw new BxlMutationError(
          'plan',
          'program-id-required',
          1,
          'Mutation planning requires a stable programId.',
        );
      }
      if (
        planOptions.baseRevision !== undefined &&
        planOptions.currentRevision !== undefined &&
        planOptions.baseRevision !== planOptions.currentRevision
      ) {
        throw new BxlMutationError(
          'commit',
          'revision-conflict',
          1,
          'The loaded Card revision does not match baseRevision.',
        );
      }
      const context: PlannerContext = {
        prepare: preparedOptions,
        plan: {
          delivery: 'complete',
          transaction: 'atomic',
          ...planOptions,
        },
        registry,
        ...(planOptions.overlays ? { source: planOptions.overlays } : {}),
        overlays: EMPTY_OVERLAY_INDEX,
        ...(planOptions.onRead ? { onRead: planOptions.onRead } : {}),
      };
      const before = clone(snapshot);
      let working = clone(snapshot);
      const statementPlans: BxlMutationStatementPlan[] = [];

      for (const statement of parsed.statements) {
        const draft = clone(working);
        // Rebuild the index against the document as this statement finds it,
        // so what an overlay answers for is described in the positions the
        // statement will address rather than the ones it started life in.
        context.overlays = mergeBxlMutationOverlays(
          draft,
          planOptions.overlays,
        ).index;
        let result: { root: BxlMutationJson; plan: BxlMutationStatementPlan };
        try {
          result =
            statement.kind === 'assignment'
              ? planAssignment(statement, draft, context)
              : planCall(statement, draft, context);
        } catch (error) {
          if (error instanceof BxlMutationError) throw error;
          throw new BxlMutationError(
            'plan',
            'statement-failed',
            statement.statement,
            `Mutation statement failed: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error },
          );
        }
        if (context.plan.authorize && result.plan.intents.length > 0) {
          try {
            const allowed = context.plan.authorize(result.plan);
            if (allowed === false)
              throw new Error('Authorization hook returned false.');
          } catch (error) {
            throw new BxlMutationError(
              'authorize',
              'authorization-denied',
              statement.statement,
              `Mutation write set was denied: ${error instanceof Error ? error.message : String(error)}`,
              { cause: error },
            );
          }
        }
        working = result.root;
        statementPlans.push(result.plan);
      }

      const intents = statementPlans.flatMap((statement) => statement.intents);
      const affected = statementPlans.reduce(
        (sum, statement) => sum + statement.affected,
        0,
      );
      const pathMap = new Map(
        statementPlans
          .flatMap((statement) => statement.paths)
          .map((path) => [pathKey(path), path]),
      );
      const paths = [...pathMap.values()];
      const output = working;
      return {
        language: 'bxl-mutation/1',
        programId: planOptions.programId,
        target: {
          kind: options.targetKind,
          ...(planOptions.targetId ? { id: planOptions.targetId } : {}),
          ...(planOptions.targetPath
            ? { path: [...planOptions.targetPath] }
            : {}),
        },
        source,
        canonicalSource: parsed.canonicalSource,
        warnings: [...parsed.warnings],
        before,
        output,
        statements: statementPlans,
        intents,
        affected,
        paths,
        returning: returningProjection(
          planOptions.returning,
          before,
          output,
          intents,
          affected,
          paths,
        ),
      };
    },
  });
}

export function planBxlMutation(
  source: string,
  snapshot: BxlMutationJson,
  prepareOptions: BxlMutationPrepareOptions,
  planOptions: BxlMutationPlanOptions,
): BxlMutationPlan {
  return prepareBxlMutation(source, prepareOptions).plan(snapshot, planOptions);
}

export function isBxlMutationError(error: unknown): error is BxlMutationError {
  return error instanceof BxlMutationError;
}

/** Parse a solidified value expression for host adapters that inspect plans. */
export function parseBxlMutationValueExpression(source: string): ExpressionAst {
  const parsed = parseNativeJq(source, { readableSyntax: false });
  if (!parsed.ast.expr) throw new Error('Mutation value expression is empty.');
  return parsed.ast.expr;
}

/** Canonicalize a mutation value AST for diagnostics and previews. */
export function printBxlMutationValueExpression(ast: ExpressionAst): string {
  return printMutationAst(ast);
}
