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
  type SearchDocLinkLoad,
  type SearchDocTimings,
  type SingleCardDocument,
  type PrerenderMeta,
  type PrerenderMetaDiagnostics,
  type RenderError,
} from '@cardstack/runtime-common';

import type CardService from '@cardstack/host/services/card-service';
import type NetworkService from '@cardstack/host/services/network';
import type RenderStoreService from '@cardstack/host/services/render-store';

import { friendlyCardType } from '../../utils/render-error';

import type { Model as ParentModel } from '../render';
import type {
  BaseDef,
  CardDef,
  ComputePassSnapshot,
} from '@cardstack/base/card-api';

export type Model = PrerenderMeta | RenderError | undefined;

const computePerfLog = logger('host:computed-perf');

// Bounds for the searchable-driven load-settle loop below. Match the
// template-render settle in the /render route (READY_SETTLE_MAX_PASSES /
// READY_SETTLE_REQUIRED_STABLE_PASSES): keep pulling + waiting until the
// store's load generation holds steady for a couple of passes, capped so a
// pathological graph can't loop forever.
const SEARCHABLE_SETTLE_MAX_PASSES = 20;
const SEARCHABLE_SETTLE_REQUIRED_STABLE_PASSES = 2;

// Persistence bounds for the per-field / per-link-load search-doc timings.
// The raw collectors are unbounded; only the slowest entries at/over the
// floor land on the row, so a typical ~1 ms search doc records nothing and
// a wide card can't bloat its diagnostics blob.
const SEARCH_DOC_TIMING_FLOOR_MS = 1;
const SEARCH_DOC_TIMING_MAX_ENTRIES = 20;

const roundMs = (ms: number) => Math.round(ms * 100) / 100;

// Slowest-N-at/over-the-floor pruning for the per-field timings. Keys stay
// in descending-cost order (string-keyed objects preserve insertion order),
// so the persisted JSON reads as a ranking. An ancestor's inclusive time is
// >= any descendant's, so every kept entry's parent chain is kept with it.
function pruneSearchDocFieldsMs(
  fieldsMs: Record<string, number>,
): Record<string, number> | undefined {
  let kept = Object.entries(fieldsMs)
    .filter(([, ms]) => ms >= SEARCH_DOC_TIMING_FLOOR_MS)
    .sort(([, a], [, b]) => b - a)
    .slice(0, SEARCH_DOC_TIMING_MAX_ENTRIES);
  return kept.length > 0
    ? Object.fromEntries(kept.map(([path, ms]) => [path, roundMs(ms)]))
    : undefined;
}

// Same pruning for link-target loads. The floor also drops the near-zero
// entries recorded when a target was already resident in the store, so what
// survives is the loads that actually cost something.
function pruneSearchDocLinkLoads(
  linkLoads: SearchDocLinkLoad[],
): SearchDocLinkLoad[] | undefined {
  let kept = linkLoads
    .filter(({ ms }) => ms >= SEARCH_DOC_TIMING_FLOOR_MS)
    .sort((a, b) => b.ms - a.ms)
    .slice(0, SEARCH_DOC_TIMING_MAX_ENTRIES)
    .map((load) => ({ ...load, ms: roundMs(load.ms) }));
  return kept.length > 0 ? kept : undefined;
}

// The base module whose generator produces every search doc. Recorded as a
// dependency of the meta output directly (see the deps union below) rather
// than relying on its per-loader-cached module-load hook to fire during a
// given render. `unresolveURLs` maps it to `@cardstack/base/searchable`.
const SEARCHABLE_MODULE_URL = 'https://cardstack.com/base/searchable';

export default class RenderMetaRoute extends Route<Model> {
  @service declare cardService: CardService;
  @service declare private network: NetworkService;
  @service('render-store') declare private store: RenderStoreService;

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

    // The search doc comes from the searchable-driven generator in its own base
    // module. It derives link depth from the explicit `searchable` annotations
    // rather than from what the render happened to load.
    let searchable = await this.cardService.getSearchable();

    // Drive the instance's linked-field loading to quiescence before
    // serializing. The searchable annotations name which links to pull, and
    // the card's own contained/computed fields read links too — both fire
    // lazy loads through the field getter (tracked on the store). Nothing
    // awaits those loads inline (a computed reading a not-yet-loaded link
    // sees `undefined`; a broken link's terminal sentinel isn't planted
    // until its load settles), so pull-then-wait here, repeating until the
    // store's load generation holds steady: each pass loads whatever the
    // current state newly permits — a deeper searchable hop once its parent
    // resolved, a computed's link once the computed re-reads — and
    // `store.loaded()` drains it. Cycles clip via the generator's own stack
    // guard, so a ring loads its nodes once and then quiesces.
    //
    // This reproduces, for the search doc, the settle the /render route
    // provides for template renders (its readyPromise waits on the same
    // `store.loaded()` after the template pulls the links). The two are
    // complementary: when a template render already loaded the graph (a fused
    // visit, or an HTML render sharing this tab), the first pass finds every
    // target resident and `store.loaded()` resolves immediately — there is
    // nothing left to wait for.
    //
    // Link-load cost lives HERE: the settle passes perform the actual
    // target loads (each load registers its instance in the store, so the
    // timed generation below finds everything resident). The collector
    // gathers one entry per performed load across all passes — a target
    // loads on the first pass that reaches it and is a resident hit
    // afterward — for the `searchDocLinkLoads` diagnostic.
    let settleLinkLoads: SearchDocLinkLoad[] = [];
    let settleStart = performance.now();
    let settlePasses = await this.#settleSearchableLoads(
      instance,
      searchable,
      settleLinkLoads,
    );
    let searchDocSettleMs = performance.now() - settleStart;

    // Union the render route's captured deps with a fresh snapshot: the
    // settle loop above loaded links through the tracked getter (each a
    // recorded dependency), and those loads land in the still-open tracking
    // session but after `capturedDeps` was snapshotted. A render that never
    // pulled a link (an index visit with no HTML render) would otherwise
    // drop the edges searchable just followed.
    //
    // The searchable module itself is loaded through a per-loader cache, so its
    // module-load hook only fires (and only records a dependency) on the first
    // pull in a given render tab — a warm tab would omit it. Building the search
    // doc always consumes it, so record it unconditionally, independent of that
    // load-hook timing.
    let deps = [
      ...new Set([
        SEARCHABLE_MODULE_URL,
        ...(renderModel?.capturedDeps ?? []),
        ...snapshotRuntimeDependencies({ excludeQueryOnly: true }).deps,
      ]),
    ];

    // Open a synchronous compute-memo pass over serializeCard. Computed fields
    // invoked through the descriptor or through peekAtField hit the per-instance
    // memo instead of re-running `computeVia` — one compute per distinct
    // (instance, fieldName). The pass MUST close before any await so it doesn't
    // leak across reactive cycles; searchable-driven generation does targeted
    // link loading (async), so it runs after the pass closes — see below.
    //
    // Guarded by typeof checks: during a cold dev boot the host can briefly
    // load a base/card-api build that predates these exports (vite is still
    // bundling, or a stale realm-transpile is in flight). In that window we
    // skip the pass — `getter` falls through its `passComputeMemo === null`
    // fast path and the render still produces a correct serialized doc, just
    // without the per-row diagnostics fields.
    //
    // Pass close is in a `finally` so a throw inside serializeCard still closes
    // the pass — otherwise the module-global memo in field-support.ts stays set
    // and later off-pass `getter` calls would read stale memoized values across
    // reactive cycles.
    let passOpen = typeof api.beginComputePass === 'function';
    if (passOpen) {
      api.beginComputePass();
    }
    let serialized: SingleCardDocument;
    let serializeMs: number;
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
      // Emulate the on-disk file serialization: a card file holds only the
      // card's own resource — relationship slots keep their `links` but drop
      // the resolved `data`, and no linked neighbors ride along in `included`.
      // The searchable settle above may have loaded link targets into the
      // store, and `serializeCard` walks whatever is resident into `included`;
      // strip both so the serialized instance is a pure function of the card's
      // own data, independent of which targets happen to be loaded.
      for (let { relationship } of relationshipEntries(
        serialized.data.relationships,
      )) {
        delete relationship.data;
      }
      delete serialized.included;
    } finally {
      if (passOpen && typeof api.endComputePass === 'function') {
        passSnapshot = api.endComputePass();
      }
    }

    // Run searchable-driven generation after the compute-memo pass closes: it
    // awaits targeted link loads, and the pass cannot span an await. The
    // generator collects the URLs of the link targets it pulls into the doc;
    // those are dependencies of this card (unioned into `deps` below), so
    // editing a searchable target reindexes the owner even when the render did
    // not itself load that target.
    let searchDocStart = performance.now();
    let searchableDeps = new Set<string>();
    // Per-field evaluation timings come from this timed walk (link loads
    // settled above, so it measures evaluation, not loading); any load the
    // walk still performs — a settle that hit its pass cap, a race — joins
    // the settle passes' entries.
    let searchDocTimings: SearchDocTimings = { fieldsMs: {}, linkLoads: [] };
    let searchDoc: Record<string, any> = await searchable.searchDocFromFields(
      instance,
      searchableDeps,
      searchDocTimings,
    );
    let searchDocMs = performance.now() - searchDocStart;
    if (searchableDeps.size > 0) {
      deps = [...new Set([...deps, ...searchableDeps])];
    }

    let Klass = getClass(instance);

    let types = getTypes(Klass);
    let displayNames = getDisplayNames(Klass);
    // Add a "pseudo field" to the search doc for the card type. We use the
    // "_" prefix to make a decent attempt to not pollute the userland
    // namespace for cards
    searchDoc._cardType = friendlyCardType(Klass);
    // `_title` is the neutral, cross-type display-title key that file docs also
    // carry (see file-indexer), so a mixed cards+files query can substring-match
    // and A-Z sort both row types on a single key. For a card it mirrors the
    // `cardTitle` computed already present in the search doc.
    searchDoc._title = searchDoc.cardTitle;

    let searchDocFieldsMs = pruneSearchDocFieldsMs(
      searchDocTimings.fieldsMs ?? {},
    );
    let searchDocLinkLoads = pruneSearchDocLinkLoads([
      ...settleLinkLoads,
      ...(searchDocTimings.linkLoads ?? []),
    ]);
    let diagnostics: PrerenderMetaDiagnostics = {
      ...(passSnapshot
        ? {
            computedCalls: passSnapshot.calls,
            computedCacheHits: passSnapshot.cacheHits,
          }
        : {}),
      serializeMs: roundMs(serializeMs),
      searchDocMs: roundMs(searchDocMs),
      searchDocSettleMs: roundMs(searchDocSettleMs),
      searchDocSettlePasses: settlePasses,
      ...(searchDocFieldsMs ? { searchDocFieldsMs } : {}),
      ...(searchDocLinkLoads ? { searchDocLinkLoads } : {}),
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
      `render.meta computed counts cardId=${instance.id} calls=${diagnostics.computedCalls ?? 'n/a'} cacheHits=${diagnostics.computedCacheHits ?? 'n/a'} serializeMs=${diagnostics.serializeMs} searchDocMs=${diagnostics.searchDocMs} searchDocSettleMs=${diagnostics.searchDocSettleMs} searchDocSettlePasses=${diagnostics.searchDocSettlePasses}`,
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

  // Pull the instance's searchable-path links (and the links its
  // contained/computed fields read) and wait for the store to settle,
  // repeating until the load generation is stable. Running the searchable
  // generator IS the pull — it reads every field the search doc and pristine
  // doc will read, firing each link's lazy load through the tracked getter —
  // and `store.loaded()` is the wait. The intermediate search docs are
  // discarded (a throwaway dependency set); the authoritative generation runs
  // afterward against the settled store. See the call site for why this is
  // needed and how it composes with the /render template settle.
  //
  // Returns the number of passes run. Each performed link-target load is
  // recorded into `linkLoads` (the collector fills incrementally, so loads
  // recorded before a swallowed mid-walk throw survive); a searchable build
  // that predates the collector parameter simply leaves it empty.
  async #settleSearchableLoads(
    instance: CardDef,
    searchable: Awaited<ReturnType<CardService['getSearchable']>>,
    linkLoads: SearchDocLinkLoad[],
  ): Promise<number> {
    let observedGeneration = this.store.loadGeneration;
    let stablePasses = 0;
    let timings: SearchDocTimings = { linkLoads };
    for (let pass = 0; pass < SEARCHABLE_SETTLE_MAX_PASSES; pass++) {
      // A computed that reads a not-yet-loaded link (e.g.
      // `this.author.firstName`) throws on the first pass — the getter fires
      // the lazy load, then the read of the still-`undefined` target throws.
      // The load it fired is what we wait on next, so swallow the throw and
      // let it settle: a later pass re-runs the computed against the loaded
      // target. A genuine (non-load-race) failure resurfaces in the
      // authoritative generation the caller runs after this settles.
      try {
        await searchable.searchDocFromFields(instance, undefined, timings);
      } catch {
        // intentionally ignored during settle — see above
      }
      await this.store.loaded();
      let nextGeneration = this.store.loadGeneration;
      if (nextGeneration === observedGeneration) {
        if (++stablePasses >= SEARCHABLE_SETTLE_REQUIRED_STABLE_PASSES) {
          return pass + 1;
        }
      } else {
        observedGeneration = nextGeneration;
        stablePasses = 0;
      }
    }
    computePerfLog.warn(
      `render.meta searchable settle for ${instance.id} did not reach a stable load generation within ${SEARCHABLE_SETTLE_MAX_PASSES} passes; proceeding with the current store state`,
    );
    return SEARCHABLE_SETTLE_MAX_PASSES;
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
