import {
  loadCardDef,
  type BoxelDescription,
  type BoxelRenderRecord,
  type CodeRef,
  type Loader,
  type LooseCardResource,
  type LooseSingleCardDocument,
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
  /**
   * Sandbox HMR: the exact arguments used to create each live instance,
   * retained for `redeserialize()`. Only the Sandbox child's own
   * `DirectBoxelRuntime` ever calls `redeserialize`; on the Host's own
   * Direct tier this map is simply unused (trusted modules use ordinary
   * Ember reactivity, not module invalidation).
   */
  private creationArgs = new Map<
    BoxelInstanceHandle,
    {
      resource: LooseCardResource;
      document: LooseSingleCardDocument;
      relativeTo: RealmResourceIdentifier | undefined;
    }
  >();

  constructor(
    private getCardAPI: GetCardAPI,
    private getLoader?: GetLoader,
    /**
     * Normalizes an absolute instance URL to its registered scoped-identifier
     * form (see `HostBoxelProjectionOptions.unresolveURL` in
     * `boxel-projection.ts`) — needed so a themed card's `data-boxel-theme-
     * scope` token matches the id form its theme stylesheet was compiled
     * against, the same as the Capsule tier derives it. Omit to leave
     * instance ids unnormalized.
     */
    private unresolveURL?: (url: string) => string,
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
    let handle = asBoxelInstanceHandle(this.instances.add(instance));
    this.creationArgs.set(handle, { resource, document, relativeTo });
    return handle;
  }

  /**
   * Sandbox HMR: re-derives the instance at `handle` from the identical
   * serialized document used to create it, replacing it under the SAME
   * handle (`RuntimeHandleRegistry.replace`) — every consumer that already
   * holds this handle (the parent's session, an in-flight RPC) keeps
   * working unchanged. Callers are expected to have just invalidated and
   * re-imported the edited module first (`Loader.invalidateModule`); this
   * method only re-runs deserialization, it does not touch module state.
   * Data state survives because it is re-derived from the identical
   * document, not copied from the old instance — only the instance's
   * class/component identity can change.
   */
  async redeserialize(handle: BoxelInstanceHandle): Promise<void> {
    let args = this.creationArgs.get(handle);
    if (!args) {
      throw new Error(
        `Cannot redeserialize unknown Boxel instance handle '${handle}'`,
      );
    }
    let api = await this.getCardAPI();
    let instance = await api.createFromSerialized(
      args.resource,
      args.document,
      args.relativeTo,
    );
    this.instances.replace(handle, instance);
  }

  /**
   * RP-20.5 parent→child instance push: apply a freshly serialized document
   * to the instance at `handle` IN PLACE (`updateFromSerialized` — the same
   * mechanism main's Store uses for a realm-event reload). The instance's
   * identity — and therefore its mounted component and DOM — survives;
   * tracking re-renders the bindings whose data changed. `creationArgs` is
   * refreshed so a later HMR `redeserialize()` re-derives from the CURRENT
   * data rather than resurrecting the mount-time snapshot.
   */
  async updateInstanceDocument(
    handle: BoxelInstanceHandle,
    document: LooseSingleCardDocument,
  ): Promise<void> {
    let args = this.creationArgs.get(handle);
    if (!args) {
      throw new Error(
        `Cannot update unknown Boxel instance handle '${handle}'`,
      );
    }
    let instance = this.instances.get(handle);
    let api = await this.getCardAPI();
    await api.updateFromSerialized(instance as never, document);
    this.creationArgs.set(handle, {
      resource: document.data as LooseCardResource,
      document,
      relativeTo: args.relativeTo,
    });
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
  async buildRenderRecord(card: BaseDef): Promise<BoxelRenderRecord>;
  async buildRenderRecord(
    cardOrHandle: BaseDef | BoxelInstanceHandle,
  ): Promise<BoxelRenderRecord> {
    let api = await this.getCardAPI();
    let card =
      typeof cardOrHandle === 'string'
        ? this.instances.get(cardOrHandle)
        : cardOrHandle;
    return buildBoxelRenderRecord(
      projectHostBoxelSemantics(card, api, {
        unresolveURL: this.unresolveURL,
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

  async dispose(handle: RuntimeHandle): Promise<void> {
    if (handle.startsWith('direct-type:')) {
      this.types.release(handle);
    } else if (handle.startsWith('direct-instance:')) {
      this.instances.release(handle);
      this.creationArgs.delete(handle as BoxelInstanceHandle);
    }
  }
}
