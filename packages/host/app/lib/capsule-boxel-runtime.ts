import {
  BOXEL_EXECUTION_PROTOCOL_VERSION,
  codeRefWithAbsoluteIdentifier,
  fieldDefFormats,
  formats as renderableFormats,
  normalizeCodeRef,
  type BoxelDescription,
  type BoxelInstanceHandle,
  type BoxelRenderRecord,
  type BoxelTypeHandle,
  type BoxelValueReference,
  type CodeRef,
  type FieldDescription,
  type FormatDescription,
  type InstancePresentation,
  type JSONValue,
  type LooseCardResource,
  type LooseSingleCardDocument,
  type PatchData,
  type RealmResourceIdentifier,
  type ResolvedField,
  type RuntimeHandle,
} from '@cardstack/runtime-common';

import { buildBoxelRenderRecord } from './boxel-render-record';
import {
  RuntimeHandleRegistry,
  asBoxelInstanceHandle,
  asBoxelTypeHandle,
  type BoxelRuntime,
  type MaterializationPurpose,
} from './boxel-runtime';
import {
  createCapsuleRenderSlot,
  createTrustedBaseRenderSlot,
  type CapsuleRuntimeRenderSlot,
} from './capsule-component';
import { DefaultCapsuleComponentRuntime } from './capsule-component-runtime';

import type { HostBoxelProjection } from './boxel-projection';

import type CapsuleModuleEvaluator from './capsule-module-evaluator';
import type {
  CapsuleCardFieldMetadata,
  CapsuleCardTypeMetadata,
  CapsuleTemplateBundle,
} from './capsule-module-evaluator';

interface CapsuleTypeState {
  ref: CodeRef;
  module: string;
  name: string;
  metadata?: CapsuleCardTypeMetadata;
}

interface CapsuleInstanceState {
  type: CapsuleTypeState;
  resource: LooseCardResource;
  document: LooseSingleCardDocument;
  relativeTo: RealmResourceIdentifier | undefined;
  purpose: MaterializationPurpose;
  projection?: Record<string, unknown>;
  hostProjection?: HostBoxelProjection;
}

function trustedBaseFallbackRef(
  definitionKind: CapsuleCardTypeMetadata['definitionKind'],
): CodeRef {
  let name =
    definitionKind === 'field'
      ? 'FieldDef'
      : definitionKind === 'file'
        ? 'FileDef'
        : 'CardDef';
  return {
    module: 'https://cardstack.com/base/card-api' as RealmResourceIdentifier,
    name,
  };
}

/**
 * Boxel's semantic adapter over one principal-owned SES Capsule.
 *
 * The evaluator owns executable classes, getters, computeVia functions, and
 * templates. This adapter owns only opaque handles and cloneable records.
 */
export default class CapsuleBoxelRuntime implements BoxelRuntime {
  readonly mode = 'capsule' as const;

  private types = new RuntimeHandleRegistry<CapsuleTypeState>('capsule-type');
  private instances = new RuntimeHandleRegistry<CapsuleInstanceState>(
    'capsule-instance',
  );
  private componentRuntime: DefaultCapsuleComponentRuntime;
  private metadata = new Map<string, Promise<CapsuleCardTypeMetadata>>();
  private renderSlots = new Map<string, Promise<CapsuleRuntimeRenderSlot>>();

  constructor(
    readonly evaluator: CapsuleModuleEvaluator,
    private readonly loadTrustedModule: (
      moduleIdentifier: string,
    ) => Promise<Record<string, unknown>> = () =>
      Promise.reject(
        new Error('Capsule trusted module loader is not configured'),
      ),
  ) {
    this.componentRuntime = new DefaultCapsuleComponentRuntime(evaluator);
  }

  async loadBoxel(ref: CodeRef): Promise<BoxelTypeHandle> {
    let { module, name } = normalizeCodeRef(ref);
    return asBoxelTypeHandle(this.types.add({ ref, module, name }));
  }

  async createFromSerialized(
    resource: LooseCardResource,
    document: LooseSingleCardDocument,
    relativeTo: RealmResourceIdentifier | undefined,
    purpose: MaterializationPurpose,
  ): Promise<BoxelInstanceHandle> {
    let ref = resource.meta?.adoptsFrom;
    if (!ref) {
      throw new Error('Cannot create a Capsule Boxel without adoptsFrom');
    }
    let resolvedRef = codeRefWithAbsoluteIdentifier(ref, relativeTo, undefined);
    let { module, name } = normalizeCodeRef(resolvedRef);
    let type: CapsuleTypeState = {
      ref: resolvedRef,
      module,
      name,
    };
    let instance: CapsuleInstanceState = {
      type,
      resource: structuredClone(resource),
      document: structuredClone(document),
      relativeTo,
      purpose,
    };
    return asBoxelInstanceHandle(this.instances.add(instance));
  }

  async describeBoxel(boxel: BoxelTypeHandle): Promise<BoxelDescription> {
    let type = this.types.get(boxel);
    return this.descriptionFor(type);
  }

  async getFields(
    boxel: BoxelTypeHandle | BoxelInstanceHandle,
  ): Promise<ResolvedField[]> {
    if (boxel.startsWith('capsule-type:')) {
      let type = this.types.get(boxel);
      let metadata = await this.metadataFor(type);
      return Object.entries(metadata.fields).map(([fieldName, field]) =>
        resolvedField(fieldName, field, null),
      );
    }
    let instance = this.instances.get(boxel);
    return this.fieldsFor(instance);
  }

  async getField(
    boxel: BoxelTypeHandle | BoxelInstanceHandle,
    fieldName: string,
  ): Promise<ResolvedField | undefined> {
    return (await this.getFields(boxel)).find(
      (field) => field.fieldName === fieldName,
    );
  }

  /**
   * Adopt the Host's semantic projection of the canonical instance.
   *
   * Trusted-Base semantics (descriptions, resolved configuration, linked
   * value references, presentation) materialize exactly once, Host-side, and
   * cross this adapter as data (RP-5.4). The Capsule evaluator continues to
   * own authored execution: templates, getters, computeVia, and actions.
   */
  adoptHostProjection(
    card: BoxelInstanceHandle,
    projection: HostBoxelProjection,
  ): void {
    let instance = this.instances.get(card);
    instance.hostProjection = structuredClone(projection);
  }

  async buildRenderRecord(
    card: BoxelInstanceHandle,
  ): Promise<BoxelRenderRecord> {
    let instance = this.instances.get(card);
    let projection = await this.projectionFor(instance);
    let host = instance.hostProjection;
    if (host) {
      return buildBoxelRenderRecord({
        boxel: host.boxel,
        instanceId: host.instanceId,
        fields: host.fields,
        presentation: host.presentation,
        modelExtensions: cloneJSONRecord(projection),
      });
    }
    return buildBoxelRenderRecord({
      boxel: await this.descriptionFor(instance.type),
      instanceId: instance.resource.id ?? null,
      fields: await this.fieldsFor(instance),
      presentation: await this.presentationFor(instance),
      modelExtensions: cloneJSONRecord(projection),
    });
  }

  getRenderSlot(
    card: BoxelInstanceHandle,
    format: string,
  ): Promise<CapsuleRuntimeRenderSlot> {
    let instance = this.instances.get(card);
    let key = typeKey(instance.type, format);
    let existing = this.renderSlots.get(key);
    if (existing) {
      return existing;
    }
    let slot = this.renderSlotFor(instance, format);
    this.renderSlots.set(key, slot);
    void slot.catch(() => {
      if (this.renderSlots.get(key) === slot) {
        this.renderSlots.delete(key);
      }
    });
    return slot;
  }

  private async renderSlotFor(
    instance: CapsuleInstanceState,
    format: string,
  ): Promise<CapsuleRuntimeRenderSlot> {
    let metadata = await this.metadataFor(instance.type);
    if (!metadata.authoredTemplateFormats.includes(format)) {
      return createTrustedBaseRenderSlot(
        trustedBaseFallbackRef(metadata.definitionKind),
      );
    }
    let bundle: CapsuleTemplateBundle;
    try {
      bundle = await this.templateForHandle(instance, format);
    } catch (error) {
      throw new Error(
        `Unable to capture ${instance.type.module}#${instance.type.name} ${format} template: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return createCapsuleRenderSlot(
      this.componentRuntime,
      bundle,
      this.loadTrustedModule,
    );
  }

  private templateForHandle(
    instance: CapsuleInstanceState,
    format: string,
  ): Promise<CapsuleTemplateBundle> {
    return this.evaluator.evaluateTemplate(
      instance.type.module,
      instance.type.name,
      format,
    );
  }

  async serializeCard(
    card: BoxelInstanceHandle,
  ): Promise<LooseSingleCardDocument> {
    let instance = this.instances.get(card);
    let projection = await this.projectionFor(instance);
    let document = structuredClone(instance.document);
    document.data.attributes = {
      ...(document.data.attributes ?? {}),
      ...projection,
    };
    return document;
  }

  async serializeCardPatch(
    card: BoxelInstanceHandle,
    changes: Record<string, JSONValue>,
  ): Promise<PatchData> {
    let instance = this.instances.get(card);
    let metadata = await this.metadataFor(instance.type);
    let patch: PatchData = {};
    for (let [fieldName, value] of Object.entries(changes)) {
      let field = metadata.fields[fieldName];
      if (!field) {
        throw new Error(`Unknown field '${fieldName}'`);
      }
      if (field.kind === 'linksTo' || field.kind === 'linksToMany') {
        patch.relationships ??= {};
        patch.relationships[fieldName] = value as never;
      } else {
        patch.attributes ??= {};
        patch.attributes[fieldName] = value;
      }
    }
    return patch;
  }

  async dispose(handle: RuntimeHandle): Promise<void> {
    if (handle.startsWith('capsule-type:')) {
      this.types.release(handle);
    } else if (handle.startsWith('capsule-instance:')) {
      this.instances.release(handle);
    }
  }

  destroy(): void {
    this.types.clear();
    this.instances.clear();
    this.metadata.clear();
    this.renderSlots.clear();
    this.componentRuntime.destroy();
    this.evaluator.destroy();
  }

  private async metadataFor(
    type: CapsuleTypeState,
  ): Promise<CapsuleCardTypeMetadata> {
    if (type.metadata) {
      return type.metadata;
    }
    let key = typeKey(type);
    let metadata = this.metadata.get(key);
    if (!metadata) {
      metadata = this.evaluator.evaluateCardTypeMetadata(
        type.module,
        type.name,
      );
      this.metadata.set(key, metadata);
      void metadata.catch(() => {
        if (this.metadata.get(key) === metadata) {
          this.metadata.delete(key);
        }
      });
    }
    return (type.metadata = await metadata);
  }

  private async descriptionFor(
    type: CapsuleTypeState,
  ): Promise<BoxelDescription> {
    let metadata = await this.metadataFor(type);
    let fields = Object.entries(metadata.fields).map(
      ([fieldName, field]): FieldDescription => ({
        fieldName,
        fieldType: trustedIdentityRef(field.type),
        kind: field.kind,
        isComputed: field.isComputed,
      }),
    );
    let formats = formatDescriptionsFor(type, metadata);
    return {
      protocolVersion: BOXEL_EXECUTION_PROTOCOL_VERSION,
      requiredFeatures: [],
      ref: type.ref,
      boxelKind: metadata.definitionKind,
      ancestors: metadata.ancestorTypes.map(trustedIdentityRef),
      fields,
      formats,
      presentation: {
        displayName: metadata.displayName ?? type.name,
        headerColor: metadata.headerColor,
        prefersWideFormat: metadata.prefersWideFormat,
      },
      executionHints: {
        prefersFullSandbox: metadata.prefersFullSandbox,
      },
    };
  }

  private async projectionFor(
    instance: CapsuleInstanceState,
  ): Promise<Record<string, unknown>> {
    return (instance.projection ??= await this.evaluator.evaluateCardProjection(
      instance.type.module,
      instance.type.name,
      snapshotFromResource(instance.resource, instance.document),
    ));
  }

  private async fieldsFor(
    instance: CapsuleInstanceState,
  ): Promise<ResolvedField[]> {
    if (instance.hostProjection) {
      return structuredClone(instance.hostProjection.fields);
    }
    let metadata = await this.metadataFor(instance.type);
    let projection = await this.projectionFor(instance);
    return Object.entries(metadata.fields).map(([fieldName, field]) =>
      resolvedField(
        fieldName,
        field,
        projectedFieldValue(field, projection[fieldName]),
      ),
    );
  }

  private async presentationFor(
    instance: CapsuleInstanceState,
  ): Promise<InstancePresentation> {
    let projection = await this.projectionFor(instance);
    return {
      title: stringOrNull(projection.cardTitle),
      summary: stringOrNull(projection.cardDescription),
      thumbnailURL: stringOrNull(projection.cardThumbnailURL),
      theme: boxelReferenceOrNull(projection.cardTheme),
    };
  }
}

/**
 * Assemble the format inventory in the shared pipeline's shape and order:
 * iterate the renderable inventory, attribute each authored format to the
 * evaluated type, and fall back to the trusted Base provider for the formats
 * that tier of definition declares (RP-2.2, RP-2.3). This mirrors Direct's
 * prototype-chain discovery over the declared vocabulary instead of a
 * hard-coded format list.
 */
function formatDescriptionsFor(
  type: CapsuleTypeState,
  metadata: CapsuleCardTypeMetadata,
): FormatDescription[] {
  let trusted =
    metadata.definitionKind === 'field'
      ? fieldDefFormats
      : metadata.definitionKind === 'file'
        ? renderableFormats.filter((format) => format !== 'head')
        : renderableFormats;
  return renderableFormats.flatMap((format): FormatDescription[] => {
    if (metadata.authoredTemplateFormats.includes(format)) {
      return [{ format, provider: { kind: 'authored', ref: type.ref } }];
    }
    if (trusted.includes(format)) {
      return [
        {
          format,
          provider: {
            kind: 'trusted-base',
            ref: trustedBaseFallbackRef(metadata.definitionKind),
          },
        },
      ];
    }
    return [];
  });
}

function typeKey(type: CapsuleTypeState, format?: string): string {
  return `${type.module}#${type.name}${format ? `:${format}` : ''}`;
}

function trustedIdentityRef(identity: {
  module: string;
  name: string;
}): CodeRef {
  return {
    module: identity.module as RealmResourceIdentifier,
    name: identity.name,
  };
}

function snapshotFromResource(
  resource: LooseCardResource,
  document: LooseSingleCardDocument,
): Record<string, unknown> {
  let included = new Map<string, LooseCardResource>();
  for (let candidate of document.included ?? []) {
    if (
      candidate &&
      typeof candidate === 'object' &&
      'type' in candidate &&
      candidate.type === 'card' &&
      'id' in candidate &&
      typeof candidate.id === 'string'
    ) {
      included.set(candidate.id, candidate as LooseCardResource);
    }
  }

  let visiting = new Set<string>();
  let project = (candidate: LooseCardResource): Record<string, unknown> => {
    let snapshot: Record<string, unknown> = {
      ...(candidate.attributes ?? {}),
    };
    if (candidate.id) {
      snapshot.id = candidate.id;
    }
    for (let [fieldName, relationship] of Object.entries(
      candidate.relationships ?? {},
    )) {
      let data = Array.isArray(relationship)
        ? relationship.flatMap((entry) =>
            Array.isArray(entry.data)
              ? entry.data
              : entry.data
                ? [entry.data]
                : [],
          )
        : relationship.data;
      if (Array.isArray(data)) {
        setSnapshotPath(
          snapshot,
          fieldName,
          data.map((identifier) => projectRelationship(identifier)),
        );
      } else if (data) {
        setSnapshotPath(snapshot, fieldName, projectRelationship(data));
      } else {
        setSnapshotPath(snapshot, fieldName, data ?? null);
      }
    }
    return snapshot;
  };
  let projectRelationship = (identifier: {
    id?: string;
    lid?: string;
    type: string;
  }): Record<string, unknown> => {
    let id = identifier.id ?? identifier.lid;
    if (!id) {
      return {};
    }
    let linked = included.get(id);
    if (!linked || visiting.has(id)) {
      return { id };
    }
    visiting.add(id);
    try {
      return project(linked);
    } finally {
      visiting.delete(id);
    }
  };

  return project(resource);
}

/**
 * JSON:API relationship keys preserve the complete Boxel field path. Rebuild
 * that path in the bounded model instead of exposing a literal dotted key.
 * This is what makes nested links such as `cardInfo.guide` visible to authored
 * Capsule getters without transferring a live Store-backed object graph.
 */
function setSnapshotPath(
  snapshot: Record<string, unknown>,
  fieldPath: string,
  value: unknown,
): void {
  let segments = fieldPath.split('.');
  let target = snapshot;
  for (let segment of segments.slice(0, -1)) {
    let existing = target[segment];
    if (
      existing === null ||
      typeof existing !== 'object' ||
      Array.isArray(existing)
    ) {
      existing = {};
      target[segment] = existing;
    }
    target = existing as Record<string, unknown>;
  }
  target[segments[segments.length - 1]!] = value;
}

/**
 * The Host-less fallback projection of one field, shaped identically to the
 * shared pipeline's `ResolvedField`. Configuration and field descriptions
 * require the canonical instance, so without an adopted Host projection they
 * resolve to their empty values; writability always requires an explicit Host
 * grant and therefore defaults to false (RP-9.1).
 */
function resolvedField(
  fieldName: string,
  metadata: CapsuleCardFieldMetadata,
  value: JSONValue | BoxelValueReference | BoxelValueReference[],
): ResolvedField {
  return {
    fieldName,
    fieldType: trustedIdentityRef(metadata.type),
    kind: metadata.kind,
    value,
    resolvedConfiguration: null,
    presentation: {},
    writable: false,
  };
}

/**
 * Project a bounded evaluator value into the record's canonical value shape:
 * nested Boxel values cross as `BoxelValueReference` references, never
 * expanded object graphs (RP-14.1). Without the canonical instance the
 * declared field type stands in for the runtime class, and a composite is
 * recognized by its object shape; the adopted Host projection supplies the
 * exact reference for every production render.
 */
function projectedFieldValue(
  metadata: CapsuleCardFieldMetadata,
  value: unknown,
): JSONValue | BoxelValueReference | BoxelValueReference[] {
  if (metadata.kind === 'linksTo') {
    return referenceFor(metadata, value);
  }
  if (metadata.kind === 'linksToMany') {
    if (!Array.isArray(value)) {
      return value === undefined || value === null
        ? null
        : cloneJSONValue(value);
    }
    return value.map(
      (entry) => referenceFor(metadata, entry) ?? nullReference(metadata),
    );
  }
  if (isCompositeSnapshot(value)) {
    return referenceFor(metadata, value);
  }
  if (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(isCompositeSnapshot)
  ) {
    return value.map(
      (entry) => referenceFor(metadata, entry) ?? nullReference(metadata),
    );
  }
  return cloneJSONValue(value);
}

function referenceFor(
  metadata: CapsuleCardFieldMetadata,
  value: unknown,
): BoxelValueReference | null {
  if (value === undefined || value === null) {
    return null;
  }
  let id =
    typeof value === 'object' && 'id' in (value as Record<string, unknown>)
      ? (value as Record<string, unknown>).id
      : null;
  return {
    $boxel: {
      id: typeof id === 'string' ? id : null,
      type: trustedIdentityRef(metadata.type),
    },
  };
}

function nullReference(
  metadata: CapsuleCardFieldMetadata,
): BoxelValueReference {
  return { $boxel: { id: null, type: trustedIdentityRef(metadata.type) } };
}

function isCompositeSnapshot(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneJSONValue(value: unknown): JSONValue {
  if (value === undefined) {
    return null;
  }
  return structuredClone(value) as JSONValue;
}

function cloneJSONRecord(
  value: Record<string, unknown>,
): Record<string, JSONValue> {
  return structuredClone(value) as Record<string, JSONValue>;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function boxelReferenceOrNull(value: unknown): BoxelValueReference | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  let candidate = value as {
    id?: unknown;
    type?: unknown;
    $boxel?: unknown;
  };
  if (candidate.$boxel) {
    return structuredClone(value) as BoxelValueReference;
  }
  if (typeof candidate.type !== 'object' || candidate.type === null) {
    return null;
  }
  return {
    $boxel: {
      id: typeof candidate.id === 'string' ? candidate.id : null,
      type: candidate.type as CodeRef,
    },
  };
}
