import { loadCardDef } from '@cardstack/runtime-common';
import type { LooseSingleCardDocument } from '@cardstack/runtime-common';
import type {
  BoxelDescription,
  BoxelInstanceHandle,
  BoxelRuntime,
  BoxelTypeHandle,
  InstanceProjection,
  MaterializationPurpose,
  ResolvedField,
  RuntimeHandle,
} from '@cardstack/runtime-common/boxel-execution-protocol';
import type { CodeRef } from '@cardstack/runtime-common/code-ref';
import type { Loader } from '@cardstack/runtime-common/loader';
import type { RealmResourceIdentifier } from '@cardstack/runtime-common/realm-identifiers';
import type { LooseCardResource } from '@cardstack/runtime-common/resource-types';

import {
  captureBoxelFields,
  captureBoxelType,
  captureInstanceProjection,
  captureUnresolvedFields,
} from './boxel-projection';
import { observeMissingProjectionPaths } from './boxel-projection-diagnostics';
import {
  buildBoxelDescription,
  buildInstanceProjection,
  buildResolvedFields,
} from './boxel-render-record';
import {
  RuntimeHandleRegistry,
  asBoxelInstanceHandle,
  asBoxelTypeHandle,
} from './boxel-runtime-handles';

import type {
  BaseDef,
  BaseDefConstructor,
  BoxComponent,
  CardStore,
  Field,
} from '@cardstack/base/card-api';
import type * as CardAPI from '@cardstack/base/card-api';

type GetCardAPI = () => Promise<typeof CardAPI>;
type GetLoader = () => Loader;

export interface DirectRenderComponentOptions {
  /**
   * Pins rendering to an ancestor class's format component (RP-1.3). No match
   * falls back to the instance's own class, which is main's behavior.
   */
  componentCodeRef?: CodeRef;
}

/**
 * The trusted tier: Host-owned code executing with the Host's own loader, Card
 * API, and DOM — exactly as main renders today (RP-15.1).
 *
 * Direct is the reference implementation of the runtime contract, not a bypass
 * around it. Everything it answers with goes through the same projection
 * pipeline every other tier's adapter will use, so a semantic that cannot be
 * expressed through these operations is an incomplete interface rather than a
 * special case for one tier — and the place to find that out is here, in the
 * tier that holds the live objects and could cheat, before a tier that cannot
 * is built against the gap.
 *
 * Two things this adapter deliberately does not own:
 *
 * - **Module loading.** `loadBoxel` goes through the Host's own Loader, which
 *   is what puts a module through main's canonical `transpileJS()` pipeline
 *   including `glimmer-scoped-css`. A card's scoped stylesheet is delivered by
 *   that pipeline's side-effect import before the importing module evaluates
 *   (RP-12.3); there is no second stylesheet compiler or selector rewriter
 *   here, and a card reached through this adapter is styled by the same
 *   mechanism as one reached by main.
 * - **The canonical Store.** The Store remains the single owner of card data
 *   and relationships. `retainInstance` is how a Host surface hands this
 *   runtime the Store's own instance; `createFromSerialized` materializes a
 *   document into whatever store this runtime was constructed with, which is
 *   what a tier with no access to the canonical one needs.
 *
 * Rendering is not one of the protocol's operations: a mountable component is
 * process-local and not cloneable, so it cannot be a member of a tier-neutral
 * interface (RP-14.2). `getRenderComponent` is this adapter's own render entry
 * point, beside the interface rather than in it.
 */
export default class DirectBoxelRuntime implements BoxelRuntime {
  readonly mode = 'direct' as const;

  private types = new RuntimeHandleRegistry<BaseDefConstructor>('direct-type');
  private instances = new RuntimeHandleRegistry<BaseDef>('direct-instance');
  /**
   * How many `projectInstance` calls this runtime has answered for each
   * instance.
   *
   * Keyed by instance rather than by handle so two handles naming one instance
   * order against each other, which is what a recipient holding a projection
   * from one surface and a newer one from another needs.
   *
   * Counting projections rather than reading a clock is what keeps record
   * parity reachable (RP-14.4): `revision` is a compared member — no path is
   * declared tier-specific — so a clock would make every tier's record differ
   * on something no tier controls. A count agrees across tiers only while they
   * all count the same event, which is why nothing but `projectInstance`
   * increments this: an operation that answers about declarations is not a
   * projection, and a tier whose `getField` quietly counted as one would
   * diverge from a tier whose did not.
   */
  private revisions = new WeakMap<BaseDef, number>();

  constructor(
    private getCardAPI: GetCardAPI,
    private getLoader: GetLoader,
    /**
     * The store materialized instances register in. Omitted, the Card API
     * supplies its own fallback store, which keeps those instances' identity
     * map local to this runtime rather than joining the canonical one.
     */
    private store?: CardStore,
  ) {}

  async loadBoxel(ref: CodeRef): Promise<BoxelTypeHandle> {
    let type = await loadCardDef(ref, { loader: this.getLoader() });
    return asBoxelTypeHandle(this.types.add(type as BaseDefConstructor));
  }

  /**
   * Materializes a document into an instance this runtime names.
   *
   * `purpose` reaches no decision here, and that is the honest answer for this
   * tier rather than an omission: main fails loudly on a definition it cannot
   * identify whatever the caller wanted it for — `createFromSerialized` throws
   * when `adoptsFrom` will not load — and the Host's chrome is what turns that
   * into an error card on an interactive surface. So Direct is lenient about
   * nothing, and there is no purpose it could be lenient for. The operation
   * carries it for the tiers that could be: a runtime unable to tell an
   * indexing pass from a display render lets an indexing failure ride as a
   * rendering failure, which is how one unidentifiable card takes a whole
   * indexing shard with it (RP-14.2).
   */
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
      this.store ? { store: this.store } : undefined,
    );
    return asBoxelInstanceHandle(this.instances.add(instance as BaseDef));
  }

  async describeBoxel(boxel: BoxelTypeHandle): Promise<BoxelDescription> {
    let api = await this.getCardAPI();
    if (!this.types.has(boxel)) {
      throw new Error(`Unknown or released Boxel type handle '${boxel}'`);
    }
    return buildBoxelDescription(captureBoxelType(this.types.get(boxel), api));
  }

  /**
   * The instance's fields, or — handed a type — the type's fields with nothing
   * resolved against an instance.
   *
   * Those are different answers to different questions, not one answer with a
   * part missing: configuration resolves with the owning root instance as
   * `this` (RP-5.1), so a type has no configuration to report rather than an
   * unresolved one.
   */
  async getFields(
    boxel: BoxelTypeHandle | BoxelInstanceHandle,
  ): Promise<ResolvedField[]> {
    let api = await this.getCardAPI();
    if (this.types.has(boxel)) {
      return buildResolvedFields(
        captureUnresolvedFields(this.types.get(boxel), api),
      );
    }
    if (!this.instances.has(boxel)) {
      // Named here rather than left to a registry, which would report whichever
      // one happened to be asked last — a `direct-type:` handle diagnosed as an
      // unknown instance sends its reader looking in the wrong place.
      throw new Error(`Unknown or released Boxel handle '${boxel}'`);
    }
    // Captured on its own rather than pulled out of a render record. A field
    // list is a question about declarations, and building the whole record to
    // answer it would evaluate every computed field and derive presentation
    // for values the caller never asked for — so one field's configuration
    // could not be read at all when an unrelated `computeVia` throws. It would
    // also count as a projection, and `revision` orders projections.
    return buildResolvedFields(
      captureBoxelFields(this.instances.get(boxel), api),
    );
  }

  async getField(
    boxel: BoxelTypeHandle | BoxelInstanceHandle,
    fieldName: string,
  ): Promise<ResolvedField | undefined> {
    return (await this.getFields(boxel)).find(
      (field) => field.fieldName === fieldName,
    );
  }

  async projectInstance(
    instance: BoxelInstanceHandle,
  ): Promise<InstanceProjection> {
    return this.projectionFor(this.instances.get(instance));
  }

  /**
   * A development-only view of a projection that reports the paths a render
   * read and the record does not carry.
   *
   * Offered here rather than applied to what `projectInstance` returns,
   * because what it returns is a Proxy and a projection is data: a record that
   * crossed a boundary as a wrapper would be neither cloneable nor comparable,
   * and a producer wrapping its own output is how a live object gets into one.
   * So the consumer that is about to *read* a projection asks for the watched
   * view, and everything that stores, clones or sends it keeps the record.
   *
   * The runtime supplies the two members a caller cannot: the type the
   * projection describes and the mode that produced it, which together
   * separate "the pipeline does not project this" from "this tier dropped it".
   */
  watchProjectionPaths(
    projection: InstanceProjection,
    format: string,
  ): InstanceProjection {
    return observeMissingProjectionPaths(projection, {
      type: projection.type,
      format,
      mode: this.mode,
      root: 'projection',
    });
  }

  /**
   * The instance as a document.
   *
   * Absolute module identities, because a document that crosses is read by a
   * consumer that must never derive a module base from an instance id
   * (RP-8.4). Computeds and unrendered fields are both included: this states
   * everything the instance currently holds, for a consumer that will
   * materialize it, rather than the save-shaped subset a write sends (RP-9.6).
   *
   * Query-backed fields are omitted, as they are on every other path that
   * serializes a card. Their membership is a live search result, not state the
   * instance holds — serializing it would freeze a snapshot into
   * `relationships`, and a consumer materializing that document would get a
   * declared link where main has a query: editable where RP-7.6 says never,
   * and stale the moment the search moves.
   */
  async serializeCard(
    instance: BoxelInstanceHandle,
  ): Promise<LooseSingleCardDocument> {
    let api = await this.getCardAPI();
    let card = this.instances.get(instance);
    if (!api.isCard(card)) {
      // A document is a card's shape. A field instance has no id and no local
      // id, so serializing one builds `{type: 'card', lid: undefined}` and
      // dies inside the document check with a shape dump that names neither
      // the handle nor the reason — where this names both. `retainInstance`
      // takes any `BaseDef` and the pipeline describes field instances
      // (`boxelKind` answers `'field'`), so a field handle reaching here is a
      // caller mistake rather than an impossibility.
      throw new Error(
        `Boxel instance handle '${instance}' names a ${card.constructor.name}, which is not a card and has no document form`,
      );
    }
    return api.serializeCard(card as never, {
      includeComputeds: true,
      includeUnrenderedFields: true,
      useAbsoluteURL: true,
      omitQueryFields: true,
    });
  }

  /**
   * Releases a handle, whichever registry issued it.
   *
   * Both registries are asked because the operation takes a `RuntimeHandle`
   * and the two kinds are one type to a caller. Releasing a handle a registry
   * never issued is a no-op there, so this cannot revoke the wrong thing: the
   * prefixes are distinct, so at most one registry holds any given handle.
   */
  async dispose(handle: RuntimeHandle): Promise<void> {
    this.types.release(handle);
    this.instances.release(handle);
  }

  /**
   * Names an instance this runtime did not materialize — the canonical
   * Store's own.
   *
   * Beside the interface rather than in it: a live instance is not cloneable,
   * so no cross-boundary operation could accept one. Direct is the tier that
   * shares a process with the Store, and re-deserializing the Store's instance
   * to give this runtime a handle would produce a second object with the same
   * data and none of the identity, lazy relationships, or mutation context
   * that make it the canonical one.
   */
  retainInstance(instance: BaseDef): BoxelInstanceHandle {
    return asBoxelInstanceHandle(this.instances.add(instance));
  }

  /**
   * The mountable component for an instance, from main's own entry point.
   *
   * `getComponent` is memoized per `(model, componentCodeRef)` so reactive
   * re-renders never remount the tree (RP-1.1), and going through it is what
   * makes a Direct render the render main performs — same component identity,
   * same `Box` chain, same scoped stylesheets. Model and field bindings stay
   * paths resolved per render through that chain; the record this runtime
   * projects is data *about* the instance, never the source a binding reads.
   */
  getRenderComponent(
    instance: BoxelInstanceHandle,
    field?: Field<BaseDefConstructor>,
    options?: DirectRenderComponentOptions,
  ): BoxComponent {
    let card = this.instances.get(instance);
    return card.constructor.getComponent(card, field, options);
  }

  private async projectionFor(instance: BaseDef) {
    let api = await this.getCardAPI();
    let revision = (this.revisions.get(instance) ?? 0) + 1;
    this.revisions.set(instance, revision);
    return buildInstanceProjection(
      captureInstanceProjection(instance, api),
      revision,
    );
  }
}
