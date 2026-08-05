import {
  BOXEL_EXECUTION_PROTOCOL_VERSION,
  getAncestor,
  identifyCard,
  isBaseDefInstance,
  isFieldDef,
  isFileDef,
  loadCardDef,
  moduleFrom,
  type BoxelDescription,
  type BoxelKind,
  type BoxelRenderRecord,
  type BoxelValueReference,
  type CodeRef,
  type FieldDescription,
  type FormatDescription,
  type InstancePresentation,
  type JSONValue,
  type Loader,
  type LooseCardResource,
  type LooseSingleCardDocument,
  type PatchData,
  type RealmResourceIdentifier,
  type ResolvedField,
  type RuntimeHandle,
  type BoxelInstanceHandle,
  type BoxelTypeHandle,
} from '@cardstack/runtime-common';

import { buildBoxelRenderRecord } from './boxel-render-record';
import {
  RuntimeHandleRegistry,
  asBoxelInstanceHandle,
  asBoxelTypeHandle,
  type BoxelRuntime,
  type MaterializationPurpose,
} from './boxel-runtime';

import type {
  BaseDef,
  BaseDefConstructor,
  BoxComponent,
  Field,
} from '@cardstack/base/card-api';
import type * as CardAPI from '@cardstack/base/card-api';

export interface DirectRenderSlot {
  readonly owner: 'direct';
  readonly component: BoxComponent;
}

export interface DirectRenderSlotOptions {
  componentCodeRef?: CodeRef;
}

export interface DirectRenderRecordOptions {
  /**
   * Writability is contextual authority supplied by the Host. The semantic
   * runtime never infers permission merely because it can read a value.
   */
  writableFields?: ReadonlySet<string>;
}

type GetCardAPI = () => Promise<typeof CardAPI>;
type GetLoader = () => Loader;

/**
 * Trusted, in-process implementation of Boxel's semantic runtime.
 *
 * Cloneable descriptions and values leave this class through
 * `buildRenderRecord()`. Glimmer component definitions are retained in a
 * Host-local `DirectRenderSlot` and never appear in that boundary record.
 */
export default class DirectBoxelRuntime implements BoxelRuntime {
  readonly mode = 'direct' as const;

  private types = new RuntimeHandleRegistry<BaseDefConstructor>('direct-type');
  private instances = new RuntimeHandleRegistry<BaseDef>('direct-instance');
  private renderSlots = new WeakMap<
    BaseDef,
    Map<Field<BaseDefConstructor> | undefined, Map<string, DirectRenderSlot>>
  >();

  constructor(
    private getCardAPI: GetCardAPI,
    private getLoader?: GetLoader,
  ) {}

  async loadBoxel(ref: CodeRef): Promise<BoxelTypeHandle> {
    if (!this.getLoader) {
      throw new Error('Direct Boxel loading requires a Host Loader');
    }
    let type = await loadCardDef(ref, { loader: this.getLoader() });
    return asBoxelTypeHandle(this.types.add(type));
  }

  async createFromSerialized(
    resource: LooseCardResource,
    document: LooseSingleCardDocument,
    relativeTo: RealmResourceIdentifier | undefined,
    _purpose: MaterializationPurpose,
  ): Promise<BoxelInstanceHandle> {
    let api = await this.getCardAPI();
    let instance = await api.createFromSerialized(
      resource,
      document,
      relativeTo,
    );
    return asBoxelInstanceHandle(this.instances.add(instance));
  }

  async describeBoxel(boxel: BoxelTypeHandle): Promise<BoxelDescription> {
    let api = await this.getCardAPI();
    return this.describeBoxelType(this.types.get(boxel), api);
  }

  async getFields(
    boxel: BoxelTypeHandle | BoxelInstanceHandle,
  ): Promise<ResolvedField[]> {
    let api = await this.getCardAPI();
    let instance = boxel.startsWith('direct-type:')
      ? new (this.types.get(boxel))()
      : this.instances.get(boxel);
    return this.resolveFields(instance, api, undefined);
  }

  async getField(
    boxel: BoxelTypeHandle | BoxelInstanceHandle,
    fieldName: string,
  ): Promise<ResolvedField | undefined> {
    return (await this.getFields(boxel)).find(
      (field) => field.fieldName === fieldName,
    );
  }

  getRenderSlot(
    card: BaseDef,
    field?: Field<BaseDefConstructor>,
    options?: DirectRenderSlotOptions,
  ): DirectRenderSlot {
    let byField = this.renderSlots.get(card);
    if (!byField) {
      byField = new Map();
      this.renderSlots.set(card, byField);
    }
    let byCodeRef = byField.get(field);
    if (!byCodeRef) {
      byCodeRef = new Map();
      byField.set(field, byCodeRef);
    }
    let key = options?.componentCodeRef
      ? JSON.stringify(options.componentCodeRef)
      : '';
    let existing = byCodeRef.get(key);
    if (existing) {
      return existing;
    }

    // This is the only method in the first Direct slice that handles a live
    // component definition. It remains inside the trusted Host execution
    // owner and is intentionally absent from BoxelRenderRecord.
    let component = card.constructor.getComponent(card, field, options);
    let slot: DirectRenderSlot = {
      owner: 'direct',
      component,
    };
    byCodeRef.set(key, slot);
    return slot;
  }

  getRenderSlotForHandle(
    card: BoxelInstanceHandle,
    field?: Field<BaseDefConstructor>,
    options?: DirectRenderSlotOptions,
  ): DirectRenderSlot {
    return this.getRenderSlot(this.instances.get(card), field, options);
  }

  async buildRenderRecord(
    card: BoxelInstanceHandle,
  ): Promise<BoxelRenderRecord>;
  async buildRenderRecord(
    card: BaseDef,
    options?: DirectRenderRecordOptions,
  ): Promise<BoxelRenderRecord>;
  async buildRenderRecord(
    cardOrHandle: BaseDef | BoxelInstanceHandle,
    options: DirectRenderRecordOptions = {},
  ): Promise<BoxelRenderRecord> {
    let api = await this.getCardAPI();
    let card =
      typeof cardOrHandle === 'string'
        ? this.instances.get(cardOrHandle)
        : cardOrHandle;
    let boxel = this.describeBoxelType(card.constructor, api);
    let fields = this.resolveFields(card, api, options.writableFields);
    return buildBoxelRenderRecord({
      boxel,
      instanceId: boxelId(card),
      fields,
      presentation: instancePresentation(card, api),
    });
  }

  async serializeCard(
    card: BoxelInstanceHandle,
  ): Promise<LooseSingleCardDocument> {
    let api = await this.getCardAPI();
    return api.serializeCard(this.instances.get(card) as never, {
      includeComputeds: true,
      includeUnrenderedFields: true,
    });
  }

  async serializeCardPatch(
    card: BoxelInstanceHandle,
    changes: Record<string, JSONValue>,
  ): Promise<PatchData> {
    let instance = this.instances.get(card);
    let api = await this.getCardAPI();
    let fields = api.getFields(instance, {
      includeComputeds: true,
    }) as unknown as Record<string, Field>;
    let patch: PatchData = {};
    for (let [fieldName, value] of Object.entries(changes)) {
      let field = fields[fieldName];
      if (!field) {
        throw new Error(`Unknown field '${fieldName}'`);
      }
      if (field.computeVia) {
        throw new Error(`Computed field '${fieldName}' is not writable`);
      }
      if (field.fieldType === 'linksTo' || field.fieldType === 'linksToMany') {
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
    if (handle.startsWith('direct-type:')) {
      this.types.release(handle);
    } else if (handle.startsWith('direct-instance:')) {
      this.instances.release(handle);
    }
  }

  private describeBoxelType(
    boxelType: BaseDefConstructor,
    api: typeof CardAPI,
  ): BoxelDescription {
    let ref = requiredCodeRef(boxelType);
    let fields = Object.entries(
      api.getFields(boxelType, { includeComputeds: true }),
    ).map(([fieldName, field]): FieldDescription => {
      return {
        fieldName,
        fieldType: requiredCodeRef(field.card),
        kind: field.fieldType,
        isComputed: Boolean(field.computeVia),
      };
    });

    return {
      protocolVersion: BOXEL_EXECUTION_PROTOCOL_VERSION,
      requiredFeatures: [],
      ref,
      boxelKind: boxelKind(boxelType),
      ancestors: ancestorRefs(boxelType),
      fields,
      formats: formatDescriptions(boxelType, api.formats),
      presentation: {
        displayName:
          typeof boxelType.displayName === 'string'
            ? boxelType.displayName
            : boxelType.name,
        headerColor:
          typeof (boxelType as typeof boxelType & { headerColor?: unknown })
            .headerColor === 'string'
            ? (boxelType as typeof boxelType & { headerColor: string })
                .headerColor
            : null,
        prefersWideFormat:
          (boxelType as typeof boxelType & { prefersWideFormat?: unknown })
            .prefersWideFormat === true,
      },
      executionHints: {
        prefersFullSandbox:
          (boxelType as typeof boxelType & { prefersFullSandbox?: unknown })
            .prefersFullSandbox === true,
      },
    };
  }

  private resolveFields(
    instance: BaseDef,
    api: typeof CardAPI,
    writableFields: ReadonlySet<string> | undefined,
  ): ResolvedField[] {
    return Object.entries(
      api.getFields(instance, { includeComputeds: true }),
    ).map(([fieldName, field]): ResolvedField => {
      let description = api.getFieldDescription(instance, fieldName);
      let presentation: Record<string, JSONValue> = {};
      if (description) {
        presentation.description = description;
      }
      return {
        fieldName,
        fieldType: requiredCodeRef(field.card),
        kind: field.fieldType,
        value: projectValue(api.peekAtField(instance, fieldName)),
        resolvedConfiguration:
          projectJSONValue(api.resolveFieldConfiguration(field, instance)) ??
          null,
        presentation,
        writable:
          !field.computeVia && (writableFields?.has(fieldName) ?? false),
      };
    });
  }
}

function requiredCodeRef(boxelType: BaseDefConstructor): CodeRef {
  let ref = identifyCard(boxelType);
  if (!ref) {
    throw new Error(
      `Cannot describe Boxel type '${boxelType.name}' before it has a code reference`,
    );
  }
  return ref;
}

function boxelKind(boxelType: BaseDefConstructor): BoxelKind {
  if (isFileDef(boxelType)) {
    return 'file';
  }
  if (isFieldDef(boxelType)) {
    return 'field';
  }
  return 'card';
}

function ancestorRefs(boxelType: BaseDefConstructor): CodeRef[] {
  let result: CodeRef[] = [];
  let current = getAncestor(boxelType);
  while (current) {
    let ref = identifyCard(current);
    if (ref) {
      result.push(ref);
    }
    current = getAncestor(current);
  }
  return result;
}

function formatDescriptions(
  boxelType: BaseDefConstructor,
  knownFormats: string[],
): FormatDescription[] {
  return knownFormats.flatMap((format): FormatDescription[] => {
    let provider = formatProvider(boxelType, format);
    if (!provider) {
      return [];
    }
    let ref = identifyCard(provider);
    if (!ref) {
      return [];
    }
    return [
      {
        format,
        provider: {
          kind: isTrustedBaseRef(ref) ? 'trusted-base' : 'authored',
          ref,
        },
      },
    ];
  });
}

function formatProvider(
  boxelType: BaseDefConstructor,
  format: string,
): BaseDefConstructor | undefined {
  let current: BaseDefConstructor | undefined = boxelType;
  while (current) {
    if (Object.prototype.hasOwnProperty.call(current, format)) {
      return current;
    }
    current = getAncestor(current);
  }
  return undefined;
}

function isTrustedBaseRef(ref: CodeRef): boolean {
  let module = moduleFrom(ref);
  return (
    module.startsWith('@cardstack/base/') ||
    module.startsWith('https://cardstack.com/base/')
  );
}

function instancePresentation(
  instance: BaseDef,
  api: typeof CardAPI,
): InstancePresentation {
  return {
    title: stringField(instance, 'cardTitle', api),
    summary: stringField(instance, 'cardDescription', api),
    thumbnailURL: stringField(instance, 'cardThumbnailURL', api),
    theme: boxelReference(fieldValue(instance, 'cardTheme', api)),
  };
}

function stringField(
  instance: BaseDef,
  fieldName: string,
  api: typeof CardAPI,
): string | null {
  let value = fieldValue(instance, fieldName, api);
  return typeof value === 'string' ? value : null;
}

function fieldValue(
  instance: BaseDef,
  fieldName: string,
  api: typeof CardAPI,
): unknown {
  if (!(fieldName in api.getFields(instance, { includeComputeds: true }))) {
    return undefined;
  }
  return api.peekAtField(instance, fieldName);
}

function projectValue(
  value: unknown,
): JSONValue | BoxelValueReference | BoxelValueReference[] {
  if (isBaseDefInstance(value)) {
    return boxelReference(value)!;
  }
  if (Array.isArray(value) && value.every(isBaseDefInstance)) {
    return value.map((item) => boxelReference(item)!);
  }
  return projectJSONValue(value) ?? null;
}

function boxelReference(value: unknown): BoxelValueReference | null {
  if (!isBaseDefInstance(value)) {
    return null;
  }
  let ref = identifyCard(value.constructor as BaseDefConstructor);
  if (!ref) {
    return null;
  }
  return {
    $boxel: {
      id: boxelId(value),
      type: ref,
    },
  };
}

function boxelId(value: BaseDef): string | null {
  for (let key of ['id', 'url', 'sourceUrl']) {
    let candidate = (value as unknown as Record<string, unknown>)[key];
    if (typeof candidate === 'string') {
      return candidate;
    }
  }
  return null;
}

function projectJSONValue(
  value: unknown,
  seen = new WeakSet<object>(),
): JSONValue | undefined {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (value instanceof URL) {
    return value.href;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => projectJSONValue(item, seen) ?? null);
  }
  if (typeof value !== 'object' || value === undefined) {
    return undefined;
  }
  if (isBaseDefInstance(value)) {
    return boxelReference(value) as unknown as JSONValue;
  }
  if (seen.has(value)) {
    return null;
  }
  seen.add(value);
  let result: Record<string, JSONValue> = {};
  for (let [key, item] of Object.entries(value)) {
    let projected = projectJSONValue(item, seen);
    if (projected !== undefined) {
      result[key] = projected;
    }
  }
  seen.delete(value);
  return result;
}
