import {
  BOXEL_EXECUTION_PROTOCOL_VERSION,
  codeRefWithAbsoluteIdentifier,
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

import TrustedBaseFormat from '@cardstack/host/components/trusted-base-format';

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
  type CapsuleRenderSlot,
} from './capsule-component';
import { DefaultCapsuleComponentRuntime } from './capsule-component-runtime';

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
}

const trustedBaseFallbackRef: CodeRef = {
  module: 'https://cardstack.com/base/card-api' as RealmResourceIdentifier,
  name: 'CardDef',
};

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
  private renderSlots = new Map<
    BoxelInstanceHandle,
    Map<string, Promise<CapsuleRenderSlot>>
  >();

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
        resolvedField(fieldName, field, null, false),
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

  async buildRenderRecord(
    card: BoxelInstanceHandle,
  ): Promise<BoxelRenderRecord> {
    let instance = this.instances.get(card);
    return buildBoxelRenderRecord({
      boxel: await this.descriptionFor(instance.type),
      instanceId: instance.resource.id ?? null,
      fields: await this.fieldsFor(instance),
      presentation: await this.presentationFor(instance),
    });
  }

  async templateFor(
    card: BoxelInstanceHandle,
    format: string,
  ): Promise<CapsuleTemplateBundle> {
    let instance = this.instances.get(card);
    return this.evaluator.evaluateTemplate(
      instance.type.module,
      instance.type.name,
      format,
    );
  }

  getRenderSlot(
    card: BoxelInstanceHandle,
    format: string,
  ): Promise<CapsuleRenderSlot> {
    let byFormat = this.renderSlots.get(card);
    if (!byFormat) {
      byFormat = new Map();
      this.renderSlots.set(card, byFormat);
    }
    let existing = byFormat.get(format);
    if (existing) {
      return existing;
    }
    let slot = this.renderSlotFor(this.instances.get(card), format);
    byFormat.set(format, slot);
    void slot.catch(() => {
      if (byFormat?.get(format) === slot) {
        byFormat.delete(format);
      }
    });
    return slot;
  }

  private async renderSlotFor(
    instance: CapsuleInstanceState,
    format: string,
  ): Promise<CapsuleRenderSlot> {
    let metadata = await this.metadataFor(instance.type);
    if (!metadata.authoredTemplateFormats.includes(format)) {
      return createTrustedBaseRenderSlot(TrustedBaseFormat);
    }
    let bundle = await this.templateForHandle(instance, format);
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
      this.renderSlots.delete(handle as BoxelInstanceHandle);
      this.instances.release(handle);
    }
  }

  destroy(): void {
    this.types.clear();
    this.instances.clear();
    this.renderSlots.clear();
    this.componentRuntime.destroy();
    this.evaluator.destroy();
  }

  private async metadataFor(
    type: CapsuleTypeState,
  ): Promise<CapsuleCardTypeMetadata> {
    return (type.metadata ??= await this.evaluator.evaluateCardTypeMetadata(
      type.module,
      type.name,
    ));
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
    let formats = metadata.authoredTemplateFormats.map(
      (format): FormatDescription => ({
        format,
        provider: { kind: 'authored', ref: type.ref },
      }),
    );
    for (let format of [
      'isolated',
      'embedded',
      'fitted',
      'atom',
      'edit',
      'head',
      'markdown',
    ]) {
      if (!formats.some((item) => item.format === format)) {
        formats.push({
          format,
          provider: { kind: 'trusted-base', ref: trustedBaseFallbackRef },
        });
      }
    }
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
    let metadata = await this.metadataFor(instance.type);
    let projection = await this.projectionFor(instance);
    return Object.entries(metadata.fields).map(([fieldName, field]) =>
      resolvedField(
        fieldName,
        field,
        cloneJSONValue(projection[fieldName]),
        !field.isComputed && instance.purpose === 'interactive-edit',
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
        snapshot[fieldName] = data.map((identifier) =>
          projectRelationship(identifier),
        );
      } else if (data) {
        snapshot[fieldName] = projectRelationship(data);
      } else {
        snapshot[fieldName] = data ?? null;
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

function resolvedField(
  fieldName: string,
  metadata: CapsuleCardFieldMetadata,
  value: JSONValue | BoxelValueReference | BoxelValueReference[],
  writable: boolean,
): ResolvedField {
  return {
    fieldName,
    fieldType: trustedIdentityRef(metadata.type),
    kind: metadata.kind,
    value,
    resolvedConfiguration: null,
    presentation: metadata.displayName
      ? { displayName: metadata.displayName }
      : {},
    writable,
  };
}

function cloneJSONValue(value: unknown): JSONValue {
  if (value === undefined) {
    return null;
  }
  return structuredClone(value) as JSONValue;
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
