import {
  loadCardDef,
  type BoxelDescription,
  type BoxelRenderRecord,
  type CodeRef,
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

import {
  describeBoxelType,
  projectHostBoxelSemantics,
  resolveBoxelFields,
} from './boxel-projection';
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
 * `buildRenderRecord()`, whose inputs come from the shared Host projection
 * pipeline in `boxel-projection.ts`. Glimmer component definitions are
 * retained in a Host-local `DirectRenderSlot` and never appear in that
 * boundary record.
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

  /**
   * Retain the canonical Store-backed instance for a trusted Direct render.
   *
   * Direct must preserve the Store's identity map, lazy relationships, and
   * mutation contexts. Re-deserializing into Card API's fallback store would
   * create a visually similar but semantically incomplete clone.
   */
  retainCanonicalInstance(instance: BaseDef): BoxelInstanceHandle {
    return asBoxelInstanceHandle(this.instances.addDistinct(instance));
  }

  async describeBoxel(boxel: BoxelTypeHandle): Promise<BoxelDescription> {
    let api = await this.getCardAPI();
    return describeBoxelType(this.types.get(boxel), api);
  }

  async getFields(
    boxel: BoxelTypeHandle | BoxelInstanceHandle,
  ): Promise<ResolvedField[]> {
    let api = await this.getCardAPI();
    let instance = boxel.startsWith('direct-type:')
      ? new (this.types.get(boxel))()
      : this.instances.get(boxel);
    return resolveBoxelFields(instance, api);
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
    return buildBoxelRenderRecord(
      projectHostBoxelSemantics(card, api, {
        writableFields: options.writableFields,
      }),
    );
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
}
