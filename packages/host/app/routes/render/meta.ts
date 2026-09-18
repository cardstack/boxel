import { getOwner } from '@ember/owner';
import Route from '@ember/routing/route';
import type Transition from '@ember/routing/transition';

import { service } from '@ember/service';

import { isEqual } from 'lodash-es';

import type { CodeRef } from '@cardstack/runtime-common';
import {
  baseRef,
  beginRuntimeDependencyTrackingSession,
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
  type FusedIndexMeta,
  type PrerenderMetaDiagnostics,
  type RenderError,
} from '@cardstack/runtime-common';

import type CardService from '@cardstack/host/services/card-service';
import type EnvironmentService from '@cardstack/host/services/environment-service';
import type LoaderService from '@cardstack/host/services/loader-service';
import type NetworkService from '@cardstack/host/services/network';
import type RenderStoreService from '@cardstack/host/services/render-store';

import { createAuthErrorGuard } from '../../utils/auth-error-guard';

import { runFileExtract } from '../../utils/file-extract-runner';

import {
  newLoadEntries,
  pruneTimingEntries,
  pruneTimingPaths,
  roundMs,
} from '../../utils/render-diagnostics';

import { friendlyCardType } from '../../utils/render-error';

import type { FileDefExtractResult } from '../../utils/file-def-attributes-extractor';

import type { Model as ParentModel } from '../render';
import type {
  BaseDef,
  CardDef,
  ComputePassSnapshot,
} from '@cardstack/base/card-api';

export type Model = FusedIndexMeta | RenderError | undefined;

const computePerfLog = logger('host:computed-perf');

// Cap on DISCARDED walk passes in the walk-until-stable loop below (matches
// the READY_SETTLE_MAX_PASSES cap of the /render route's template settle),
// so a pathological graph can't loop forever. Unlike a template render —
// whose afterRender hooks can schedule further work that only a repeated
// render-and-wait can flush — a searchable walk is a pure function of the
// store's settled load state, so a single pass that fired no tracked loads
// is already authoritative: re-running it against the same state would
// produce the same doc. One stable pass therefore terminates the loop. At
// the cap, one final walk runs against the drained store and its output is
// used regardless of stability (with a warning when still unstable).
const SEARCHABLE_SETTLE_MAX_PASSES = 20;

// The base module whose generator produces every search doc. Recorded as a
// dependency of the meta output directly (see the deps union below) rather
// than relying on its per-loader-cached module-load hook to fire during a
// given render. `unresolveURLs` maps it to `@cardstack/base/searchable`.
const SEARCHABLE_MODULE_URL = 'https://cardstack.com/base/searchable';

export default class RenderMetaRoute extends Route<Model> {
  @service declare cardService: CardService;
  @service('environment-service')
  declare private environmentService: EnvironmentService;
  @service declare private loaderService: LoaderService;
  @service declare private network: NetworkService;
  @service('render-store') declare private store: RenderStoreService;
  #authGuard = createAuthErrorGuard();

  async model(_: unknown, transition: Transition) {
    // Loading `card-api`, like the `searchable` module below: per-loader
    // cached, so the first card a tab renders pays the whole module load
    // here and every card after it reads ~0. Timed for the same reason —
    // it is the difference between a first-in-tab card's `meta` bucket
    // being an unexplained outlier and being an explained one.
    let cardApiLoadStart = performance.now();
    let api = await this.cardService.getAPI();
    let cardApiLoadMs = performance.now() - cardApiLoadStart;
    let parentModel = this.modelFor('render') as ParentModel | undefined;
    // the global use below is to support in-browser rendering, where we actually don't have the
    // ability to lookup the parent route using RouterService.recognizeAndLoad()
    let renderModel =
      parentModel ??
      ((globalThis as any).__renderModel as ParentModel | undefined);
    // The parent route kicks off its ready settle (the load-stability loop)
    // and returns; this await is where the settle is actually paid for, so
    // it is a serial phase of this route's wall-clock and belongs in the
    // breakdown of it. On a visit whose html render already drove the settle
    // this resolves immediately and the cost sits in that render's bucket
    // instead.
    let readySettleStart = performance.now();
    await renderModel?.readyPromise;
    let readySettleMs = performance.now() - readySettleStart;
    let instance: CardDef | undefined = renderModel?.instance;

    if (!renderModel || !instance) {
      // the lack of an instance is dealt with in the parent route
      transition.abort();
      return;
    }

    // The search doc comes from the searchable-driven generator in its own base
    // module. It derives link depth from the explicit `searchable` annotations
    // rather than from what the render happened to load. Loading that module
    // is a per-loader-cached one-off, so the cost lands on whichever card in
    // a job reaches this first and is ~0 for every card after it — timed so
    // that first card's outsized `meta` bucket has a name.
    let searchableLoadStart = performance.now();
    let searchable = await this.cardService.getSearchable();
    let searchableLoadMs = performance.now() - searchableLoadStart;

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
        // A card file holds the card's own resource and no linked neighbors,
        // so no link target's resource belongs in this document. Saying that
        // up front is what keeps it cheap: the searchable settle above leaves
        // link targets resident, and at any wider scope the serializer would
        // walk whatever it finds there — each resident target, and
        // transitively each target's own — to build an `included[]` this
        // route then discards. An excluded target still emits its
        // relationship entry, so the document is unchanged.
        includedScope: 'none',
        // A query-backed field is resolved live and the index can't invalidate
        // it, so its serialized value would always be stale. Membership comes
        // from the file's own relationships, so omit query fields here (the
        // relationship data is stripped below regardless).
        omitQueryFields: true,
        maybeRelativeReference: (reference: string) =>
          maybeRelativeReference(
            vn.toURL(reference),
            vn.toURL(instance.id),
            instance[realmURL],
          ),
      }) as SingleCardDocument;
      serializeMs = performance.now() - serializeStart;
      // The rest of emulating the on-disk file serialization: a relationship
      // slot keeps its `links` but drops the resolved `data`, so the serialized
      // instance is a pure function of the card's own data rather than of which
      // targets happen to be loaded.
      for (let { relationship } of relationshipEntries(
        serialized.data.relationships,
      )) {
        delete relationship.data;
      }
      // `includedScope: 'none'` builds no `included`; the delete holds the
      // no-neighbors contract against a card whose own `serialize` hook pushes
      // one regardless.
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

    let searchDocFieldsMs = pruneTimingPaths(fieldsMs);
    // A target the generator loaded directly also lands in the store's
    // history; keep the generator's entry (it carries the field path) and
    // drop the store's duplicate.
    let targetedUrls = new Set(linkLoads.map(({ target }) => target));
    let searchDocLinkLoads = pruneTimingEntries<SearchDocLinkLoad>([
      ...linkLoads,
      ...getterFiredLoads.filter(({ target }) => !targetedUrls.has(target)),
    ]);
    let diagnostics: PrerenderMetaDiagnostics = {
      // The parent route's account of building the model this route was
      // handed. It rides out here because this is the payload the indexer
      // persists, and because a model is built once per visit while this
      // route may run more than once against it — the second run reports the
      // same numbers rather than a fresh (and empty) build.
      ...renderModel.buildModelDiagnostics,
      ...(passSnapshot
        ? {
            computedCalls: passSnapshot.calls,
            computedCacheHits: passSnapshot.cacheHits,
          }
        : {}),
      cardApiLoadMs: roundMs(cardApiLoadMs),
      readySettleMs: roundMs(readySettleMs),
      searchableLoadMs: roundMs(searchableLoadMs),
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

    let metaPayload: FusedIndexMeta = {
      serialized,
      displayNames,
      types: types.map((t) =>
        internalKeyFor(t, undefined, this.network.virtualNetwork),
      ),
      searchDoc,
      deps: this.network.virtualNetwork.unresolveURLs(deps),
      diagnostics,
    };

    let parsedOptions = renderModel.renderOptions;
    if (!parsedOptions?.fileExtract) {
      return metaPayload;
    }

    // Fused index render: the render options carry `fileExtract` alongside
    // `cardRender`, so this one transition also produces the file row's
    // extract. It runs only now — the card payload above is fully
    // materialized and its dependency snapshot taken, so nothing the extract
    // does can leak into the card row. The extract gets a fresh tracking
    // session: the tracker is session-scoped and a snapshot reads the whole
    // session, so sharing the card's session would fold the hydration graph
    // into the file row's deps. The instance id is the canonical (extension-
    // less) card URL; the extract targets the `.json` file that stores it,
    // the same URL a standalone render.file-extract receives.
    let fileURL = renderModel.cardId.endsWith('.json')
      ? renderModel.cardId
      : `${renderModel.cardId}.json`;
    let extractStart = performance.now();
    beginRuntimeDependencyTrackingSession({
      sessionKey: `${renderModel.cardId}|${renderModel.nonce}|file-extract`,
      // Canonicalized for the same reason as the card render's root: exclusion
      // is a string comparison, so the root has to be in the form the tracked
      // deps carry. A no-op for a realm with no prefix mapping.
      rootURL: this.network.virtualNetwork.unresolveURL(fileURL),
      rootKind: 'file',
    });
    this.#authGuard.register();
    let extractResult: FileDefExtractResult;
    try {
      extractResult = await runFileExtract({
        fileURL,
        renderOptions: parsedOptions,
        loaderService: this.loaderService,
        network: this.network,
        authGuard: this.#authGuard,
        owner: getOwner(this)!,
        fileSizeLimitBytes: this.environmentService.fileSizeLimitBytes,
      });
    } finally {
      this.#authGuard.unregister();
    }
    diagnostics.fileExtractMs = roundMs(performance.now() - extractStart);
    return {
      ...metaPayload,
      fileExtract: {
        id: fileURL,
        nonce: renderModel.nonce,
        ...extractResult,
      },
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
  // `searchDocMs` is the authoritative walk's own duration. It never waits
  // on getter-fired loads (those mark a walk unstable), but it can include
  // targeted `searchable`-route loads the walk consumed inline — untracked
  // loads leave the generation unmoved, so the first walk to reach a target
  // both loads it and can still read as stable. Each such load lands in the
  // `linkLoads` collector, so per-load cost stays attributable inside the
  // total. `settleMs` is everything before and around the authoritative
  // walk — the discarded walks and their load drains; `settlePasses` counts
  // the discarded walks (0 when the first walk settles). A graph that never
  // stabilizes within the discarded-walk cap gets one forced final walk
  // against the drained store; its output is used (or its throw propagated)
  // with a warning.
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
    // Up to SEARCHABLE_SETTLE_MAX_PASSES discarded walks, plus one forced
    // final walk at the cap. The forced walk runs AFTER the capped pass's
    // loads drained, so it sees the most-settled state reachable within the
    // budget — its output is used even when it is itself unstable, rather
    // than the pre-drain output of the pass that hit the cap.
    for (let pass = 0; pass <= SEARCHABLE_SETTLE_MAX_PASSES; pass++) {
      let forcedFinalPass = pass === SEARCHABLE_SETTLE_MAX_PASSES;
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
      if (!stable && !forcedFinalPass) {
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
    // Unreachable: the forced final pass always returns or throws.
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
    if (!ref) {
      break;
    }
    types.push(ref);
    // Include BaseDef (the common ancestor of CardDef and FileDef) as the final
    // element, then stop — so a `{ type: baseRef }` filter matches both card
    // and file rows (e.g. a `scope: 'all'` search using one type ref). The file
    // chains (file-indexer.ts, file-def-attributes-extractor.ts) terminate at
    // BaseDef the same way. `getDisplayNames` deliberately does NOT — no
    // consumer reads past element 0, and a BaseDef display name would be noise.
    if (isEqual(ref, baseRef)) {
      break;
    }
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
