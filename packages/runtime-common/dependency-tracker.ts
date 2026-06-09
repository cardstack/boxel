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

export class RuntimeDependencyTracker {
  #sessionKey: string | undefined;
  #isActive = false;
  #contextStack: ContextStackEntry[] = [];
  #nodes = new Map<string, NodeRecord>();
  #rootCandidates = new Set<string>();

  // Short-circuit cache: repeated field reads under the same context call
  // #track with the same (kind, rawURL, context) triple. Skipping those is
  // safe because all downstream work (normalization, Set.add) is idempotent.
  #lastTrackKind: RuntimeDependencyNodeKind | undefined;
  #lastTrackRawURL: string | undefined;
  #lastTrackContext: RuntimeDependencyTrackingContext | undefined;

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
    this.#clearTrackCache();
  }

  reset(): void {
    this.#nodes.clear();
    this.#rootCandidates.clear();
    this.#contextStack = [];
    this.#clearTrackCache();
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
    let normalized = normalizeByKind(rootKind, rootURL);
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

    // The short-circuit cache only applies to stack-top contexts. Those frames
    // are constructed inside withContext() and never mutated afterward, so
    // reference equality is sound. Caller-supplied explicit contexts are
    // structurally mutable, so identity equality does not imply field equality.
    if (
      !explicitContext &&
      rawURL === this.#lastTrackRawURL &&
      kind === this.#lastTrackKind &&
      context === this.#lastTrackContext
    ) {
      return;
    }

    let dep = normalizeByKind(kind, rawURL);
    if (!dep) {
      return;
    }

    if (!explicitContext) {
      this.#lastTrackKind = kind;
      this.#lastTrackRawURL = rawURL;
      this.#lastTrackContext = context;
    }

    let label = contextLabel(context);
    let consumer = this.#normalizeConsumer(context, label);

    this.#recordNode(dep, kind, context.mode, label, !consumer);
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
    let preferredURL = normalizeByKind(preferredKind, context.consumer);
    if (preferredURL) {
      this.#recordNode(preferredURL, preferredKind, context.mode, label, false);
      return { url: preferredURL, kind: preferredKind };
    }

    let fallbackFile = normalizeFileURL(context.consumer);
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
    return this.#contextStack[this.#contextStack.length - 1]?.context ?? {};
  }

  #clearTrackCache(): void {
    this.#lastTrackKind = undefined;
    this.#lastTrackRawURL = undefined;
    this.#lastTrackContext = undefined;
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
