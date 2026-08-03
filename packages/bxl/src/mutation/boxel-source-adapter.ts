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
  serializerName?: string;
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
  /**
   * Supply Boxel's sidecars when a mutation creates or replaces a contained
   * value whose runtime FieldDef cannot be inferred from plain JSON. This is
   * required for new polymorphic values such as Spec.containedExamples.
   * Returned relationship keys are local to the contained value and are
   * hoisted into the resource's dotted relationship map.
   */
  serializeContainedValue?: (
    context: BxlCardSourceContainedValueContext,
  ) => BxlCardSourceContainedValueSerialization | undefined;
}

export interface BxlCardSourceContainedValueContext {
  operation: 'insert' | 'replace';
  path: BxlMutationPath;
  value: BxlMutationJson;
  field: BxlMutationField;
}

export interface BxlCardSourceContainedValueSerialization {
  meta?: Record<string, unknown>;
  relationships?: Record<
    string,
    BxlCardSourceRelationship | BxlCardSourceRelationship[]
  >;
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
      boxelSource: {
        isPrimitive: field.isPrimitive,
        fieldOrCard: cloneJson(field.fieldOrCard),
        ...(field.serializerName ? { serializerName: field.serializerName } : {}),
      },
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

function sourceFieldIsPrimitive(field: BxlMutationField): boolean {
  if (field.boxelSource) return field.boxelSource.isPrimitive;
  if (field.fieldType === 'containsMany') return field.item === undefined;
  if (field.fieldType === 'contains') return field.fields === undefined;
  return false;
}

function isCompositeContained(field: BxlMutationField): boolean {
  return (
    (field.fieldType === 'contains' || field.fieldType === 'containsMany') &&
    !sourceFieldIsPrimitive(field)
  );
}

function valueAt(root: unknown, path: BxlMutationPath): unknown {
  let value = root;
  for (const part of path) {
    if ((!isRecord(value) && !Array.isArray(value)) || !(part in value)) {
      return undefined;
    }
    value = (value as Record<string | number, unknown>)[part];
  }
  return value;
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
      if (!Array.isArray(value) || value[part] === undefined) {
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

function arrayAt(
  root: Record<string, unknown>,
  path: BxlMutationPath,
): unknown[] {
  const value = valueAt(root, path);
  if (!Array.isArray(value)) {
    throw sourceError(
      'commit',
      'card-source-collection-shape',
      `Mutation collection ${JSON.stringify(path)} is not an array in card source.`,
    );
  }
  return value;
}

interface MetaSlot {
  fields?: Record<string, unknown>;
  field: BxlMutationField;
  name: string;
}

function resourceMetaFields(
  resource: BxlCardSourceResource,
  create: boolean,
): Record<string, unknown> | undefined {
  if (resource.meta === undefined) {
    if (!create) return undefined;
    resource.meta = {};
  }
  if (!isRecord(resource.meta)) {
    throw sourceError(
      'commit',
      'card-source-meta-shape',
      'Card source data.meta must be an object.',
    );
  }
  let fields = resource.meta.fields;
  if (fields === undefined) {
    if (!create) return undefined;
    fields = {};
    resource.meta.fields = fields;
  }
  if (!isRecord(fields)) {
    throw sourceError(
      'commit',
      'card-source-meta-fields-shape',
      'Card source data.meta.fields must be an object.',
    );
  }
  return fields;
}

function childMetaFields(
  meta: Record<string, unknown>,
  create: boolean,
): Record<string, unknown> | undefined {
  let fields = meta.fields;
  if (fields === undefined) {
    if (!create) return undefined;
    fields = {};
    meta.fields = fields;
  }
  if (!isRecord(fields)) {
    throw sourceError(
      'commit',
      'card-source-nested-meta-fields-shape',
      'Contained Boxel metadata fields must be an object.',
    );
  }
  return fields;
}

function metaSlotForField(
  resource: BxlCardSourceResource,
  path: BxlMutationPath,
  schema: BxlMutationSchema,
  create: boolean,
): MetaSlot {
  if (path.length === 0 || typeof path.at(-1) !== 'string') {
    throw sourceError(
      'commit',
      'card-source-meta-path-invalid',
      `Expected a Field path, received ${JSON.stringify(path)}.`,
    );
  }
  let currentSchema = schema;
  let fields = resourceMetaFields(resource, create);
  let index = 0;
  while (index < path.length) {
    const name = path[index];
    if (typeof name !== 'string') {
      throw sourceError(
        'commit',
        'card-source-meta-path-invalid',
        `Expected a Field name in ${JSON.stringify(path)}.`,
      );
    }
    const field = currentSchema.fields.find(
      (candidate) => candidate.key === name && candidate.path === undefined,
    );
    if (!field) {
      throw sourceError(
        'commit',
        'card-source-field-missing',
        `Mutation path ${JSON.stringify(path)} is not present in the supplied source schema.`,
      );
    }
    if (index === path.length - 1) return { fields, field, name };

    if (!isCompositeContained(field)) {
      throw sourceError(
        'commit',
        'card-source-meta-path-invalid',
        `Mutation path ${JSON.stringify(path)} descends through a primitive or relationship Field.`,
      );
    }

    let childMeta: Record<string, unknown> | undefined;
    if (field.fieldType === 'containsMany') {
      const itemIndex = path[index + 1];
      if (typeof itemIndex !== 'number') {
        throw sourceError(
          'commit',
          'card-source-meta-path-invalid',
          `Contained-many path ${JSON.stringify(path)} is missing an item index.`,
        );
      }
      let metas = fields?.[name];
      if (metas === undefined && create) {
        metas = [];
        fields![name] = metas;
      }
      if (metas !== undefined && !Array.isArray(metas)) {
        throw sourceError(
          'commit',
          'card-source-contained-many-meta-shape',
          `meta.fields.${name} must be an array for a composite containsMany Field.`,
        );
      }
      if (Array.isArray(metas)) {
        let itemMeta = metas[itemIndex];
        if (itemMeta === undefined && create) {
          itemMeta = {};
          while (metas.length < itemIndex) metas.push({});
          metas[itemIndex] = itemMeta;
        }
        if (itemMeta !== undefined && !isRecord(itemMeta)) {
          throw sourceError(
            'commit',
            'card-source-contained-item-meta-shape',
            `meta.fields.${name}[${itemIndex}] must be an object.`,
          );
        }
        childMeta = itemMeta;
      }
      index += 2;
    } else {
      let fieldMeta = fields?.[name];
      if (fieldMeta === undefined && create) {
        fieldMeta = {};
        fields![name] = fieldMeta;
      }
      if (fieldMeta !== undefined && !isRecord(fieldMeta)) {
        throw sourceError(
          'commit',
          'card-source-contained-meta-shape',
          `meta.fields.${name} must be an object for a composite contains Field.`,
        );
      }
      childMeta = fieldMeta;
      index += 1;
    }
    fields = childMeta ? childMetaFields(childMeta, create) : undefined;
    currentSchema = nestedSchema(field) ?? { fields: [] };
  }
  throw sourceError(
    'commit',
    'card-source-meta-path-invalid',
    `Unable to resolve metadata path ${JSON.stringify(path)}.`,
  );
}

function cleanupRootMetaFields(resource: BxlCardSourceResource): void {
  const fields = resourceMetaFields(resource, false);
  if (fields && Object.keys(fields).length === 0 && isRecord(resource.meta)) {
    delete resource.meta.fields;
  }
}

function relationshipIndex(
  key: string,
  prefix: string,
): { index: number; suffix: string } | undefined {
  if (!key.startsWith(`${prefix}.`)) return undefined;
  const remainder = key.slice(prefix.length + 1);
  const match = /^(\d+)(.*)$/.exec(remainder);
  if (!match) return undefined;
  return { index: Number(match[1]), suffix: match[2] ?? '' };
}

function normalizeToManyRelationship(
  resource: BxlCardSourceResource,
  prefix: string,
): void {
  const exact = resource.relationships?.[prefix];
  if (!exact) return;
  if (Array.isArray(exact)) {
    delete resource.relationships![prefix];
    exact.forEach((entry, index) => {
      resource.relationships![`${prefix}.${index}`] = entry;
    });
  } else if (Array.isArray(exact.data)) {
    delete resource.relationships![prefix];
    exact.data.forEach((data, index) => {
      resource.relationships![`${prefix}.${index}`] = {
        ...(exact.links ? { links: cloneJson(exact.links) } : {}),
        ...(exact.meta ? { meta: cloneJson(exact.meta) } : {}),
        data,
      };
    });
  } else {
    // Boxel represents an empty linksToMany as `{ links: { self: null } }`.
    // Once it gains an item the indexed representation replaces that marker.
    delete resource.relationships![prefix];
  }
}

function permuteRelationshipIndexes(
  resource: BxlCardSourceResource,
  collectionPath: BxlMutationPath,
  oldToNew: Map<number, number>,
): void {
  if (!resource.relationships) return;
  const prefix = collectionPath.join('.');
  normalizeToManyRelationship(resource, prefix);
  const replacements: Array<[
    string,
    BxlCardSourceRelationship | BxlCardSourceRelationship[],
  ]> = [];
  for (const [key, relationship] of Object.entries(resource.relationships)) {
    const indexed = relationshipIndex(key, prefix);
    if (!indexed) continue;
    delete resource.relationships[key];
    const nextIndex = oldToNew.get(indexed.index);
    if (nextIndex !== undefined) {
      replacements.push([
        `${prefix}.${nextIndex}${indexed.suffix}`,
        relationship,
      ]);
    }
  }
  replacements
    .sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }))
    .forEach(([key, relationship]) => {
      resource.relationships![key] = relationship;
    });
}

function permuteCollectionMeta(
  resource: BxlCardSourceResource,
  collectionPath: BxlMutationPath,
  schema: BxlMutationSchema,
  oldToNew: Map<number, number>,
  nextLength: number,
): void {
  const slot = metaSlotForField(resource, collectionPath, schema, false);
  if (!slot.fields) return;
  if (isCompositeContained(slot.field)) {
    const existing = slot.fields[slot.name];
    if (existing === undefined) return;
    if (!Array.isArray(existing)) {
      throw sourceError(
        'commit',
        'card-source-contained-many-meta-shape',
        `meta.fields.${slot.name} must be an array for a composite containsMany Field.`,
      );
    }
    const next = Array.from({ length: nextLength }, () => ({}));
    for (const [oldIndex, newIndex] of oldToNew) {
      next[newIndex] = cloneJson(existing[oldIndex] ?? {});
    }
    if (next.length === 0) delete slot.fields[slot.name];
    else slot.fields[slot.name] = next;
  } else {
    const prefix = `${slot.name}.`;
    const replacements: Array<[string, unknown]> = [];
    for (const [key, meta] of Object.entries(slot.fields)) {
      if (!key.startsWith(prefix)) continue;
      const suffix = key.slice(prefix.length);
      if (!/^\d+$/.test(suffix)) continue;
      delete slot.fields[key];
      const nextIndex = oldToNew.get(Number(suffix));
      if (nextIndex !== undefined) {
        replacements.push([`${slot.name}.${nextIndex}`, meta]);
      }
    }
    replacements.forEach(([key, meta]) => {
      slot.fields![key] = meta;
    });
  }
  cleanupRootMetaFields(resource);
}

function permuteCollectionSidecars(
  resource: BxlCardSourceResource,
  collectionPath: BxlMutationPath,
  schema: BxlMutationSchema,
  oldToNew: Map<number, number>,
  nextLength: number,
): void {
  permuteCollectionMeta(resource, collectionPath, schema, oldToNew, nextLength);
  permuteRelationshipIndexes(resource, collectionPath, oldToNew);
}

function removeRelationshipSubtree(
  resource: BxlCardSourceResource,
  path: BxlMutationPath,
): void {
  if (!resource.relationships) return;
  const prefix = path.join('.');
  for (const key of Object.keys(resource.relationships)) {
    if (key === prefix || key.startsWith(`${prefix}.`)) {
      delete resource.relationships[key];
    }
  }
}

function writeContainedMeta(
  resource: BxlCardSourceResource,
  path: BxlMutationPath,
  schema: BxlMutationSchema,
  meta: Record<string, unknown> | undefined,
): void {
  const last = path.at(-1);
  if (typeof last === 'number') {
    const collectionPath = path.slice(0, -1);
    const slot = metaSlotForField(resource, collectionPath, schema, Boolean(meta));
    if (!slot.fields) return;
    if (isCompositeContained(slot.field)) {
      let values = slot.fields[slot.name];
      if (values === undefined && meta) {
        values = [];
        slot.fields[slot.name] = values;
      }
      if (values !== undefined && !Array.isArray(values)) {
        throw sourceError(
          'commit',
          'card-source-contained-many-meta-shape',
          `meta.fields.${slot.name} must be an array.`,
        );
      }
      if (Array.isArray(values)) {
        while (values.length <= last) values.push({});
        values[last] = cloneJson(meta ?? {});
      }
    } else if (meta) {
      slot.fields[`${slot.name}.${last}`] = cloneJson(meta);
    } else {
      delete slot.fields[`${slot.name}.${last}`];
    }
    return;
  }
  const slot = metaSlotForField(resource, path, schema, Boolean(meta));
  if (!slot.fields) return;
  if (meta) slot.fields[slot.name] = cloneJson(meta);
  else delete slot.fields[slot.name];
  cleanupRootMetaFields(resource);
}

function writeContainedRelationships(
  resource: BxlCardSourceResource,
  path: BxlMutationPath,
  relationships:
    | Record<
        string,
        BxlCardSourceRelationship | BxlCardSourceRelationship[]
      >
    | undefined,
): void {
  if (!relationships) return;
  const prefix = path.join('.');
  resource.relationships ??= {};
  for (const [key, relationship] of Object.entries(relationships)) {
    resource.relationships[`${prefix}.${key}`] = cloneJson(relationship);
  }
}

function collectionUsesPerValueAdoptsFrom(
  resource: BxlCardSourceResource,
  collectionPath: BxlMutationPath,
  schema: BxlMutationSchema,
): boolean {
  const slot = metaSlotForField(resource, collectionPath, schema, false);
  if (!slot.fields) return false;
  if (isCompositeContained(slot.field)) {
    const values = slot.fields[slot.name];
    return (
      Array.isArray(values) &&
      values.some((value) => isRecord(value) && value.adoptsFrom !== undefined)
    );
  }
  const prefix = `${slot.name}.`;
  return Object.entries(slot.fields).some(
    ([key, value]) =>
      key.startsWith(prefix) &&
      /^\d+$/.test(key.slice(prefix.length)) &&
      isRecord(value) &&
      value.adoptsFrom !== undefined,
  );
}

function serializeNewContainedValue(
  resource: BxlCardSourceResource,
  path: BxlMutationPath,
  value: BxlMutationJson,
  field: BxlMutationField,
  operation: 'insert' | 'replace',
  schema: BxlMutationSchema,
  options: BxlCardSourceCommitOptions,
  requiresAdoptsFrom = false,
): void {
  const serialized = options.serializeContainedValue?.({
    operation,
    path: [...path],
    value: cloneJson(value),
    field,
  });
  if (requiresAdoptsFrom && serialized?.meta?.adoptsFrom === undefined) {
    throw sourceError(
      'commit',
      'card-source-contained-meta-required',
      `Contained value ${JSON.stringify(path)} needs per-value meta.adoptsFrom. Supply serializeContainedValue so the source keeps its runtime FieldDef.`,
    );
  }
  writeContainedMeta(resource, path, schema, serialized?.meta);
  writeContainedRelationships(resource, path, serialized?.relationships);
}

function removeValueMeta(
  resource: BxlCardSourceResource,
  path: BxlMutationPath,
  schema: BxlMutationSchema,
): void {
  const last = path.at(-1);
  if (typeof last === 'number') {
    writeContainedMeta(resource, path, schema, undefined);
    return;
  }
  const slot = metaSlotForField(resource, path, schema, false);
  if (slot.fields) delete slot.fields[slot.name];
  cleanupRootMetaFields(resource);
}

function copyValueSidecars(
  resource: BxlCardSourceResource,
  from: BxlMutationPath,
  to: BxlMutationPath,
  schema: BxlMutationSchema,
): void {
  const destination = resolveSourceField(to, schema);
  if (sourceFieldIsPrimitive(destination.field)) {
    // copy_value_to changes a primitive value through the destination Field;
    // its existing per-field/per-index implementation override remains the
    // destination's, just as it does on a loaded Card instance.
    return;
  }
  const fromLast = from.at(-1);
  let meta: unknown;
  if (typeof fromLast === 'number') {
    const slot = metaSlotForField(resource, from.slice(0, -1), schema, false);
    if (slot.fields) {
      if (isCompositeContained(slot.field)) {
        const values = slot.fields[slot.name];
        meta = Array.isArray(values) ? values[fromLast] : undefined;
      } else {
        meta = slot.fields[`${slot.name}.${fromLast}`];
      }
    }
  } else {
    const slot = metaSlotForField(resource, from, schema, false);
    meta = slot.fields?.[slot.name];
  }
  removeValueMeta(resource, to, schema);
  if (isRecord(meta)) writeContainedMeta(resource, to, schema, cloneJson(meta));

  const fromPrefix = from.join('.');
  const toPrefix = to.join('.');
  const copied: Array<[
    string,
    BxlCardSourceRelationship | BxlCardSourceRelationship[],
  ]> = [];
  for (const [key, relationship] of Object.entries(resource.relationships ?? {})) {
    if (key === fromPrefix || key.startsWith(`${fromPrefix}.`)) {
      copied.push([`${toPrefix}${key.slice(fromPrefix.length)}`, cloneJson(relationship)]);
    }
  }
  removeRelationshipSubtree(resource, to);
  if (copied.length > 0) resource.relationships ??= {};
  copied.forEach(([key, relationship]) => {
    resource.relationships![key] = relationship;
  });
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
 * The input document is never mutated. Structural changes update Boxel's
 * parallel attributes, dotted relationships, and recursive `meta.fields`
 * representations as one operation.
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
        const resolved = resolveSourceField(intent.path, schema);
        const replacingCollection =
          resolved.field.fieldType === 'containsMany' &&
          typeof intent.path.at(-1) === 'string';
        const requiresAdoptsFrom = replacingCollection
          ? collectionUsesPerValueAdoptsFrom(
              resource,
              intent.path,
              schema,
            )
          : typeof intent.path.at(-1) === 'number'
            ? collectionUsesPerValueAdoptsFrom(
                resource,
                intent.path.slice(0, -1),
                schema,
              )
            : false;
        const { parent, key } = recordAt(resource.attributes, intent.path);
        parent[key] = cloneJson(intent.after);
        const replacingComposite =
          isCompositeContained(resolved.field) &&
          (replacingCollection || typeof intent.path.at(-1) === 'number' || resolved.field.fieldType === 'contains');
        if (replacingComposite) {
          if (replacingCollection) {
            permuteCollectionSidecars(
              resource,
              intent.path,
              schema,
              new Map(),
              0,
            );
          } else {
            removeValueMeta(resource, intent.path, schema);
            removeRelationshipSubtree(resource, intent.path);
          }
          if (replacingCollection && Array.isArray(intent.after)) {
            intent.after.forEach((value, index) =>
              serializeNewContainedValue(
                resource,
                [...intent.path, index],
                value,
                resolved.field,
                'replace',
                schema,
                options,
                requiresAdoptsFrom,
              ),
            );
          } else {
            serializeNewContainedValue(
              resource,
              intent.path,
              intent.after,
              resolved.field,
              'replace',
              schema,
              options,
              requiresAdoptsFrom,
            );
          }
        } else if (replacingCollection) {
          // Primitive containsMany uses direct `field.N` metadata keys rather
          // than a metadata array. A whole-array replacement invalidates all
          // old indexes and then serializes each new value's optional sidecar.
          permuteCollectionSidecars(
            resource,
            intent.path,
            schema,
            new Map(),
            0,
          );
          if (Array.isArray(intent.after)) {
            intent.after.forEach((value, index) =>
              serializeNewContainedValue(
                resource,
                [...intent.path, index],
                value,
                resolved.field,
                'replace',
                schema,
                options,
                requiresAdoptsFrom,
              ),
            );
          }
        }
        break;
      }
      case 'copy': {
        const { parent, key } = recordAt(resource.attributes, intent.path);
        const value = valueAt(resource.attributes, intent.from);
        parent[key] = cloneJson(value);
        copyValueSidecars(resource, intent.from, intent.path, schema);
        break;
      }
      case 'delete': {
        const { parent, key } = recordAt(resource.attributes, intent.path);
        if (Array.isArray(parent) && typeof key === 'number') {
          const collectionPath = intent.path.slice(0, -1);
          const oldLength = parent.length;
          const oldToNew = new Map<number, number>();
          for (let index = 0; index < oldLength; index++) {
            if (index < key) oldToNew.set(index, index);
            else if (index > key) oldToNew.set(index, index - 1);
          }
          parent.splice(key, 1);
          permuteCollectionSidecars(
            resource,
            collectionPath,
            schema,
            oldToNew,
            parent.length,
          );
        } else {
          delete parent[key];
          const resolved = resolveSourceField(intent.path, schema);
          if (!sourceFieldIsPrimitive(resolved.field)) {
            removeValueMeta(resource, intent.path, schema);
            removeRelationshipSubtree(resource, intent.path);
          }
        }
        break;
      }
      case 'insert': {
        const collection = arrayAt(resource.attributes, intent.collection);
        const resolved = resolveSourceField(intent.collection, schema);
        const requiresAdoptsFrom = collectionUsesPerValueAdoptsFrom(
          resource,
          intent.collection,
          schema,
        );
        const oldToNew = new Map<number, number>();
        for (let index = 0; index < collection.length; index++) {
          oldToNew.set(index, index < intent.index ? index : index + 1);
        }
        permuteCollectionSidecars(
          resource,
          intent.collection,
          schema,
          oldToNew,
          collection.length + 1,
        );
        collection.splice(intent.index, 0, cloneJson(intent.value));
        serializeNewContainedValue(
          resource,
          [...intent.collection, intent.index],
          intent.value,
          resolved.field,
          'insert',
          schema,
          options,
          requiresAdoptsFrom,
        );
        break;
      }
      case 'move': {
        const collectionPath = intent.from.slice(0, -1);
        const collection = arrayAt(resource.attributes, collectionPath);
        const fromIndex = intent.from.at(-1);
        if (typeof fromIndex !== 'number') {
          throw sourceError(
            'commit',
            'card-source-move-path-invalid',
            `Move source ${JSON.stringify(intent.from)} is not a collection item.`,
          );
        }
        const order = collection.map((_, index) => index);
        const [movedIndex] = order.splice(fromIndex, 1);
        order.splice(intent.toIndex, 0, movedIndex!);
        const oldToNew = new Map(order.map((oldIndex, newIndex) => [oldIndex, newIndex]));
        const [moved] = collection.splice(fromIndex, 1);
        collection.splice(intent.toIndex, 0, moved);
        permuteCollectionSidecars(
          resource,
          collectionPath,
          schema,
          oldToNew,
          collection.length,
        );
        break;
      }
      case 'reorder': {
        const collection = arrayAt(resource.attributes, intent.collection);
        const itemKey = (value: unknown): string =>
          JSON.stringify(valueAt(value, intent.key));
        const oldByKey = new Map(
          collection.map((value, index) => [itemKey(value), index]),
        );
        const order = intent.order.map((key) => {
          const oldIndex = oldByKey.get(JSON.stringify(key));
          if (oldIndex === undefined) {
            throw sourceError(
              'commit',
              'card-source-reorder-key-missing',
              `Reorder key ${JSON.stringify(key)} is missing from card source.`,
            );
          }
          return oldIndex;
        });
        const oldValues = [...collection];
        collection.splice(0, collection.length, ...order.map((index) => oldValues[index]));
        const oldToNew = new Map(order.map((oldIndex, newIndex) => [oldIndex, newIndex]));
        permuteCollectionSidecars(
          resource,
          intent.collection,
          schema,
          oldToNew,
          collection.length,
        );
        break;
      }
      case 'relate': {
        const resolved = resolveSourceField(intent.field, schema);
        if (!resolved.relationshipPath) {
          throw sourceError(
            'commit',
            'card-source-relationship-path-invalid',
            `Relationship path ${JSON.stringify(intent.field)} is invalid.`,
          );
        }
        const reference =
          options.formatReference?.(intent.cardId, intent.field) ?? intent.cardId;
        if (resolved.field.fieldType === 'linksToMany') {
          const current = relationshipValues(resource.relationships, intent.field, options);
          const index = intent.index ?? current.length;
          const oldToNew = new Map<number, number>();
          for (let oldIndex = 0; oldIndex < current.length; oldIndex++) {
            oldToNew.set(oldIndex, oldIndex < index ? oldIndex : oldIndex + 1);
          }
          permuteRelationshipIndexes(resource, intent.field, oldToNew);
          resource.relationships ??= {};
          resource.relationships[`${intent.field.join('.')}.${index}`] = {
            links: { self: reference },
          };
        } else {
          setRelationship(resource, resolved.relationshipPath, reference);
        }
        break;
      }
      case 'unrelate': {
        const resolved = resolveSourceField(intent.field, schema);
        if (!resolved.relationshipPath) {
          throw sourceError(
            'commit',
            'card-source-relationship-path-invalid',
            `Relationship path ${JSON.stringify(intent.field)} is invalid.`,
          );
        }
        if (resolved.field.fieldType === 'linksToMany') {
          const current = relationshipValues(resource.relationships, intent.field, options);
          const index = current.findIndex(
            (value) => isRecord(value) && value.id === intent.cardId,
          );
          if (index < 0) {
            throw sourceError(
              'commit',
              'card-source-relationship-card-missing',
              `Related Card ${JSON.stringify(intent.cardId)} is missing from ${JSON.stringify(intent.field)}.`,
            );
          }
          const oldToNew = new Map<number, number>();
          for (let oldIndex = 0; oldIndex < current.length; oldIndex++) {
            if (oldIndex < index) oldToNew.set(oldIndex, oldIndex);
            else if (oldIndex > index) oldToNew.set(oldIndex, oldIndex - 1);
          }
          permuteRelationshipIndexes(resource, intent.field, oldToNew);
          if (current.length === 1) {
            resource.relationships ??= {};
            resource.relationships[intent.field.join('.')] = {
              links: { self: null },
            };
          }
        } else {
          setRelationship(resource, resolved.relationshipPath, null);
        }
        break;
      }
      case 'move-relation': {
        const current = relationshipValues(resource.relationships, intent.field, options);
        const fromIndex = current.findIndex(
          (value) => isRecord(value) && value.id === intent.cardId,
        );
        if (fromIndex < 0) {
          throw sourceError(
            'commit',
            'card-source-relationship-card-missing',
            `Related Card ${JSON.stringify(intent.cardId)} is missing from ${JSON.stringify(intent.field)}.`,
          );
        }
        const order = current.map((_, index) => index);
        const [movedIndex] = order.splice(fromIndex, 1);
        order.splice(intent.toIndex, 0, movedIndex!);
        permuteRelationshipIndexes(
          resource,
          intent.field,
          new Map(order.map((oldIndex, newIndex) => [oldIndex, newIndex])),
        );
        break;
      }
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
