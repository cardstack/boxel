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

// Pass cap for the walk-until-stable loop below (matches the
// READY_SETTLE_MAX_PASSES cap of the /render route's template settle), so a
// pathological graph can't loop forever. Unlike a template render — whose
// afterRender hooks can schedule further work that only a repeated
// render-and-wait can flush — a searchable walk is a pure function of the
// store's settled load state, so a single pass that fired no tracked loads
// is already authoritative: re-running it against the same state would
// produce the same doc. One stable pass therefore terminates the loop.
const SEARCHABLE_SETTLE_MAX_PASSES = 20;

// Persistence bounds for the per-field / per-link-load search-doc timings.
// The raw collectors are unbounded; only the slowest entries at/over the
// floor land on the row, so a typical ~1 ms search doc records nothing and
// a wide card can't bloat its diagnostics blob.
const SEARCH_DOC_TIMING_FLOOR_MS = 1;
const SEARCH_DOC_TIMING_MAX_ENTRIES = 20;

const roundMs = (ms: number) => Math.round(ms * 100) / 100;

// Slowest-N-at/over-the-floor pruning for the per-field timings. Rank by
// value when reading — jsonb normalizes key order, so the persisted object
// carries no ordering. An ancestor's inclusive time is >= any descendant's,
// so a kept entry's parent chain makes the cut with it (barring an
// exact-tie at the cut-off).
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

// Multiset diff over the store's bounded completed-load histories: the
// entries present in `after` beyond their multiplicity in `before`. Used to
// attribute loads the walk passes fired through field getters (a computed
// reading a link loads via `lazilyLoadLink`, not via the generator's
// targeted loading) — those loads land in the store's history but never
// pass through the generator's collector. The histories keep only the
// slowest entries, so a load evicted by slower siblings goes unreported;
// what survives is by construction the part worth attributing. Exported for
// unit testing.
export function newLoadEntries(
  before: Array<{ url: string; ms: number }>,
  after: Array<{ url: string; ms: number }>,
): Array<{ url: string; ms: number }> {
  let seen = new Map<string, number>();
  for (let { url, ms } of before) {
    let key = `${url}|${ms}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  let fresh: Array<{ url: string; ms: number }> = [];
  for (let entry of after) {
    let key = `${entry.url}|${entry.ms}`;
    let count = seen.get(key) ?? 0;
    if (count > 0) {
      seen.set(key, count - 1);
    } else {
      fresh.push(entry);
    }
  }
  return fresh;
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

    // Produce the search doc by walking until the store's load state is
    // quiescent — the walk IS the pull. The searchable annotations name which
    // links to pull, and the card's own contained/computed fields read links
    // too. The generator awaits its own targeted loads inline and folds each
    // target straight into the doc, but a computed reading a not-yet-loaded
    // link fires a lazy getter load nothing awaits (the computed sees
    // `undefined`, or throws until the target lands), so a pass that fired
    // such loads is re-run once `store.loaded()` drains them: each pass
    // evaluates whatever the newly-settled state permits — a deeper
    // searchable hop once its parent resolved, a computed's link once the
    // computed re-reads. The first pass whose walk left the store's load
    // generation unmoved is authoritative — its doc, dependency set, and
    // per-field timings are the ones consumed below. Cycles clip via the
    // generator's own stack guard, so a ring loads its nodes once and then
    // quiesces.
    //
    // This reproduces, for the search doc, the settle the /render route
    // provides for template renders (its readyPromise waits on the same
    // `store.loaded()` after the template pulls the links). The two are
    // complementary: when a template render already loaded the graph (an
    // HTML render sharing this tab), the first pass finds every target
    // resident and is immediately stable.
    //
    // The collector gathers one entry per performed targeted load across all
    // passes — a target loads on the first pass that reaches it and is a
    // resident hit afterward — for the `searchDocLinkLoads` diagnostic.
    // Loads fired indirectly through field getters (a computed reading a
    // link) bypass the generator's collector, so the store's completed-load
    // histories are snapshotted around the loop and their delta is folded
    // in — with an empty `path`, since the store can't name the owning
    // field.
    let recentLoadsBefore = [
      ...this.store.recentCardDocLoads(),
      ...this.store.recentFileMetaLoads(),
    ];
    let {
      searchDoc,
      searchableDeps,
      fieldsMs,
      linkLoads,
      searchDocMs,
      settleMs: searchDocSettleMs,
      settlePasses,
    } = await this.#searchDocUntilSettled(instance, searchable);
    let getterFiredLoads = newLoadEntries(recentLoadsBefore, [
      ...this.store.recentCardDocLoads(),
      ...this.store.recentFileMetaLoads(),
    ]).map(({ url, ms }) => ({ path: '', target: url, ms }));

    // Union the render route's captured deps with a fresh snapshot: the walk
    // passes above loaded links through the tracked getter (each a recorded
    // dependency), and those loads land in the still-open tracking session
    // but after `capturedDeps` was snapshotted. A render that never pulled a
    // link (an index visit with no HTML render) would otherwise drop the
    // edges searchable just followed. The targets the generator expanded
    // into the doc are dependencies too — editing an expanded target must
    // reindex the owner even when no render loaded it — so the generator's
    // collected set joins the union.
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
        ...searchableDeps,
      ]),
    ];

    // Open a synchronous compute-memo pass over serializeCard. Computed fields
    // invoked through the descriptor or through peekAtField hit the per-instance
    // memo instead of re-running `computeVia` — one compute per distinct
    // (instance, fieldName). The pass MUST close before any await so it doesn't
    // leak across reactive cycles; the walk loop above settled the store, so
    // every link serializeCard's computeds read is already resident.
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

    let searchDocFieldsMs = pruneSearchDocFieldsMs(fieldsMs);
    // A target the generator loaded directly also lands in the store's
    // history; keep the generator's entry (it carries the field path) and
    // drop the store's duplicate.
    let targetedUrls = new Set(linkLoads.map(({ target }) => target));
    let searchDocLinkLoads = pruneSearchDocLinkLoads([
      ...linkLoads,
      ...getterFiredLoads.filter(({ target }) => !targetedUrls.has(target)),
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

  // Walk the card with the searchable generator until the store's load
  // state is quiescent, and return the first quiescent walk's output as the
  // authoritative search doc. Running the generator IS the pull — it reads
  // every field the search doc will read, awaiting its own targeted link
  // loads inline and firing each computed-read link's lazy load through the
  // tracked getter — and `store.loaded()` is the wait. A pass that left the
  // store's load generation unmoved consumed only settled state, so its doc
  // is what any re-run against that state would produce: it terminates the
  // loop, and its dependency set and per-field timings ride out with it.
  // Unstable passes' docs and fieldsMs are discarded; `linkLoads` is shared
  // across passes (a target loads on the first pass that reaches it, so the
  // union is one entry per performed load).
  //
  // A computed that reads a not-yet-loaded link (e.g. `this.author.name`)
  // throws mid-walk — the getter fires the lazy load, then the read of the
  // still-`undefined` target throws. The load it fired moves the generation,
  // so the throw is swallowed and the next pass re-runs the computed against
  // the loaded target. A genuine failure fires no load, reads as stable, and
  // rethrows to the caller (the render error path). Timings recorded before
  // a mid-walk throw survive — the collector fills incrementally.
  //
  // `searchDocMs` is the authoritative walk's own duration (its loads are
  // resident/cache hits, so it measures evaluation); `settleMs` is
  // everything before and around it — the discarded walks and the load
  // drains; `settlePasses` counts the discarded walks (0 when the first
  // walk settles).
  async #searchDocUntilSettled(
    instance: CardDef,
    searchable: Awaited<ReturnType<CardService['getSearchable']>>,
  ): Promise<{
    searchDoc: Record<string, any>;
    searchableDeps: Set<string>;
    fieldsMs: Record<string, number>;
    linkLoads: SearchDocLinkLoad[];
    searchDocMs: number;
    settleMs: number;
    settlePasses: number;
  }> {
    let linkLoads: SearchDocLinkLoad[] = [];
    let loopStart = performance.now();
    for (let pass = 0; pass < SEARCHABLE_SETTLE_MAX_PASSES; pass++) {
      let observedGeneration = this.store.loadGeneration;
      let searchableDeps = new Set<string>();
      let timings: SearchDocTimings = { fieldsMs: {}, linkLoads };
      let walkStart = performance.now();
      let searchDoc: Record<string, any> | undefined;
      let thrown: unknown;
      let threw = false;
      try {
        searchDoc = await searchable.searchDocFromFields(
          instance,
          searchableDeps,
          timings,
        );
      } catch (e) {
        threw = true;
        thrown = e;
      }
      let searchDocMs = performance.now() - walkStart;
      await this.store.loaded();
      let stable = this.store.loadGeneration === observedGeneration;
      let lastAllowedPass = pass === SEARCHABLE_SETTLE_MAX_PASSES - 1;
      if (!stable && !lastAllowedPass) {
        continue;
      }
      if (!stable) {
        computePerfLog.warn(
          `render.meta searchable walk for ${instance.id} did not reach a stable load generation within ${SEARCHABLE_SETTLE_MAX_PASSES} passes; using the current store state`,
        );
      }
      if (threw) {
        throw thrown;
      }
      return {
        searchDoc: searchDoc!,
        searchableDeps,
        fieldsMs: timings.fieldsMs ?? {},
        linkLoads,
        searchDocMs,
        settleMs: performance.now() - loopStart - searchDocMs,
        settlePasses: pass,
      };
    }
    // Unreachable: the final loop iteration always returns or throws.
    throw new Error(
      `bug: searchable walk loop for ${instance.id} exited without settling`,
    );
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
