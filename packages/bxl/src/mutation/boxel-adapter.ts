import type { BuiltinLibraryName } from '../bxl/registry/index.js';
import type { NativeRuntimeLimits } from '../jqtools/evaluate/runtimeState.js';
import { prepareBxlMutation } from './planner.js';
import {
  BxlMutationError,
  type BxlMutationField,
  type BxlMutationFieldType,
  type BxlMutationIntent,
  type BxlMutationJson,
  type BxlMutationPath,
  type BxlMutationPlan,
  type BxlMutationPlanOptions,
  type BxlMutationSchema,
} from './types.js';

const GET_FIELDS_KEY = '__cardstackGetFields' as const;
const GET_STORE_KEY = '__cardstackGetStore' as const;

export interface BxlBoxelField {
  fieldType?: BxlMutationFieldType;
  card?: unknown;
  computeVia?: (...args: unknown[]) => unknown;
  queryDefinition?: unknown;
}

export type BxlBoxelGetFields = (
  instance: unknown,
  options?: { includeComputeds?: boolean },
) => Record<string, BxlBoxelField>;

export interface BxlBoxelCardStore {
  getCard(id: string): unknown;
}

export type BxlBoxelGetStore = (instance: unknown) => BxlBoxelCardStore | undefined;

export interface BxlBoxelAdapterOptions {
  /** Normally supplied by the Realm bundle's Card API bridge. */
  getFields?: BxlBoxelGetFields;
  /** Normally supplied by the Realm bundle's Card API bridge. */
  getStore?: BxlBoxelGetStore;
}

export interface BxlUpdateViaOptions extends BxlBoxelAdapterOptions {
  /** Override only for non-Boxel hosts; Realm cards derive this from FieldDef metadata. */
  schema?: BxlMutationSchema;
  syntax?: 'readable' | 'solidified';
  libraries?: BuiltinLibraryName[];
  runtimeLimits?: NativeRuntimeLimits;
}

export interface BxlUpdateViaExecutionOptions
  extends Omit<BxlMutationPlanOptions, 'programId' | 'targetId' | 'cards' | 'resolveCard'> {
  /** Tool callers should provide their stable tool-call ID. Local card code may omit it. */
  programId?: string;
  targetId?: string;
  /** Override the Card's own store, primarily for tests and non-Realm hosts. */
  cardStore?: BxlBoxelCardStore;
  /** Resolve a loaded Card model before falling back to CardStore#getCard. */
  resolveCard?: (id: string) => unknown;
}

export interface BxlUpdateViaMetadata {
  source: string;
  syntax: 'readable' | 'solidified';
  targetKind: 'card';
}

export interface BxlUpdateViaFunction {
  (this: object, options?: BxlUpdateViaExecutionOptions): BxlMutationPlan;
  readonly bxl: BxlUpdateViaMetadata;
}

interface AdapterRuntime {
  getFields: BxlBoxelGetFields;
  getStore?: BxlBoxelGetStore;
}

interface ModelProjection {
  snapshot: BxlMutationJson;
  relationshipModels: Map<string, object>;
}

type Undo = () => void;

let localProgramSequence = 0;

function mutationError(
  phase: 'validate' | 'commit',
  code: string,
  message: string,
  cause?: unknown,
): BxlMutationError {
  return new BxlMutationError(
    phase,
    code,
    1,
    message,
    cause === undefined ? {} : { cause },
  );
}

function globalFunction<T>(key: string): T | undefined {
  const value = (globalThis as unknown as Record<string, unknown>)[key];
  return typeof value === 'function' ? (value as T) : undefined;
}

function adapterRuntime(options: BxlBoxelAdapterOptions): AdapterRuntime {
  const getFields =
    options.getFields ?? globalFunction<BxlBoxelGetFields>(GET_FIELDS_KEY);
  if (!getFields) {
    throw mutationError(
      'validate',
      'boxel-fields-unavailable',
      'updateViaBxl requires Boxel getFields metadata. Use the Realm bundle or pass getFields for a non-Realm host.',
    );
  }
  return {
    getFields,
    getStore: options.getStore ?? globalFunction<BxlBoxelGetStore>(GET_STORE_KEY),
  };
}

function safeFields(runtime: AdapterRuntime, value: unknown): Record<string, BxlBoxelField> {
  if ((typeof value !== 'object' || value === null) && typeof value !== 'function') {
    return {};
  }
  try {
    return runtime.getFields(value, { includeComputeds: false }) ?? {};
  } catch {
    return {};
  }
}

function shapeInstance(shape: unknown): object | undefined {
  if (typeof shape !== 'function') return undefined;
  try {
    return new (shape as new () => object)();
  } catch {
    return undefined;
  }
}

function shapeFields(
  runtime: AdapterRuntime,
  shape: unknown,
  sample?: unknown,
): Record<string, BxlBoxelField> {
  const sampleFields = safeFields(runtime, sample);
  if (Object.keys(sampleFields).length > 0) return sampleFields;
  const classFields = safeFields(runtime, shape);
  if (Object.keys(classFields).length > 0) return classFields;
  return safeFields(runtime, shapeInstance(shape));
}

function displayName(shape: unknown): string | undefined {
  if (typeof shape !== 'function') return undefined;
  const value = (shape as { displayName?: unknown }).displayName;
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function normalizedReadableName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function structuredShape(
  runtime: AdapterRuntime,
  field: BxlBoxelField,
  sample?: unknown,
): boolean {
  return Object.keys(shapeFields(runtime, field.card, sample)).length > 0;
}

function fieldLabel(
  runtime: AdapterRuntime,
  field: BxlBoxelField,
  sample?: unknown,
  ambiguousDisplayNames: ReadonlySet<string> = new Set(),
): string | undefined {
  if (
    field.fieldType === 'linksTo' ||
    field.fieldType === 'linksToMany' ||
    structuredShape(runtime, field, sample)
  ) {
    const name = displayName(field.card);
    return name && !ambiguousDisplayNames.has(name) ? name : undefined;
  }
  // The readable compiler already resolves Quantity/SKU against quantity/sku.
  // Avoid calling a scalar FieldDef "Number" or "String" in generated guides.
  return undefined;
}

function schemaForShape(
  runtime: AdapterRuntime,
  shape: unknown,
  sample: unknown,
  seen: Set<unknown>,
): BxlMutationSchema {
  const identity = sample && typeof sample === 'object' ? sample : shape;
  if (identity && seen.has(identity)) return { fields: [] };
  if (identity) seen.add(identity);
  const fields = shapeFields(runtime, shape, sample);
  const result: BxlMutationField[] = [];
  const displayNameCounts = new Map<string, number>();
  for (const [key, field] of Object.entries(fields)) {
    if (field.computeVia) continue;
    const value = sample && typeof sample === 'object'
      ? (sample as Record<string, unknown>)[key]
      : undefined;
    if (
      field.fieldType === 'linksTo' ||
      field.fieldType === 'linksToMany' ||
      structuredShape(runtime, field, Array.isArray(value) ? value[0] : value)
    ) {
      const name = displayName(field.card);
      if (name) displayNameCounts.set(name, (displayNameCounts.get(name) ?? 0) + 1);
    }
  }
  const ambiguousDisplayNames = new Set(
    [...displayNameCounts].filter(([, count]) => count > 1).map(([name]) => name),
  );

  for (const [key, field] of Object.entries(fields)) {
    if (field.computeVia) continue;
    const fieldType = field.fieldType;
    if (!fieldType) continue;
    const value = sample && typeof sample === 'object'
      ? (sample as Record<string, unknown>)[key]
      : undefined;
    const writable = key !== 'id' && !field.queryDefinition;
    const label = fieldLabel(runtime, field, value, ambiguousDisplayNames);
    const entry: BxlMutationField = {
      key,
      ...(label ? {
        label,
        displayName: label,
      } : {}),
      fieldType,
      writable,
    };

    if (fieldType === 'linksTo' || fieldType === 'linksToMany') {
      const idSchema: BxlMutationSchema = {
        fields: [{ key: 'id', label: 'ID', displayName: 'ID', writable: false }],
      };
      entry.kind = fieldType === 'linksToMany' ? 'array' : 'object';
      entry.item = idSchema;
      entry.fields = idSchema.fields;
    } else if (structuredShape(runtime, field, Array.isArray(value) ? value[0] : value)) {
      const child = schemaForShape(
        runtime,
        field.card,
        Array.isArray(value) ? value[0] : value,
        new Set(seen),
      );
      if (fieldType === 'containsMany') {
        entry.kind = 'array';
        entry.item = child;
      } else {
        entry.kind = 'object';
        entry.fields = child.fields;
      }
    } else {
      entry.kind = fieldType === 'containsMany' ? 'array' : 'scalar';
    }
    result.push(entry);
  }

  // CardDef inherits user-facing relationship fields through CardInfoField
  // (notably Theme at cardInfo.theme). Promote those relationship labels into
  // the Card's readable root while retaining their concrete storage path.
  // The compiler emits `.cardInfo.theme`; snapshots and plans never contain a
  // synthetic alias property.
  const cardInfo = result.find((field) => field.key === 'cardInfo');
  const occupied = new Set(
    result.flatMap((field) => [field.key, field.label, field.displayName])
      .filter((name): name is string => Boolean(name))
      .map(normalizedReadableName),
  );
  for (const child of cardInfo?.fields ?? []) {
    if (child.fieldType !== 'linksTo' && child.fieldType !== 'linksToMany') continue;
    const names = [child.key, child.label, child.displayName]
      .filter((name): name is string => Boolean(name));
    if (names.some((name) => occupied.has(normalizedReadableName(name)))) continue;
    result.push({
      ...child,
      path: ['cardInfo', child.key],
    });
    for (const name of names) occupied.add(normalizedReadableName(name));
  }

  return { fields: result };
}

/** Derive Mutation BXL schema directly from CardDef/FieldDef metadata. */
export function mutationSchemaForCard(
  card: object,
  options: BxlBoxelAdapterOptions = {},
): BxlMutationSchema {
  const runtime = adapterRuntime(options);
  return schemaForShape(runtime, card.constructor, card, new Set());
}

function jsonScalar(value: unknown, seen: Set<object>): BxlMutationJson {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return value;
  }
  if (value === undefined) return null;
  if (typeof value !== 'object') {
    throw mutationError(
      'validate',
      'boxel-value-not-json',
      `Card field value ${String(value)} is not JSON-shaped.`,
    );
  }
  if (seen.has(value)) {
    throw mutationError('validate', 'boxel-value-cycle', 'Card field values must not contain cycles.');
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => jsonScalar(item, seen));
    if (value instanceof Date) return value.toISOString();
    const toJSON = (value as { toJSON?: unknown }).toJSON;
    if (typeof toJSON === 'function') {
      return jsonScalar(toJSON.call(value), seen);
    }
    const output: Record<string, BxlMutationJson> = {};
    for (const [key, child] of Object.entries(value)) {
      if (child !== undefined) output[key] = jsonScalar(child, seen);
    }
    return output;
  } finally {
    seen.delete(value);
  }
}

function cardId(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const id = (value as { id?: unknown }).id;
  return typeof id === 'string' ? id : undefined;
}

function projectModel(
  model: object,
  runtime: AdapterRuntime,
  relationshipModels: Map<string, object>,
  ancestors: Set<object>,
): BxlMutationJson {
  if (ancestors.has(model)) {
    throw mutationError('validate', 'boxel-value-cycle', 'Contained Card values must not contain cycles.');
  }
  ancestors.add(model);
  const output: Record<string, BxlMutationJson> = {};
  try {
    for (const [key, field] of Object.entries(safeFields(runtime, model))) {
      if (field.computeVia) continue;
      const value = (model as Record<string, unknown>)[key];
      switch (field.fieldType) {
        case 'linksTo': {
          if (value == null) {
            output[key] = null;
            break;
          }
          const id = cardId(value);
          if (!id) {
            throw mutationError(
              'validate',
              'relationship-card-id-missing',
              `Loaded relationship ${key} has no string Card ID.`,
            );
          }
          relationshipModels.set(id, value as object);
          output[key] = { id };
          break;
        }
        case 'linksToMany': {
          if (value == null) {
            output[key] = [];
            break;
          }
          if (!Array.isArray(value)) {
            throw mutationError('validate', 'relationship-not-array', `Relationship ${key} is not an array.`);
          }
          output[key] = value.map((related) => {
            const id = cardId(related);
            if (!id) {
              throw mutationError(
                'validate',
                'relationship-card-id-missing',
                `Loaded relationship ${key} contains a Card without a string ID.`,
              );
            }
            relationshipModels.set(id, related as object);
            return { id };
          });
          break;
        }
        case 'contains': {
          output[key] = value && typeof value === 'object' && structuredShape(runtime, field, value)
            ? projectModel(value, runtime, relationshipModels, ancestors)
            : jsonScalar(value, new Set());
          break;
        }
        case 'containsMany': {
          if (value == null) {
            output[key] = [];
            break;
          }
          if (!Array.isArray(value)) {
            throw mutationError('validate', 'contained-value-not-array', `Contained field ${key} is not an array.`);
          }
          output[key] = value.map((item) =>
            item && typeof item === 'object' && structuredShape(runtime, field, item)
              ? projectModel(item, runtime, relationshipModels, ancestors)
              : jsonScalar(item, new Set()),
          );
          break;
        }
      }
    }
    return output;
  } finally {
    ancestors.delete(model);
  }
}

/** Project a live Card model, keeping relationships as loaded `{ id }` Cards. */
export function snapshotBxlCard(
  card: object,
  options: BxlBoxelAdapterOptions = {},
): BxlMutationJson {
  const runtime = adapterRuntime(options);
  return projectModel(card, runtime, new Map(), new Set());
}

function projectionForCard(model: object, runtime: AdapterRuntime): ModelProjection {
  const relationshipModels = new Map<string, object>();
  return {
    snapshot: projectModel(model, runtime, relationshipModels, new Set()),
    relationshipModels,
  };
}

function valueAt(root: unknown, path: BxlMutationPath): unknown {
  let value = root;
  for (const part of path) {
    if (value === null || typeof value !== 'object') return undefined;
    value = (value as Record<string | number, unknown>)[part];
  }
  return value;
}

function parentAt(root: object, path: BxlMutationPath): { parent: object; key: string | number } {
  if (path.length === 0) {
    throw mutationError('commit', 'card-root-write', 'The Boxel adapter cannot replace a complete Card.');
  }
  const parent = valueAt(root, path.slice(0, -1));
  if (!parent || typeof parent !== 'object') {
    throw mutationError('commit', 'commit-path-missing', `Mutation path ${JSON.stringify(path)} has no live parent.`);
  }
  return { parent, key: path[path.length - 1]! };
}

function collectionAt(root: object, path: BxlMutationPath): unknown[] {
  const value = valueAt(root, path);
  if (!Array.isArray(value)) {
    throw mutationError('commit', 'commit-collection-missing', `Mutation path ${JSON.stringify(path)} is not a live collection.`);
  }
  return value;
}

function fieldAtPath(
  root: object,
  path: BxlMutationPath,
  runtime: AdapterRuntime,
): { field?: BxlBoxelField; item: boolean; sample?: unknown } {
  let model: unknown = root;
  let field: BxlBoxelField | undefined;
  let item = false;
  for (const part of path) {
    if (typeof part === 'string') {
      field = safeFields(runtime, model)[part];
      item = false;
      model = model && typeof model === 'object'
        ? (model as Record<string, unknown>)[part]
        : undefined;
    } else {
      item = true;
      model = Array.isArray(model) ? model[part] : undefined;
    }
  }
  return { field, item, sample: model };
}

function materializeShape(
  value: BxlMutationJson,
  shape: unknown,
  runtime: AdapterRuntime,
): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  if (typeof shape !== 'function') return jsonScalar(value, new Set());
  let instance: Record<string, unknown>;
  try {
    instance = new (shape as new () => Record<string, unknown>)();
  } catch (error) {
    throw mutationError('commit', 'boxel-shape-construction-failed', 'Could not construct a contained Field value.', error);
  }
  const fields = shapeFields(runtime, shape, instance);
  for (const [key, child] of Object.entries(value)) {
    const field = fields[key];
    if (!field || field.computeVia || field.fieldType === 'linksTo' || field.fieldType === 'linksToMany') {
      continue;
    }
    instance[key] = materializeForField(child, field, runtime, false);
  }
  return instance;
}

function materializeForField(
  value: BxlMutationJson,
  field: BxlBoxelField | undefined,
  runtime: AdapterRuntime,
  item: boolean,
): unknown {
  if (!field) return jsonScalar(value, new Set());
  if (item) return materializeShape(value, field.card, runtime);
  if (field.fieldType === 'containsMany') {
    if (!Array.isArray(value)) return value;
    return value.map((entry) => materializeShape(entry, field.card, runtime));
  }
  if (field.fieldType === 'contains') {
    return materializeShape(value, field.card, runtime);
  }
  return value;
}

function setLive(
  root: object,
  path: BxlMutationPath,
  value: unknown,
): Undo {
  const { parent, key } = parentAt(root, path);
  const record = parent as Record<string | number, unknown>;
  const before = record[key];
  record[key] = value;
  return () => {
    record[key] = before;
  };
}

function cardById(values: unknown[], id: string): number {
  return values.findIndex((value) => cardId(value) === id);
}

function applyIntent(
  card: object,
  intent: BxlMutationIntent,
  plan: BxlMutationPlan,
  runtime: AdapterRuntime,
  resolveModel: (id: string) => object,
): Undo {
  switch (intent.op) {
    case 'set': {
      const target = fieldAtPath(card, intent.path, runtime);
      return setLive(
        card,
        intent.path,
        materializeForField(intent.after, target.field, runtime, target.item),
      );
    }
    case 'copy': {
      const target = fieldAtPath(card, intent.path, runtime);
      const output = valueAt(plan.output, intent.path) as BxlMutationJson;
      return setLive(
        card,
        intent.path,
        materializeForField(output, target.field, runtime, target.item),
      );
    }
    case 'delete': {
      const { parent, key } = parentAt(card, intent.path);
      if (Array.isArray(parent) && typeof key === 'number') {
        const [removed] = parent.splice(key, 1);
        return () => { parent.splice(key, 0, removed); };
      }
      const record = parent as Record<string, unknown>;
      const before = record[key as string];
      record[key as string] = undefined;
      return () => { record[key as string] = before; };
    }
    case 'insert': {
      const collection = collectionAt(card, intent.collection);
      const target = fieldAtPath(card, intent.collection, runtime);
      const value = materializeForField(intent.value, target.field, runtime, true);
      collection.splice(intent.index, 0, value);
      return () => { collection.splice(collection.indexOf(value), 1); };
    }
    case 'move': {
      const source = collectionAt(card, intent.from.slice(0, -1));
      const sourceIndex = intent.from.at(-1);
      if (typeof sourceIndex !== 'number') {
        throw mutationError('commit', 'move-source-not-item', 'Move source is not a collection item.');
      }
      const [value] = source.splice(sourceIndex, 1);
      const target = collectionAt(card, intent.toCollection);
      target.splice(intent.toIndex, 0, value);
      return () => {
        const current = target.indexOf(value);
        if (current >= 0) target.splice(current, 1);
        source.splice(sourceIndex, 0, value);
      };
    }
    case 'reorder': {
      const collection = collectionAt(card, intent.collection);
      const before = [...collection];
      const byKey = new Map(collection.map((item) => [
        JSON.stringify(valueAt(item, intent.key)),
        item,
      ]));
      collection.splice(
        0,
        collection.length,
        ...intent.order.map((key) => byKey.get(JSON.stringify(key))),
      );
      return () => { collection.splice(0, collection.length, ...before); };
    }
    case 'relate': {
      const target = fieldAtPath(card, intent.field, runtime);
      const related = resolveModel(intent.cardId);
      if (target.field?.fieldType === 'linksToMany') {
        const collection = collectionAt(card, intent.field);
        const index = intent.index ?? collection.length;
        collection.splice(index, 0, related);
        return () => { collection.splice(collection.indexOf(related), 1); };
      }
      return setLive(card, intent.field, related);
    }
    case 'unrelate': {
      const target = fieldAtPath(card, intent.field, runtime);
      if (target.field?.fieldType === 'linksToMany') {
        const collection = collectionAt(card, intent.field);
        const index = cardById(collection, intent.cardId);
        if (index < 0) {
          throw mutationError('commit', 'relationship-card-missing', `Related Card ${intent.cardId} is not in the live collection.`);
        }
        const [removed] = collection.splice(index, 1);
        return () => { collection.splice(index, 0, removed); };
      }
      return setLive(card, intent.field, null);
    }
    case 'move-relation': {
      const collection = collectionAt(card, intent.field);
      const index = cardById(collection, intent.cardId);
      if (index < 0) {
        throw mutationError('commit', 'relationship-card-missing', `Related Card ${intent.cardId} is not in the live collection.`);
      }
      const [related] = collection.splice(index, 1);
      collection.splice(intent.toIndex, 0, related);
      return () => {
        collection.splice(collection.indexOf(related), 1);
        collection.splice(index, 0, related);
      };
    }
  }
}

/** Apply a validated plan to one live Card model using granular field writes. */
export function applyBxlMutationPlanToCard(
  card: object,
  plan: BxlMutationPlan,
  options: BxlBoxelAdapterOptions & {
    cardStore?: BxlBoxelCardStore;
    resolveCard?: (id: string) => unknown;
  } = {},
): BxlMutationPlan {
  if (plan.target.kind !== 'card') {
    throw mutationError('commit', 'boxel-target-not-card', 'The single-Card adapter only accepts Card-target plans.');
  }
  const runtime = adapterRuntime(options);
  const projection = projectionForCard(card, runtime);
  const liveId = cardId(card);
  if (plan.target.id && liveId && plan.target.id !== liveId) {
    throw mutationError(
      'commit',
      'plan-target-mismatch',
      `Mutation plan targets ${JSON.stringify(plan.target.id)}, not live Card ${JSON.stringify(liveId)}.`,
    );
  }
  if (JSON.stringify(projection.snapshot) !== JSON.stringify(plan.before)) {
    throw mutationError(
      'commit',
      'plan-snapshot-mismatch',
      'The live Card changed after this mutation plan was created. Re-plan against the current Card model.',
    );
  }
  const store = options.cardStore ?? runtime.getStore?.(card);
  const resolveModel = (id: string): object => {
    const value =
      projection.relationshipModels.get(id) ??
      options.resolveCard?.(id) ??
      store?.getCard(id);
    if (!value || typeof value !== 'object') {
      throw mutationError('commit', 'card-not-loaded', `Card ${JSON.stringify(id)} is not loaded in this Card Store.`);
    }
    return value;
  };

  const undo: Undo[] = [];
  try {
    for (const intent of plan.intents) {
      undo.push(applyIntent(card, intent, plan, runtime, resolveModel));
    }
  } catch (error) {
    for (let index = undo.length - 1; index >= 0; index--) {
      try {
        undo[index]!();
      } catch {
        // Preserve the original commit failure. A Boxel setter rollback failure
        // indicates a host invariant violation and will surface on the next read.
      }
    }
    if (error instanceof BxlMutationError) throw error;
    throw mutationError(
      'commit',
      'commit-failed',
      `Could not apply Mutation BXL to the live Card: ${error instanceof Error ? error.message : String(error)}`,
      error,
    );
  }
  return plan;
}

/**
 * Prepare a Card-bound mutation function, analogous to `computeVia: bxl(...)`.
 * The returned function derives schema and snapshot data from `this`, plans the
 * complete program, then applies its semantic intents to that live Card model.
 */
export function updateViaBxl(
  source: string,
  options: BxlUpdateViaOptions = {},
): BxlUpdateViaFunction {
  const syntax = options.syntax ?? 'readable';
  const update = function updateViaBxlCard(
    this: object,
    execution: BxlUpdateViaExecutionOptions = {},
  ): BxlMutationPlan {
    if (!this || typeof this !== 'object') {
      throw mutationError('validate', 'boxel-card-required', 'updateViaBxl must be called with a Card model as this.');
    }
    const runtime = adapterRuntime(options);
    const projection = projectionForCard(this, runtime);
    const schema = options.schema ?? schemaForShape(runtime, this.constructor, this, new Set());
    const store = execution.cardStore ?? runtime.getStore?.(this);
    const resolveModel = (id: string): unknown =>
      projection.relationshipModels.get(id) ?? execution.resolveCard?.(id) ?? store?.getCard(id);
    const prepared = prepareBxlMutation(source, {
      schema,
      targetKind: 'card',
      syntax,
      libraries: options.libraries,
      runtimeLimits: options.runtimeLimits,
    });
    const id = cardId(this);
    const plan = prepared.plan(projection.snapshot, {
      ...execution,
      programId: execution.programId ?? `bxl-local-${++localProgramSequence}`,
      targetId: execution.targetId ?? id,
      resolveCard(cardIdentifier) {
        const model = resolveModel(cardIdentifier);
        if (!model || typeof model !== 'object') return undefined;
        return { id: cardId(model) ?? cardIdentifier };
      },
    });
    return applyBxlMutationPlanToCard(this, plan, {
      getFields: runtime.getFields,
      getStore: runtime.getStore,
      cardStore: store,
      resolveCard: resolveModel,
    });
  } as BxlUpdateViaFunction;

  Object.defineProperty(update, 'bxl', {
    value: Object.freeze({ source, syntax, targetKind: 'card' } satisfies BxlUpdateViaMetadata),
    enumerable: false,
  });
  return update;
}
