import Route from '@ember/routing/route';
import type Transition from '@ember/routing/transition';

import { service } from '@ember/service';

import { isEqual } from 'lodash-es';

import type { CodeRef } from '@cardstack/runtime-common';
import {
  baseRef,
  identifyCard,
  internalKeyFor,
  logger,
  maybeRelativeReference,
  relationshipEntries,
  realmURL,
  snapshotRuntimeDependencies,
  type SingleCardDocument,
  type PrerenderMeta,
  type PrerenderMetaDiagnostics,
  type RenderError,
} from '@cardstack/runtime-common';

import type CardService from '@cardstack/host/services/card-service';
import type NetworkService from '@cardstack/host/services/network';

import type {
  BaseDef,
  CardDef,
  ComputePassSnapshot,
} from 'https://cardstack.com/base/card-api';

import { friendlyCardType } from '../../utils/render-error';

import type { Model as ParentModel } from '../render';

export type Model = PrerenderMeta | RenderError | undefined;

const computePerfLog = logger('host:computed-perf');

export default class RenderMetaRoute extends Route<Model> {
  @service declare cardService: CardService;
  @service declare private network: NetworkService;

  async model(_: unknown, transition: Transition) {
    let api = await this.cardService.getAPI();
    let parentModel = this.modelFor('render') as ParentModel | undefined;
    // the global use below is to support in-browser rendering, where we actually don't have the
    // ability to lookup the parent route using RouterService.recognizeAndLoad()
    let renderModel =
      parentModel ??
      ((globalThis as any).__renderModel as ParentModel | undefined);
    await renderModel?.readyPromise;
    let instance: CardDef | undefined = renderModel?.instance;

    if (!instance) {
      // the lack of an instance is dealt with in the parent route
      transition.abort();
      return;
    }

    let deps =
      renderModel?.capturedDeps ??
      snapshotRuntimeDependencies({ excludeQueryOnly: true }).deps;

    // Open a synchronous compute-memo pass that spans both
    // serializeCard and searchDoc. Computed fields invoked through the
    // descriptor or through peekAtField hit the per-instance memo
    // instead of re-running `computeVia` — one compute per distinct
    // (instance, fieldName) for the whole traversal. The pass MUST
    // close before any await so it doesn't leak across reactive cycles.
    //
    // Guarded by typeof checks: during a cold dev boot the host can briefly
    // load a base/card-api build that predates these exports (vite is still
    // bundling, or a stale realm-transpile is in flight). In that window we
    // skip the pass — `getter` falls through its `passComputeMemo === null`
    // fast path and the render still produces a correct serialized + search
    // doc, just without the per-row diagnostics fields.
    //
    // Pass close is in a `finally` so a throw inside serializeCard /
    // searchDoc still closes the pass — otherwise the module-global
    // memo in field-support.ts stays set and later off-pass `getter`
    // calls would read stale memoized values across reactive cycles.
    let passOpen = typeof api.beginComputePass === 'function';
    if (passOpen) {
      api.beginComputePass();
    }
    let serialized: SingleCardDocument;
    let serializeMs: number;
    let searchDoc: Record<string, any>;
    let searchDocMs: number;
    let passSnapshot: ComputePassSnapshot | undefined;
    try {
      let serializeStart = performance.now();
      let vn = this.network.virtualNetwork;
      serialized = api.serializeCard(instance, {
        includeComputeds: true,
        // A query-backed field is resolved live and the index can't invalidate
        // it, so its serialized value would always be stale — and deep-
        // serializing the query closure into `included[]` is what wedges a
        // densely cross-linked realm. Membership comes from the file's own
        // relationships, so omit query fields here (the relationship data is
        // stripped below regardless).
        omitQueryFields: true,
        maybeRelativeReference: (reference: string) =>
          maybeRelativeReference(
            vn.toURL(reference),
            vn.toURL(instance.id),
            instance[realmURL],
          ),
      }) as SingleCardDocument;
      serializeMs = performance.now() - serializeStart;
      for (let { relationship } of relationshipEntries(
        serialized.data.relationships,
      )) {
        // we want to emulate the file serialization here
        delete relationship.data;
      }

      let searchDocStart = performance.now();
      searchDoc = api.searchDoc(instance);
      searchDocMs = performance.now() - searchDocStart;
    } finally {
      if (passOpen && typeof api.endComputePass === 'function') {
        passSnapshot = api.endComputePass();
      }
    }

    let Klass = getClass(instance);

    let types = getTypes(Klass);
    let displayNames = getDisplayNames(Klass);
    // Add a "pseudo field" to the search doc for the card type. We use the
    // "_" prefix to make a decent attempt to not pollute the userland
    // namespace for cards
    searchDoc._cardType = friendlyCardType(Klass);

    let diagnostics: PrerenderMetaDiagnostics = {
      ...(passSnapshot
        ? {
            computedCalls: passSnapshot.calls,
            computedCacheHits: passSnapshot.cacheHits,
          }
        : {}),
      serializeMs: Math.round(serializeMs * 100) / 100,
      searchDocMs: Math.round(searchDocMs * 100) / 100,
    };

    // Record broken `linksTo` / `linksToMany` targets as searchable
    // metadata on the success entry. We awaited `readyPromise` above, so
    // the store has settled: every lazy link the render pulled on has
    // resolved and any failure has planted its sentinel. `getBrokenLinks`
    // reads that terminal state through
    // `getRelationshipMembershipState` without
    // retriggering a load. The card still indexes as `type='instance'`
    // (the broken slot renders a placeholder); this block is the only
    // direct, indexed signal of which slots are broken, persisted to
    // `boxel_index.diagnostics.brokenLinks`. Guarded like the
    // compute-pass hooks above: a stale base/card-api build loaded during
    // a cold boot may predate the export, in which case we omit the
    // findings and the render still produces a correct meta doc.
    if (typeof api.getBrokenLinks === 'function') {
      let brokenLinks = api.getBrokenLinks(instance);
      if (brokenLinks.length > 0) {
        diagnostics.brokenLinks = brokenLinks.map(
          ({ fieldName, reference, kind }) => ({ fieldName, reference, kind }),
        );
      }
    }
    computePerfLog.debug(
      `render.meta computed counts cardId=${instance.id} calls=${diagnostics.computedCalls ?? 'n/a'} cacheHits=${diagnostics.computedCacheHits ?? 'n/a'} serializeMs=${diagnostics.serializeMs} searchDocMs=${diagnostics.searchDocMs}`,
    );

    return {
      serialized,
      displayNames,
      types: types.map((t) =>
        internalKeyFor(t, undefined, this.network.virtualNetwork),
      ),
      searchDoc,
      deps: this.network.virtualNetwork.unresolveURLs(deps),
      diagnostics,
    };
  }
}

export function getClass(instance: CardDef): typeof CardDef {
  return Reflect.getPrototypeOf(instance)!.constructor as typeof CardDef;
}

export function getTypes(klass: typeof BaseDef): CodeRef[] {
  let types = [];
  let current: typeof BaseDef | undefined = klass;

  while (current) {
    let ref = identifyCard(current);
    if (!ref || isEqual(ref, baseRef)) {
      break;
    }
    types.push(ref);
    current = Reflect.getPrototypeOf(current) as typeof BaseDef | undefined;
  }
  return types;
}

function getDisplayNames(klass: typeof BaseDef): string[] {
  let displayNames = [];
  let current: typeof BaseDef | undefined = klass;

  while (current) {
    let ref = identifyCard(current);
    if (!ref || isEqual(ref, baseRef)) {
      break;
    }
    displayNames.push(normalizeDisplayName(current));
    current = Reflect.getPrototypeOf(current) as typeof BaseDef | undefined;
  }
  return displayNames;
}

function normalizeDisplayName(current: typeof BaseDef): string {
  let name = current.displayName;
  if (
    (name === 'Card' && current.name !== 'CardDef') ||
    (name === 'Field' && current.name !== 'FieldDef') ||
    (name === 'Base' && current.name !== 'BaseDef')
  ) {
    return current.name;
  }
  return name;
}
