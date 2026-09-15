import { buildWaiter } from '@ember/test-waiters';

import {
  identifyCard,
  internalKeyFor,
  isRelativePath,
  loadCardDef,
  logger as runtimeLogger,
  moduleFrom,
  rri,
  trimExecutableExtension,
  type CodeRef,
  type Loader,
  type VirtualNetwork,
} from '@cardstack/runtime-common';

import type {
  IncrementalIndexEventContent,
  PrerenderHtmlEventContent,
  RealmEventContent,
} from '@cardstack/base/matrix-event';

// The anchor resolution is async and nothing else awaits it, so without its
// own waiter a `settled()` could land between an event arriving and the keys
// that event asked for being ready.
const typeKeysWaiter = buildWaiter('live-search-type-gate:type-keys-waiter');

// The extension-free spelling of a card's URL, which is the only form the two
// realm event channels agree on. An incremental index event names the instance
// (`books/1`): `RealmIndexUpdater` strips the extension off every invalidation
// before the event goes out. A prerender_html event names the underlying file
// (`books/1.json`), the spelling `boxel_index` stores — which is also the
// spelling of the file-meta row that sits alongside the instance row for the
// same file. So the strip does double duty: it bridges the two channels, and
// it reaches both rows a card's file backs without knowing which kind a given
// id names. For every other file kind (`notes.md`, `book.gts`) it is a no-op
// and the comparison is exact.
export function stripJsonSuffix(url: string): string {
  return url.replace(/\.json$/, '');
}

// The ceiling on the remembered verdicts. A verdict has no expiry — it stands
// until the query changes or an event that could move a member withdraws it —
// so the record grows with every distinct URL written to the realm while the
// query is mounted, and a long-lived dashboard on a busy realm reaches this
// ceiling through ordinary write cadence, not only through a realm-wide
// module rewrite. That is what the bound is for: the record is a per-query
// cache of a cheap answer, and a page holding several queries should not
// accumulate a copy of the realm's URL list in each of them. Overflow clears
// the record rather than freezing it, so the gate refills from the next
// events instead of wedging on whatever filled it; what that costs is a
// window of unconditional re-runs, never a missed one.
const MAX_CORRELATED_URLS = 256;

// The skip rule a live search applies to a realm's index events: a query
// anchored on types an event never names cannot have gained or lost a member,
// so it sits the event out instead of re-querying every realm it spans, on
// every client holding it.
//
// A row can only enter or leave a type-anchored result set by being one of
// the anchored types, and a row an index pass touched named its whole
// adoption chain in the event — so anchors disjoint from the event's types
// mean no row moved. Everything else takes the unconditional re-run: an event
// that carries no types (an older realm-server, a failed pass, a full
// reindex), a filter that admits an entry of any type, and a query whose keys
// aren't resolved yet.
//
// Note what this deliberately does NOT test. "None of my current members were
// invalidated" is not a sound skip — a newly created card enters a result set
// without touching any existing member. And a matching-type write forces the
// re-run even when the query also filters on a field value, because the event
// carries no values to judge against.
export class LiveSearchTypeGate {
  // The keys a row this query could match is stamped with, resolved lazily so
  // the resolution is paid only where there is something to decide — a query
  // that never sees an event (a prerender, a chooser opened and dismissed)
  // resolves nothing, and the event that starts the resolution takes the
  // unconditional re-run it would have taken anyway. Stays undefined for a
  // filter that admits an entry of any type and for one whose anchors don't
  // resolve, which keeps the query on that re-run until one of the two it is
  // keyed on changes.
  #keys: Set<string> | undefined;
  #resolved = false;
  // The loader the keys were resolved against. What canonical spelling an
  // anchor resolves to is a property of that loader — a module rewrite
  // replaces the loader, and a module that re-exports a type can name a
  // different one on the far side of that boundary — so keys are only good
  // for as long as the loader that produced them is the live one.
  #loader: Loader | undefined;
  // The modules the anchors resolved through — the ref's own and its
  // canonical's. An index event naming one of them is a rewrite of the very
  // module whose exports decided these keys, so the keys are dropped and
  // re-resolved rather than trusted. The loader check above cannot stand in
  // for this: the loader is replaced by the store's rebuild, which only
  // subscribes to realms it holds a card reference in, while a live search
  // subscribes to its realms itself — so an event can arrive here for a realm
  // whose module rewrite replaces no loader at all.
  #modules = new Set<string>();
  // Bumped whenever the query changes (and on teardown) so a resolution in
  // flight for the previous query can't install its keys over the new one.
  #epoch = 0;
  // The URLs whose most recent index event this gate judged unrelated to the
  // query. Read by `prerenderEventCannotMatch`, which has no types of its own
  // to judge by. Empty unless the owner asked for the correlation.
  #unrelatedURLs = new Set<string>();
  #log = runtimeLogger('live-search-type-gate');

  #anchors: () => CodeRef[] | undefined;
  #currentLoader: () => Loader;
  #virtualNetwork: () => VirtualNetwork;
  #isDestroyed: () => boolean;
  #correlatePrerenderHtml: boolean;

  constructor(opts: {
    // The query's type anchors in the owner's own filter grammar. Read at gate
    // time rather than held, so a query change needs only `forget()`.
    anchors: () => CodeRef[] | undefined;
    loader: () => Loader;
    virtualNetwork: () => VirtualNetwork;
    isDestroyed: () => boolean;
    // Whether to remember which URLs were judged unrelated, so prerender_html
    // events over those same rows can be judged too. An owner that routes that
    // channel through a refresh of its own members leaves this off and holds
    // nothing.
    correlatePrerenderHtml?: boolean;
  }) {
    this.#anchors = opts.anchors;
    this.#currentLoader = opts.loader;
    this.#virtualNetwork = opts.virtualNetwork;
    this.#isDestroyed = opts.isDestroyed;
    this.#correlatePrerenderHtml = opts.correlatePrerenderHtml ?? false;
  }

  // Whether an incremental index event provably left this query's membership
  // alone.
  indexEventCannotMatch(event: RealmEventContent): boolean {
    let { invalidatedTypes, invalidations } =
      event as IncrementalIndexEventContent;
    let cannotMatch = this.#judgeIndexEvent(invalidatedTypes, invalidations);
    this.#recordIndexVerdict(invalidations, cannotMatch);
    return cannotMatch;
  }

  // Whether a prerender_html event provably left this query's membership
  // alone. The event carries no types of its own, so it is judged through the
  // index events that produced the same rows: a prerender_html job renders the
  // invalidation set of the pass that spawned it, and that pass named its
  // types. Every URL in the event having been judged unrelated by its own
  // index event means no row it re-rendered is of an anchored type — so
  // neither the render-error transition that moves a row in or out of a result
  // set, nor the full-text re-scoring that rides the same channel, can reach
  // this query.
  //
  // A URL this gate holds no verdict for answers false and takes the
  // unconditional re-run: a repair pass for rows an earlier generation left
  // stale, an event that outran the index event it belongs to, and a
  // subscription that started mid-burst all land there.
  prerenderEventCannotMatch(event: RealmEventContent): boolean {
    if (!this.#correlatePrerenderHtml) {
      return false;
    }
    let { invalidations } = event as PrerenderHtmlEventContent;
    if (!Array.isArray(invalidations) || invalidations.length === 0) {
      return false;
    }
    return invalidations.every((url) =>
      this.#unrelatedURLs.has(stripJsonSuffix(url)),
    );
  }

  // Drop the resolved keys and orphan any resolution still in flight for them,
  // along with every verdict they produced. Called wherever the query stops
  // being the one they describe, and on teardown.
  forget(): void {
    this.#keys = undefined;
    this.#resolved = false;
    this.#loader = undefined;
    this.#modules.clear();
    this.#unrelatedURLs.clear();
    this.#epoch++;
  }

  #judgeIndexEvent(
    invalidatedTypes: string[] | undefined,
    invalidations: string[] | undefined,
  ): boolean {
    if (!Array.isArray(invalidatedTypes)) {
      return false;
    }
    this.#forgetKeysInvalidatedBy(invalidations);
    let keys = this.#typeKeys();
    if (!keys) {
      return false;
    }
    return !invalidatedTypes.some((type) => keys.has(type));
  }

  // Carry this event's verdict forward to the render pass it spawns. An event
  // that could have moved a member takes its URLs back out: it may have
  // re-typed those rows into something this query is anchored on, and which
  // rows those are cannot be read off the event.
  #recordIndexVerdict(
    invalidations: string[] | undefined,
    cannotMatch: boolean,
  ): void {
    if (!this.#correlatePrerenderHtml || !Array.isArray(invalidations)) {
      return;
    }
    if (!cannotMatch) {
      for (let url of invalidations) {
        this.#unrelatedURLs.delete(stripJsonSuffix(url));
      }
      return;
    }
    if (this.#unrelatedURLs.size + invalidations.length > MAX_CORRELATED_URLS) {
      this.#unrelatedURLs.clear();
      return;
    }
    for (let url of invalidations) {
      this.#unrelatedURLs.add(stripJsonSuffix(url));
    }
  }

  // The resolved keys for the current query, kicking off the resolution the
  // first time they're asked for. Synchronous by design — the subscription
  // callback that consults this gate is — so the call that starts the
  // resolution reads `undefined` and falls through to the re-run.
  #typeKeys(): Set<string> | undefined {
    let loader = this.#currentLoader();
    if (this.#resolved && this.#loader !== loader) {
      this.forget();
    }
    if (this.#resolved) {
      return this.#keys;
    }
    this.#resolved = true;
    this.#loader = loader;
    let anchors: CodeRef[] | undefined;
    try {
      anchors = this.#anchors();
    } catch (err) {
      // A filter shape the anchor provider can't read is the same uncertainty
      // as one that anchors nothing: no keys, so the query keeps re-running
      // unconditionally. Caught rather than thrown because the caller is a
      // realm subscription callback, where an escaping throw would take out
      // the event handling this gate exists to cheapen.
      this.#log.info(
        `could not read the type anchors of this query; it stays on the unconditional refresh: ${String(err)}`,
      );
      return undefined;
    }
    if (!anchors?.length) {
      return undefined;
    }
    void this.#resolveKeys(anchors, this.#epoch, loader);
    return undefined;
  }

  // Resolve each anchor to the keys a row of that type could have been
  // stamped with, mirroring the server's own `typeKeysFor`: the ref's own
  // spelling, plus the canonical (defining-module) spelling the indexer
  // writes. Both are needed — a filter naming a type through a re-exporting
  // module shares no key with the rows unless the canonical one is resolved,
  // and skipping on that comparison would drop a real membership change. Any
  // anchor that can't be resolved abandons the whole set, leaving the query on
  // the unconditional re-run.
  async #resolveKeys(anchors: CodeRef[], epoch: number, loader: Loader) {
    let token = typeKeysWaiter.beginAsync();
    try {
      let resolved = await this.#keysFor(anchors, loader);
      if (resolved && epoch === this.#epoch && !this.#isDestroyed()) {
        this.#keys = resolved.keys;
        this.#modules = resolved.modules;
      }
    } catch (err) {
      // Nothing awaits this resolution, so an escaping throw would be an
      // unhandled rejection rather than a decision. A malformed anchor can
      // produce one from the ref helpers themselves, not just from the module
      // load — and every failure here means the same thing: no keys, so the
      // query keeps re-running unconditionally.
      this.#log.info(
        `could not resolve the type anchors for this query; it stays on the unconditional refresh: ${String(err)}`,
      );
    } finally {
      typeKeysWaiter.endAsync(token);
    }
  }

  async #keysFor(
    anchors: CodeRef[],
    loader: Loader,
  ): Promise<{ keys: Set<string>; modules: Set<string> } | undefined> {
    let virtualNetwork = this.#virtualNetwork();
    let keys = new Set<string>();
    let modules = new Set<string>();
    for (let ref of anchors) {
      // A relative module spelling is resolved server-side against the
      // document that issued the query; the client has no basis to resolve it
      // to the same place, so it isn't comparable to what the index stamped.
      if (isRelativePath(moduleFrom(ref))) {
        return undefined;
      }
      keys.add(internalKeyFor(ref, undefined, virtualNetwork));
      modules.add(this.#moduleKey(moduleFrom(ref)));
      let canonical: CodeRef | undefined;
      try {
        canonical = identifyCard(await loadCardDef(ref, { loader }));
      } catch (_e) {
        // A ref that names no loadable type is the same uncertainty as one
        // that names a type we can't canonicalize.
        return undefined;
      }
      if (!canonical) {
        return undefined;
      }
      keys.add(internalKeyFor(canonical, undefined, virtualNetwork));
      modules.add(this.#moduleKey(moduleFrom(canonical)));
    }
    return { keys, modules };
  }

  // Drop the keys when an event rewrites a module they were resolved through.
  // The keys name what that module's exports resolved to, so the event
  // carrying the rewrite is the last one that may be judged by them — and it
  // isn't: dropping them here, before the gate reads them, puts this event on
  // the unconditional refresh too.
  #forgetKeysInvalidatedBy(invalidations: string[] | undefined): void {
    if (!this.#keys || this.#modules.size === 0) {
      return;
    }
    for (let invalidation of invalidations ?? []) {
      if (this.#modules.has(this.#moduleKey(invalidation))) {
        this.forget();
        return;
      }
    }
  }

  // A module URL reduced to the spelling the anchors are recorded under: the
  // same normalization `internalKeyFor` applies to a ref's module half, so an
  // invalidation and an anchor naming one module agree however each was
  // spelled.
  #moduleKey(moduleHref: string): string {
    let virtualNetwork = this.#virtualNetwork();
    try {
      return virtualNetwork.unresolveURL(
        trimExecutableExtension(
          rri(virtualNetwork.resolveURL(moduleHref, undefined).href),
        ),
      );
    } catch (_e) {
      // A URL this gate can't reduce can't match an anchor's module either —
      // it is some other realm's spelling, not a rewrite of what these keys
      // were resolved through.
      return moduleHref;
    }
  }
}
