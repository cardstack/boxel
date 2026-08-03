import type { BuiltinLibraryName } from '../bxl/registry/index.js';
import type { NativeRuntimeLimits } from '../jqtools/evaluate/runtimeState.js';
import { prepareBxlMutation } from './planner.js';
import {
  BxlMutationError,
  type BxlMutationField,
  type BxlMutationJson,
  type BxlMutationPath,
  type BxlMutationPlan,
  type BxlMutationPlanOptions,
  type BxlMutationSchema,
} from './types.js';

export interface BxlBoxelSourceFieldDefinition<CodeReference = unknown> {
  type: 'contains' | 'containsMany' | 'linksTo' | 'linksToMany';
  isPrimitive: boolean;
  isComputed: boolean;
  fieldOrCard: CodeReference;
  query?: unknown;
}

/** Loaderless subset of Boxel's runtime-common `Definition` shape. */
export interface BxlBoxelSourceDefinition<CodeReference = unknown> {
  type?: 'card-def' | 'field-def';
  codeRef?: CodeReference;
  displayName?: string | null;
  fields: Record<string, string>;
  fieldDefs: Record<string, BxlBoxelSourceFieldDefinition<CodeReference>>;
}

export type BxlBoxelSourceDefinitionLookup<CodeReference = unknown> = (
  codeRef: CodeReference,
) => Promise<BxlBoxelSourceDefinition<CodeReference> | undefined>;

export interface BxlCardSourceRelationship {
  links?: {
    self?: string | null;
    [key: string]: unknown;
  };
  data?:
    | { id?: string; lid?: string; [key: string]: unknown }
    | Array<{ id?: string; lid?: string; [key: string]: unknown } | null>
    | null;
  meta?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface BxlCardSourceResource {
  type: string;
  id?: string;
  lid?: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<
    string,
    BxlCardSourceRelationship | BxlCardSourceRelationship[]
  >;
  meta?: Record<string, unknown>;
  links?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface BxlCardSourceDocument {
  data: BxlCardSourceResource;
  included?: BxlCardSourceResource[];
  [key: string]: unknown;
}

export interface BxlCardSourceSchemaOptions<CodeReference = unknown> {
  lookupDefinition: BxlBoxelSourceDefinitionLookup<CodeReference>;
}

export interface BxlCardSourceProjectionOptions {
  /** Identity for canonical source files, which normally omit `data.id`. */
  targetId?: string;
  /** Resolve a source-relative relationship reference into its logical Card ID. */
  resolveReference?: (reference: string, field: BxlMutationPath) => string;
}

export interface BxlCardSourceCommitOptions
  extends BxlCardSourceProjectionOptions {
  /** Format a logical Card ID for `relationships[path].links.self`. */
  formatReference?: (cardId: string, field: BxlMutationPath) => string;
}

export interface BxlMutateCardSourceOptions
  extends BxlCardSourceCommitOptions,
    Omit<BxlMutationPlanOptions, 'programId' | 'targetId'> {
  schema: BxlMutationSchema;
  programId: string;
  syntax?: 'readable' | 'solidified';
  libraries?: BuiltinLibraryName[];
  runtimeLimits?: NativeRuntimeLimits;
}

export interface BxlCardSourceMutationResult {
  document: BxlCardSourceDocument;
  plan: BxlMutationPlan;
}

interface ResolvedSourceField {
  field: BxlMutationField;
  relationshipPath?: BxlMutationPath;
  item: boolean;
}

function sourceError(
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

function normalizedReadableName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function fieldDefinition<CodeReference>(
  definition: BxlBoxelSourceDefinition<CodeReference>,
  fieldName: string,
): BxlBoxelSourceFieldDefinition<CodeReference> | undefined {
  const id = definition.fields[fieldName];
  return id === undefined ? undefined : definition.fieldDefs[id];
}

function identityKey<CodeReference>(
  definition: BxlBoxelSourceDefinition<CodeReference>,
): string | object {
  if (definition.codeRef !== undefined) {
    try {
      return JSON.stringify(definition.codeRef);
    } catch {
      // Fall through to object identity for non-JSON host code references.
    }
  }
  return definition;
}

async function schemaForDefinition<CodeReference>(
  definition: BxlBoxelSourceDefinition<CodeReference>,
  lookupDefinition: BxlBoxelSourceDefinitionLookup<CodeReference>,
  seen: Set<string | object>,
): Promise<BxlMutationSchema> {
  const identity = identityKey(definition);
  if (seen.has(identity)) return { fields: [] };
  seen.add(identity);

  const candidates = await Promise.all(
    Object.keys(definition.fields).map(async (key) => {
      const field = fieldDefinition(definition, key);
      if (!field || field.isComputed) return undefined;
      const child = field.isPrimitive
        ? undefined
        : await lookupDefinition(field.fieldOrCard);
      return { key, field, child };
    }),
  );

  const displayNameCounts = new Map<string, number>();
  for (const candidate of candidates) {
    const name = candidate?.child?.displayName;
    if (typeof name === 'string' && name.trim()) {
      displayNameCounts.set(name, (displayNameCounts.get(name) ?? 0) + 1);
    }
  }
  const ambiguousDisplayNames = new Set(
    [...displayNameCounts]
      .filter(([, count]) => count > 1)
      .map(([name]) => name),
  );

  const result: BxlMutationField[] = [];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const { key, field, child } = candidate;
    const childName = child?.displayName;
    const label =
      typeof childName === 'string' &&
      childName.trim() &&
      !ambiguousDisplayNames.has(childName)
        ? childName
        : undefined;
    const entry: BxlMutationField = {
      key,
      ...(label ? { label, displayName: label } : {}),
      fieldType: field.type,
      writable: key !== 'id' && field.query === undefined,
    };

    if (field.type === 'linksTo' || field.type === 'linksToMany') {
      const idSchema: BxlMutationSchema = {
        fields: [
          { key: 'id', label: 'ID', displayName: 'ID', writable: false },
        ],
      };
      entry.kind = field.type === 'linksToMany' ? 'array' : 'object';
      entry.item = idSchema;
      entry.fields = idSchema.fields;
    } else if (!field.isPrimitive) {
      const childSchema = child
        ? await schemaForDefinition(child, lookupDefinition, new Set(seen))
        : { fields: [] };
      if (field.type === 'containsMany') {
        entry.kind = 'array';
        entry.item = childSchema;
      } else {
        entry.kind = 'object';
        entry.fields = childSchema.fields;
      }
    } else {
      entry.kind = field.type === 'containsMany' ? 'array' : 'scalar';
    }
    result.push(entry);
  }

  const cardInfo = result.find((field) => field.key === 'cardInfo');
  const occupied = new Set(
    result
      .flatMap((field) => [field.key, field.label, field.displayName])
      .filter((name): name is string => Boolean(name))
      .map(normalizedReadableName),
  );
  for (const child of cardInfo?.fields ?? []) {
    if (child.fieldType !== 'linksTo' && child.fieldType !== 'linksToMany') {
      continue;
    }
    const names = [child.key, child.label, child.displayName].filter(
      (name): name is string => Boolean(name),
    );
    if (names.some((name) => occupied.has(normalizedReadableName(name)))) {
      continue;
    }
    result.push({ ...child, path: ['cardInfo', child.key] });
    for (const name of names) occupied.add(normalizedReadableName(name));
  }

  return { fields: result };
}

/** Derive Mutation BXL schema from Boxel's loaderless server Definition graph. */
export async function mutationSchemaForCardSource<CodeReference>(
  definition: BxlBoxelSourceDefinition<CodeReference>,
  options: BxlCardSourceSchemaOptions<CodeReference>,
): Promise<BxlMutationSchema> {
  return schemaForDefinition(
    definition,
    options.lookupDefinition,
    new Set(),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertDocument(
  document: BxlCardSourceDocument,
): BxlCardSourceResource {
  if (!isRecord(document) || !isRecord(document.data)) {
    throw sourceError(
      'validate',
      'card-source-document-invalid',
      'Expected a single-resource Boxel card source document.',
    );
  }
  if (document.data.type !== 'card') {
    throw sourceError(
      'validate',
      'card-source-resource-type',
      `Expected card source data.type to be "card", received ${JSON.stringify(document.data.type)}.`,
    );
  }
  return document.data;
}

function cloneJson<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch (error) {
    throw sourceError(
      'validate',
      'card-source-not-cloneable',
      'Card source documents must contain structured-cloneable data.',
      error,
    );
  }
}

function nestedSchema(field: BxlMutationField): BxlMutationSchema | undefined {
  if (field.item) return field.item;
  if (field.fields) return { fields: field.fields as BxlMutationField[] };
  return undefined;
}

function physicalFields(schema: BxlMutationSchema): BxlMutationField[] {
  return schema.fields.filter((field) => field.path === undefined);
}

function relationshipReference(
  relationship: BxlCardSourceRelationship | undefined,
  path: BxlMutationPath,
  options: BxlCardSourceProjectionOptions,
): BxlMutationJson {
  if (!relationship) return null;
  let reference: string | null | undefined;
  if (relationship.links && 'self' in relationship.links) {
    reference = relationship.links.self;
  } else if (
    relationship.data &&
    !Array.isArray(relationship.data) &&
    typeof relationship.data.id === 'string'
  ) {
    reference = relationship.data.id;
  } else if (
    relationship.data &&
    !Array.isArray(relationship.data) &&
    typeof relationship.data.lid === 'string'
  ) {
    reference = relationship.data.lid;
  }
  if (reference == null || reference === '') return null;
  return { id: options.resolveReference?.(reference, path) ?? reference };
}

function relationshipValues(
  relationships: BxlCardSourceResource['relationships'],
  path: BxlMutationPath,
  options: BxlCardSourceProjectionOptions,
): BxlMutationJson[] {
  if (!relationships) return [];
  const key = path.join('.');
  const exact = relationships[key];
  let values: BxlCardSourceRelationship[] = [];
  if (Array.isArray(exact)) {
    values = exact;
  } else if (exact && Array.isArray(exact.data)) {
    values = exact.data.map((data) => ({ data }));
  } else {
    const indexed = Object.entries(relationships)
      .flatMap(([candidate, relationship]) => {
        if (!candidate.startsWith(`${key}.`) || Array.isArray(relationship)) {
          return [];
        }
        const suffix = candidate.slice(key.length + 1);
        if (!/^\d+$/.test(suffix)) return [];
        return [{ index: Number(suffix), relationship }];
      })
      .sort((left, right) => left.index - right.index);
    values = indexed.map(({ relationship }) => relationship);
  }
  return values.map((relationship, index) =>
    relationshipReference(relationship, [...path, index], options),
  );
}

function projectObject(
  value: Record<string, unknown>,
  schema: BxlMutationSchema,
  resource: BxlCardSourceResource,
  logicalPath: BxlMutationPath,
  options: BxlCardSourceProjectionOptions,
): Record<string, BxlMutationJson> {
  const output: Record<string, BxlMutationJson> = {};
  for (const field of physicalFields(schema)) {
    const path = [...logicalPath, field.key];
    if (field.key === 'id' && logicalPath.length === 0) {
      output.id = options.targetId ?? resource.id ?? resource.lid ?? null;
      continue;
    }
    switch (field.fieldType) {
      case 'linksTo': {
        const relationship = resource.relationships?.[path.join('.')];
        if (Array.isArray(relationship)) {
          throw sourceError(
            'validate',
            'card-source-relationship-shape',
            `Singular relationship ${JSON.stringify(path.join('.'))} is an array.`,
          );
        }
        output[field.key] = relationshipReference(
          relationship,
          path,
          options,
        );
        break;
      }
      case 'linksToMany':
        output[field.key] = relationshipValues(
          resource.relationships,
          path,
          options,
        );
        break;
      case 'containsMany': {
        const current = value[field.key];
        if (current == null) {
          output[field.key] = [];
          break;
        }
        if (!Array.isArray(current)) {
          throw sourceError(
            'validate',
            'card-source-contained-many-shape',
            `Contained field ${JSON.stringify(path.join('.'))} is not an array.`,
          );
        }
        const childSchema = nestedSchema(field);
        output[field.key] = current.map((item, index) => {
          if (!childSchema || childSchema.fields.length === 0) {
            return cloneJson(item) as BxlMutationJson;
          }
          if (!isRecord(item)) {
            throw sourceError(
              'validate',
              'card-source-contained-item-shape',
              `Contained field ${JSON.stringify(path.join('.'))} has a non-object item.`,
            );
          }
          return projectObject(
            item,
            childSchema,
            resource,
            [...path, index],
            options,
          );
        });
        break;
      }
      case 'contains': {
        const current = value[field.key];
        const childSchema = nestedSchema(field);
        if (childSchema && childSchema.fields.length > 0) {
          if (current != null && !isRecord(current)) {
            throw sourceError(
              'validate',
              'card-source-contained-shape',
              `Contained field ${JSON.stringify(path.join('.'))} is not an object.`,
            );
          }
          output[field.key] = projectObject(
            isRecord(current) ? current : {},
            childSchema,
            resource,
            path,
            options,
          );
        } else {
          output[field.key] =
            current === undefined
              ? null
              : (cloneJson(current) as BxlMutationJson);
        }
        break;
      }
      default:
        output[field.key] =
          value[field.key] === undefined
            ? null
            : (cloneJson(value[field.key]) as BxlMutationJson);
    }
  }
  return output;
}

/** Project canonical Boxel card source into the loaded-shaped Mutation snapshot. */
export function snapshotBxlCardSource(
  document: BxlCardSourceDocument,
  schema: BxlMutationSchema,
  options: BxlCardSourceProjectionOptions = {},
): BxlMutationJson {
  const resource = assertDocument(document);
  if (resource.attributes !== undefined && !isRecord(resource.attributes)) {
    throw sourceError(
      'validate',
      'card-source-attributes-shape',
      'Card source data.attributes must be an object when present.',
    );
  }
  return projectObject(
    resource.attributes ?? {},
    schema,
    resource,
    [],
    options,
  );
}

function resolveSourceField(
  path: BxlMutationPath,
  schema: BxlMutationSchema,
): ResolvedSourceField {
  let current = schema;
  let field: BxlMutationField | undefined;
  let relationshipPath: BxlMutationPath | undefined;
  let item = false;
  let traversed: BxlMutationPath = [];
  for (const part of path) {
    if (typeof part === 'number') {
      if (!field || field.kind !== 'array') {
        throw sourceError(
          'commit',
          'card-source-path-invalid',
          `Mutation path ${JSON.stringify(path)} indexes a non-array field.`,
        );
      }
      item = true;
      traversed = [...traversed, part];
      current = field.item ?? { fields: [] };
      continue;
    }
    const candidate = current.fields.find(
      (entry) => entry.key === part && entry.path === undefined,
    );
    if (!candidate) {
      throw sourceError(
        'commit',
        'card-source-field-missing',
        `Mutation path ${JSON.stringify(path)} is not present in the supplied source schema.`,
      );
    }
    field = candidate;
    traversed = [...traversed, part];
    if (candidate.fieldType === 'linksTo' || candidate.fieldType === 'linksToMany') {
      relationshipPath = [...traversed];
    }
    item = false;
    current = nestedSchema(candidate) ?? { fields: [] };
  }
  if (!field) {
    throw sourceError(
      'commit',
      'card-source-root-write',
      'The card-source adapter cannot replace a complete Card.',
    );
  }
  return { field, relationshipPath, item };
}

function recordAt(
  root: Record<string, unknown>,
  path: BxlMutationPath,
): { parent: Record<string | number, unknown>; key: string | number } {
  if (path.length === 0) {
    throw sourceError(
      'commit',
      'card-source-root-write',
      'The card-source adapter cannot replace a complete Card.',
    );
  }
  let value: unknown = root;
  for (const part of path.slice(0, -1)) {
    if (typeof part === 'number') {
      if (!Array.isArray(value) || !isRecord(value[part])) {
        throw sourceError(
          'commit',
          'card-source-path-missing',
          `Mutation path ${JSON.stringify(path)} has no source parent.`,
        );
      }
      value = value[part];
    } else {
      if (!isRecord(value)) {
        throw sourceError(
          'commit',
          'card-source-path-missing',
          `Mutation path ${JSON.stringify(path)} has no source parent.`,
        );
      }
      let next = value[part];
      if (next === undefined) {
        next = {};
        value[part] = next;
      }
      value = next;
    }
  }
  if (!isRecord(value) && !Array.isArray(value)) {
    throw sourceError(
      'commit',
      'card-source-path-missing',
      `Mutation path ${JSON.stringify(path)} has no source parent.`,
    );
  }
  return {
    parent: value as Record<string | number, unknown>,
    key: path[path.length - 1]!,
  };
}

function assertScalarContainedWrite(
  path: BxlMutationPath,
  schema: BxlMutationSchema,
): void {
  const resolved = resolveSourceField(path, schema);
  if (
    resolved.relationshipPath ||
    resolved.field.fieldType !== 'contains' ||
    resolved.field.kind === 'object' ||
    resolved.item
  ) {
    throw sourceError(
      'commit',
      'card-source-structural-write-unsupported',
      `Version 1 card-source commits only support contained scalar leaves and singular relationships; received ${JSON.stringify(path)}.`,
    );
  }
}

function relationshipAt(
  resource: BxlCardSourceResource,
  path: BxlMutationPath,
): BxlCardSourceRelationship {
  const key = path.join('.');
  resource.relationships ??= {};
  const existing = resource.relationships[key];
  if (Array.isArray(existing)) {
    throw sourceError(
      'commit',
      'card-source-relationship-shape',
      `Singular relationship ${JSON.stringify(key)} is an array.`,
    );
  }
  return existing ?? {};
}

function setRelationship(
  resource: BxlCardSourceResource,
  path: BxlMutationPath,
  self: string | null,
): void {
  const key = path.join('.');
  const relationship = relationshipAt(resource, path);
  const next: BxlCardSourceRelationship = {
    ...relationship,
    links: { ...(relationship.links ?? {}), self },
  };
  delete next.data;
  resource.relationships![key] = next;
}

/**
 * Apply a validated plan to a cloned canonical card-source document.
 * The input document is never mutated. Version 1 intentionally supports only
 * scalar contained leaves and singular relationship writes, which cannot
 * desynchronize Boxel's parallel `meta.fields` collection metadata.
 */
export function applyBxlMutationPlanToCardSource(
  document: BxlCardSourceDocument,
  plan: BxlMutationPlan,
  schema: BxlMutationSchema,
  options: BxlCardSourceCommitOptions = {},
): BxlCardSourceMutationResult {
  if (plan.target.kind !== 'card') {
    throw sourceError(
      'commit',
      'card-source-target-not-card',
      'The card-source adapter only accepts Card-target plans.',
    );
  }
  const before = snapshotBxlCardSource(document, schema, options);
  if (JSON.stringify(before) !== JSON.stringify(plan.before)) {
    throw sourceError(
      'commit',
      'card-source-snapshot-mismatch',
      'The card source changed after this mutation plan was created. Re-plan against the current source document.',
    );
  }

  const nextDocument = cloneJson(document);
  const resource = assertDocument(nextDocument);
  resource.attributes ??= {};
  for (const intent of plan.intents) {
    switch (intent.op) {
      case 'set': {
        assertScalarContainedWrite(intent.path, schema);
        const { parent, key } = recordAt(resource.attributes, intent.path);
        parent[key] = cloneJson(intent.after);
        break;
      }
      case 'copy': {
        assertScalarContainedWrite(intent.path, schema);
        const { parent, key } = recordAt(resource.attributes, intent.path);
        let value: unknown = plan.output;
        for (const part of intent.path) {
          value =
            value && typeof value === 'object'
              ? (value as Record<string | number, unknown>)[part]
              : undefined;
        }
        parent[key] = cloneJson(value);
        break;
      }
      case 'delete': {
        assertScalarContainedWrite(intent.path, schema);
        const { parent, key } = recordAt(resource.attributes, intent.path);
        if (Array.isArray(parent) && typeof key === 'number') {
          throw sourceError(
            'commit',
            'card-source-structural-write-unsupported',
            'Version 1 card-source commits cannot delete collection items.',
          );
        }
        delete parent[key];
        break;
      }
      case 'relate': {
        const resolved = resolveSourceField(intent.field, schema);
        if (
          resolved.field.fieldType !== 'linksTo' ||
          !resolved.relationshipPath
        ) {
          throw sourceError(
            'commit',
            'card-source-structural-write-unsupported',
            'Version 1 card-source commits only support singular linksTo relationships.',
          );
        }
        setRelationship(
          resource,
          resolved.relationshipPath,
          options.formatReference?.(intent.cardId, intent.field) ??
            intent.cardId,
        );
        break;
      }
      case 'unrelate': {
        const resolved = resolveSourceField(intent.field, schema);
        if (
          resolved.field.fieldType !== 'linksTo' ||
          !resolved.relationshipPath
        ) {
          throw sourceError(
            'commit',
            'card-source-structural-write-unsupported',
            'Version 1 card-source commits only support singular linksTo relationships.',
          );
        }
        setRelationship(resource, resolved.relationshipPath, null);
        break;
      }
      case 'insert':
      case 'move':
      case 'reorder':
      case 'move-relation':
        throw sourceError(
          'commit',
          'card-source-structural-write-unsupported',
          `Card-source commit operation ${intent.op} is not supported in version 1.`,
        );
    }
  }

  return { document: nextDocument, plan };
}

/** Plan and immutably apply one complete Mutation BXL program to card source. */
export function mutateBxlCardSource(
  document: BxlCardSourceDocument,
  source: string,
  options: BxlMutateCardSourceOptions,
): BxlCardSourceMutationResult {
  const prepared = prepareBxlMutation(source, {
    targetKind: 'card',
    schema: options.schema,
    syntax: options.syntax ?? 'readable',
    libraries: options.libraries,
    runtimeLimits: options.runtimeLimits,
  });
  const snapshot = snapshotBxlCardSource(document, options.schema, options);
  const plan = prepared.plan(snapshot, {
    programId: options.programId,
    targetId:
      options.targetId ?? document.data.id ?? document.data.lid,
    delivery: options.delivery,
    transaction: options.transaction,
    baseRevision: options.baseRevision,
    currentRevision: options.currentRevision,
    returning: options.returning,
    cards: options.cards,
    resolveCard: options.resolveCard,
    authorize: options.authorize,
  });
  return applyBxlMutationPlanToCardSource(
    document,
    plan,
    options.schema,
    options,
  );
}
