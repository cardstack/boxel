import { executableExtensions } from './index.ts';

export type RuntimeDependencyNodeKind = 'module' | 'instance' | 'file';
export type RuntimeDependencyContextMode = 'query' | 'non-query';

export interface RuntimeDependencyTrackingContext {
  mode?: RuntimeDependencyContextMode;
  queryField?: string;
  consumer?: string;
  consumerKind?: Extract<RuntimeDependencyNodeKind, 'instance' | 'file'>;
  source?: string;
}

export interface RuntimeDependencyTrackerSessionOptions {
  sessionKey: string;
  rootURL?: string;
  rootKind?: Extract<RuntimeDependencyNodeKind, 'instance' | 'file'>;
}

export interface RuntimeDependencyTrackerSnapshot {
  deps: string[];
  excludedQueryOnlyDeps: string[];
  unscopedDeps: string[];
}

export interface RuntimeDependencyConsumerContext {
  consumer?: string;
  consumerKind?: Extract<RuntimeDependencyNodeKind, 'instance' | 'file'>;
}

interface NodeRecord {
  kinds: Set<RuntimeDependencyNodeKind>;
  queryContexts: Set<string>;
  nonQueryContexts: Set<string>;
  hasUnscopedAccess: boolean;
}

interface ContextStackEntry {
  token: symbol;
  context: RuntimeDependencyTrackingContext;
}

// String-based URL normalization to avoid expensive URL constructor calls.
// These are called on every dependency tracking operation (field getter access)
// so performance is critical.

function canonicalURL(url: string): string | undefined {
  if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
    return undefined;
  }
  // Strip query string and hash using string ops instead of new URL()
  let hashIdx = url.indexOf('#');
  if (hashIdx !== -1) {
    url = url.slice(0, hashIdx);
  }
  let searchIdx = url.indexOf('?');
  if (searchIdx !== -1) {
    url = url.slice(0, searchIdx);
  }
  return url;
}

function hasPathExtension(url: string): boolean {
  let lastSlash = url.lastIndexOf('/');
  let segment = lastSlash !== -1 ? url.slice(lastSlash + 1) : url;
  return segment.length > 0 && segment.includes('.');
}

function normalizeModuleURL(url: string): string | undefined {
  let canonical = canonicalURL(url);
  if (!canonical) {
    return undefined;
  }
  for (let ext of executableExtensions) {
    if (canonical.endsWith(ext)) {
      return canonical.slice(0, -ext.length);
    }
  }
  return canonical;
}

function normalizeInstanceURL(url: string): string | undefined {
  let canonical = canonicalURL(url);
  if (!canonical) {
    return undefined;
  }
  if (!hasPathExtension(canonical)) {
    return `${canonical}.json`;
  }
  return canonical;
}

function normalizeFileURL(url: string): string | undefined {
  return canonicalURL(url);
}

function normalizeByKind(
  kind: RuntimeDependencyNodeKind,
  url: string,
): string | undefined {
  switch (kind) {
    case 'module':
      return normalizeModuleURL(url);
    case 'instance':
      return normalizeInstanceURL(url);
    case 'file':
      return normalizeFileURL(url);
  }
}

function contextLabel(context: RuntimeDependencyTrackingContext): string {
  if (context.mode === 'query') {
    return `query:${context.queryField ?? '(unknown-field)'}`;
  }
  return `non-query:${context.source ?? '(unknown-source)'}`;
}

function isPromiseLike<T = unknown>(value: unknown): value is Promise<T> {
  return (
    value !== null &&
    typeof value === 'object' &&
    'then' in value &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

// Shared identity for "no active context" so a context-keyed cache can dedup
// tracking that happens outside any withContext scope (the relationship walk a
// template render drives). A fresh object literal each call would defeat that.
const EMPTY_CONTEXT: RuntimeDependencyTrackingContext = Object.freeze({});

// NUL separates the two parts of a composite cache key. It can't appear in a
// node kind or a URL, so distinct (kind, rawURL) pairs never collide into the
// same key.
const CACHE_KEY_SEPARATOR = '\0';

function normalizeCacheKey(
  kind: RuntimeDependencyNodeKind,
  rawURL: string,
): string {
  return `${kind}${CACHE_KEY_SEPARATOR}${rawURL}`;
}

export class RuntimeDependencyTracker {
  #sessionKey: string | undefined;
  #isActive = false;
  #contextStack: ContextStackEntry[] = [];
  #nodes = new Map<string, NodeRecord>();
  #rootCandidates = new Set<string>();

  // Normalization is a pure function of (kind, rawURL), and a render walks the
  // same module/instance URLs across a large linked-card graph, so the
  // string-canonicalization work dominates without a cache. Memoize it keyed by
  // a string (never a URL object) so repeats collapse to a single Map lookup.
  #normalizeCache = new Map<string, string | undefined>();

  // Recording a dependency is idempotent, so once a (kind, rawURL) has been
  // tracked under a given context it never needs to run again. A linksToMany of
  // N same-typed cards otherwise re-tracks that type's entire module graph once
  // per element — O(N) redundant canonicalization. This dedups only stack-top
  // contexts: those frames are built by withContext() (or the shared frozen
  // EMPTY_CONTEXT) and never mutated, so their identity soundly stands in for
  // their fields. Caller-supplied explicit contexts are part of the public API
  // and structurally mutable, so identity is NOT a safe key for them — they are
  // never deduped (matching the previous short-circuit's `!explicitContext`
  // guard). A WeakMap lets entries fall away with the contexts; reset alongside
  // #nodes so a cleared node map never leaves a stale "already tracked" marker
  // that would drop a real dependency.
  #trackedByContext = new WeakMap<
    RuntimeDependencyTrackingContext,
    Set<string>
  >();

  // Walk-level dedup for module-graph traversals (see shouldTrackModuleGraph).
  // Keyed by value — every context dimension that affects how a node is
  // recorded — so it collapses repeats that the identity-keyed
  // #trackedByContext cannot: explicit contexts (exempt from identity dedup)
  // and fresh merged contexts built by each withContext scope. Cleared in
  // reset() alongside #nodes so a cleared node map never inherits a stale
  // "already walked" marker that would drop real dependencies.
  #trackedModuleGraphs = new Set<string>();

  // Per-relationship-target dedup. A linksTo/linksToMany getter calls the
  // relationship-dependency walk (instance/file dep + the linked type's module
  // graph) on EVERY read, and a dense graph re-reads the same targets
  // combinatorially — so the per-call guard work (prototype/identity lookups
  // ahead of #trackedModuleGraphs, and the explicit-context branch of #track,
  // which is exempt from identity dedup and re-records every time) dominates
  // aggregate renders. This probe collapses every repeat to one Set lookup.
  // Keyed by value (everything #track/#recordNode derive from a context, plus
  // the target id) so a skipped repeat is a provable no-op, the same as
  // #trackedModuleGraphs. Cleared in reset() alongside #nodes so a cleared node
  // map never inherits a stale marker that would drop a real dependency.
  #trackedRelationships = new Set<string>();

  startSession({
    sessionKey,
    rootURL,
    rootKind = 'instance',
  }: RuntimeDependencyTrackerSessionOptions): void {
    if (this.#sessionKey !== sessionKey) {
      this.reset();
      this.#sessionKey = sessionKey;
    }
    this.#isActive = true;
    this.#setRoot(rootURL, rootKind);
  }

  stopSession(): void {
    if (!this.#isActive) {
      return;
    }
    this.#isActive = false;
    this.#contextStack = [];
  }

  reset(): void {
    this.#nodes.clear();
    this.#rootCandidates.clear();
    this.#contextStack = [];
    this.#normalizeCache.clear();
    this.#trackedByContext = new WeakMap();
    this.#trackedModuleGraphs.clear();
    this.#trackedRelationships.clear();
  }

  // A module-graph walk (tracking a module plus its transitive consumed
  // modules) records an identical node set every time it repeats under an
  // equivalent context, so the walk only needs to run once per session — but
  // the walks repeat heavily: every linksTo/linksToMany getter invocation
  // re-walks the linked type's graph once PER ELEMENT, multiplying render cost
  // by the graph size. Deduping inside #track can't help; by then the
  // composite-key build + hash (the actual cost) is already paid. This probe
  // lets callers skip the whole walk for the price of one Set lookup.
  //
  // Returns true exactly once per (scope, root module, recording-relevant
  // context) per session; the caller must then perform the full walk. The key
  // folds in contextLabel, consumer, and consumerKind — everything #track
  // derives from a context when recording — so a skipped repeat is a provable
  // no-op. `scope` namespaces call sites whose walks record different node
  // sets (e.g. one excludes shimmed modules), keeping a probe at one site from
  // suppressing a non-identical walk at another.
  //
  // Returns false while inactive: nothing records when inactive, so the walk
  // would be pure waste, and nothing is marked so the walk still runs in a
  // later active session.
  shouldTrackModuleGraph(
    scope: string,
    rootModule: string,
    explicitContext?: RuntimeDependencyTrackingContext,
  ): boolean {
    if (!this.#isActive) {
      return false;
    }
    let context = explicitContext ?? this.#currentContext();
    // consumerKind only influences recording when a consumer is present, and
    // then it defaults to 'instance' (mirroring #normalizeConsumer) — fold the
    // same resolution into the key so an omitted consumerKind dedups against
    // an explicit 'instance'.
    let consumerKind = context.consumer
      ? (context.consumerKind ?? 'instance')
      : '';
    let key = [
      scope,
      contextLabel(context),
      context.consumer ?? '',
      consumerKind,
      rootModule,
    ].join(CACHE_KEY_SEPARATOR);
    if (this.#trackedModuleGraphs.has(key)) {
      return false;
    }
    this.#trackedModuleGraphs.add(key);
    return true;
  }

  // Sibling of shouldTrackModuleGraph for the whole relationship-dependency walk
  // (instance/file dep + module graph) keyed on the target id. Returns true
  // exactly once per (recording-relevant context, id) per session; the caller
  // then performs the walk. A given id resolves to one resource, so its kind
  // (instance vs file) is fixed and need not be in the key. Returns false while
  // inactive — nothing records, so the walk would be pure waste and nothing is
  // marked, so it still runs in a later active session.
  shouldTrackRelationship(
    id: string,
    explicitContext?: RuntimeDependencyTrackingContext,
  ): boolean {
    if (!this.#isActive) {
      return false;
    }
    let context = explicitContext ?? this.#currentContext();
    let consumerKind = context.consumer
      ? (context.consumerKind ?? 'instance')
      : '';
    let key = [
      contextLabel(context),
      context.consumer ?? '',
      consumerKind,
      id,
    ].join(CACHE_KEY_SEPARATOR);
    if (this.#trackedRelationships.has(key)) {
      return false;
    }
    this.#trackedRelationships.add(key);
    return true;
  }

  withContext<T>(context: RuntimeDependencyTrackingContext, cb: () => T): T {
    if (!this.#isActive) {
      return cb();
    }

    let merged = {
      ...this.#currentContext(),
      ...context,
    } satisfies RuntimeDependencyTrackingContext;
    let token = Symbol('runtime-dependency-context');
    this.#contextStack.push({ token, context: merged });

    try {
      let result = cb();
      if (isPromiseLike(result)) {
        return result.finally(() => {
          this.#removeContextByToken(token);
        }) as T;
      }
      this.#removeContextByToken(token);
      return result;
    } catch (err) {
      this.#removeContextByToken(token);
      throw err;
    }
  }

  #removeContextByToken(token: symbol): void {
    let index = this.#contextStack.findIndex((entry) => entry.token === token);
    if (index !== -1) {
      this.#contextStack.splice(index, 1);
    }
  }

  trackModule(url: string, context?: RuntimeDependencyTrackingContext): void {
    this.#track('module', url, context);
  }

  trackInstance(url: string, context?: RuntimeDependencyTrackingContext): void {
    this.#track('instance', url, context);
  }

  trackFile(url: string, context?: RuntimeDependencyTrackingContext): void {
    this.#track('file', url, context);
  }

  snapshot({
    excludeQueryOnly = true,
  }: {
    excludeQueryOnly?: boolean;
  } = {}): RuntimeDependencyTrackerSnapshot {
    let deps: string[] = [];
    let excludedQueryOnlyDeps: string[] = [];
    let unscopedDeps: string[] = [];

    for (let [dep, record] of this.#nodes) {
      if (this.#rootCandidates.has(dep)) {
        continue;
      }

      if (excludeQueryOnly) {
        let hasNonQueryContext = record.nonQueryContexts.size > 0;
        let hasQueryContext = record.queryContexts.size > 0;
        if (
          !hasNonQueryContext &&
          hasQueryContext &&
          !record.hasUnscopedAccess
        ) {
          excludedQueryOnlyDeps.push(dep);
          continue;
        }
      }

      if (record.hasUnscopedAccess) {
        unscopedDeps.push(dep);
      }
      deps.push(dep);
    }

    deps.sort();
    excludedQueryOnlyDeps.sort();
    unscopedDeps.sort();

    return { deps, excludedQueryOnlyDeps, unscopedDeps };
  }

  #setRoot(
    rootURL: string | undefined,
    rootKind: Extract<RuntimeDependencyNodeKind, 'instance' | 'file'>,
  ) {
    this.#rootCandidates.clear();
    if (!rootURL) {
      return;
    }
    let normalized = this.#normalize(rootKind, rootURL);
    if (!normalized) {
      return;
    }
    this.#rootCandidates.add(normalized);
    // Root exclusion needs to account for callers that may reference the same
    // resource via extensionless and `.json` forms.
    let extensionless = normalized.replace(/\.json$/, '');
    this.#rootCandidates.add(extensionless);
    this.#rootCandidates.add(`${extensionless}.json`);
  }

  #track(
    kind: RuntimeDependencyNodeKind,
    rawURL: string,
    explicitContext?: RuntimeDependencyTrackingContext,
  ): void {
    if (!this.#isActive) {
      return;
    }

    let context = explicitContext ?? this.#currentContext();
    let key = normalizeCacheKey(kind, rawURL);

    // Already recorded this (kind, rawURL) under this stack-top context —
    // nothing more to do (see #trackedByContext). A repeat would re-derive the
    // identical node record, so skipping it is a pure no-op. Explicit contexts
    // are mutable public API, so they bypass the dedup and always record.
    let seen = explicitContext
      ? undefined
      : this.#trackedByContext.get(context);
    if (seen?.has(key)) {
      return;
    }

    let dep = this.#normalize(kind, rawURL, key);
    if (!dep) {
      return;
    }

    if (!explicitContext) {
      if (!seen) {
        seen = new Set();
        this.#trackedByContext.set(context, seen);
      }
      seen.add(key);
    }

    let label = contextLabel(context);
    let consumer = this.#normalizeConsumer(context, label);

    this.#recordNode(dep, kind, context.mode, label, !consumer);
  }

  #normalize(
    kind: RuntimeDependencyNodeKind,
    rawURL: string,
    key: string = normalizeCacheKey(kind, rawURL),
  ): string | undefined {
    let cached = this.#normalizeCache.get(key);
    if (cached !== undefined) {
      return cached;
    }
    if (this.#normalizeCache.has(key)) {
      // A URL with no canonical form (e.g. a non-http reference) memoizes as
      // undefined; the `has` check keeps us from recomputing it.
      return undefined;
    }
    let result = normalizeByKind(kind, rawURL);
    this.#normalizeCache.set(key, result);
    return result;
  }

  #normalizeConsumer(
    context: RuntimeDependencyTrackingContext,
    label: string,
  ): {
    url: string;
    kind: RuntimeDependencyNodeKind;
  } | null {
    if (!context.consumer) {
      return null;
    }
    let preferredKind = context.consumerKind ?? 'instance';
    let preferredURL = this.#normalize(preferredKind, context.consumer);
    if (preferredURL) {
      this.#recordNode(preferredURL, preferredKind, context.mode, label, false);
      return { url: preferredURL, kind: preferredKind };
    }

    let fallbackFile = this.#normalize('file', context.consumer);
    if (fallbackFile) {
      this.#recordNode(fallbackFile, 'file', context.mode, label, false);
      return { url: fallbackFile, kind: 'file' };
    }
    return null;
  }

  #recordNode(
    dep: string,
    kind: RuntimeDependencyNodeKind,
    mode: RuntimeDependencyContextMode | undefined,
    label: string,
    unscoped: boolean,
  ) {
    let record = this.#nodes.get(dep);
    if (!record) {
      record = {
        kinds: new Set(),
        queryContexts: new Set(),
        nonQueryContexts: new Set(),
        hasUnscopedAccess: false,
      };
      this.#nodes.set(dep, record);
    }

    record.kinds.add(kind);
    if (mode === 'query') {
      record.queryContexts.add(label);
    } else {
      record.nonQueryContexts.add(label);
    }
    if (unscoped) {
      record.hasUnscopedAccess = true;
    }
  }

  #currentContext(): RuntimeDependencyTrackingContext {
    return (
      this.#contextStack[this.#contextStack.length - 1]?.context ??
      EMPTY_CONTEXT
    );
  }
}

let tracker: RuntimeDependencyTracker | undefined;

function getTracker(): RuntimeDependencyTracker {
  if (!tracker) {
    tracker = new RuntimeDependencyTracker();
  }
  return tracker;
}

export function beginRuntimeDependencyTrackingSession(
  options: RuntimeDependencyTrackerSessionOptions,
): void {
  getTracker().startSession(options);
}

export function endRuntimeDependencyTrackingSession(): void {
  getTracker().stopSession();
}

export function resetRuntimeDependencyTracker(): void {
  getTracker().reset();
}

export function withRuntimeDependencyTrackingContext<T>(
  context: RuntimeDependencyTrackingContext,
  cb: () => T,
): T {
  return getTracker().withContext(context, cb);
}

export function trackRuntimeModuleDependency(
  url: string,
  context?: RuntimeDependencyTrackingContext,
): void {
  getTracker().trackModule(url, context);
}

export function shouldTrackRuntimeModuleGraph(
  scope: string,
  rootModule: string,
  context?: RuntimeDependencyTrackingContext,
): boolean {
  return getTracker().shouldTrackModuleGraph(scope, rootModule, context);
}

export function shouldTrackRuntimeRelationship(
  id: string,
  context?: RuntimeDependencyTrackingContext,
): boolean {
  return getTracker().shouldTrackRelationship(id, context);
}

export function trackRuntimeInstanceDependency(
  url: string,
  context?: RuntimeDependencyTrackingContext,
): void {
  getTracker().trackInstance(url, context);
}

export function trackRuntimeFileDependency(
  url: string,
  context?: RuntimeDependencyTrackingContext,
): void {
  getTracker().trackFile(url, context);
}

export function snapshotRuntimeDependencies(opts?: {
  excludeQueryOnly?: boolean;
}): RuntimeDependencyTrackerSnapshot {
  return getTracker().snapshot(opts);
}

export function runtimeQueryDependencyContext(
  opts: RuntimeDependencyConsumerContext & {
    queryField: string;
    source: string;
  },
): RuntimeDependencyTrackingContext {
  return {
    mode: 'query',
    queryField: opts.queryField,
    source: opts.source,
    consumer: opts.consumer,
    consumerKind: opts.consumerKind ?? 'instance',
  };
}

export function runtimeNonQueryDependencyContext(
  opts: RuntimeDependencyConsumerContext & {
    source: string;
  },
): RuntimeDependencyTrackingContext {
  return {
    mode: 'non-query',
    source: opts.source,
    consumer: opts.consumer,
    consumerKind: opts.consumerKind ?? 'instance',
  };
}

export function runtimeDependencyContextWithSource(
  context: RuntimeDependencyTrackingContext | undefined,
  source: string,
): RuntimeDependencyTrackingContext | undefined {
  if (!context) {
    return undefined;
  }
  return {
    ...context,
    source,
  };
}
