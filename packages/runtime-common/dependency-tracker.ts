import { logger } from './log';
import { trimExecutableExtension } from './index';

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

interface EdgeRecord {
  from: string;
  to: string;
  contexts: Set<string>;
}

interface ContextStackEntry {
  token: symbol;
  context: RuntimeDependencyTrackingContext;
}

function canonicalURL(url: string): string | undefined {
  try {
    let parsed = new URL(url);
    parsed.search = '';
    parsed.hash = '';
    return parsed.href;
  } catch (_err) {
    return undefined;
  }
}

function hasPathExtension(pathname: string): boolean {
  let segment = pathname.split('/').pop() ?? '';
  if (segment.length === 0) {
    return false;
  }
  return segment.includes('.');
}

function normalizeModuleURL(url: string): string | undefined {
  let canonical = canonicalURL(url);
  if (!canonical) {
    return undefined;
  }
  return trimExecutableExtension(new URL(canonical)).href;
}

function normalizeInstanceURL(url: string): string | undefined {
  let canonical = canonicalURL(url);
  if (!canonical) {
    return undefined;
  }
  let parsed = new URL(canonical);
  if (!hasPathExtension(parsed.pathname)) {
    parsed.pathname = `${parsed.pathname}.json`;
  }
  return parsed.href;
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
  #summaryLog: ReturnType<typeof logger> | undefined;
  #edgesLog: ReturnType<typeof logger> | undefined;
  #sessionKey: string | undefined;
  #isActive = false;
  #contextStack: ContextStackEntry[] = [];
  #nodes = new Map<string, NodeRecord>();
  #edges = new Map<string, EdgeRecord>();
  #rootCandidates = new Set<string>();

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
    this.#summaryLogger().debug(`start session ${sessionKey}`);
  }

  stopSession(): void {
    if (!this.#isActive) {
      return;
    }
    this.#summaryLogger().debug(`stop session ${this.#sessionKey ?? '(none)'}`);
    this.#isActive = false;
    this.#contextStack = [];
  }

  reset(): void {
    this.#nodes.clear();
    this.#edges.clear();
    this.#rootCandidates.clear();
    this.#contextStack = [];
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

    this.#summaryLogger().debug(
      `session=${this.#sessionKey ?? '(none)'} deps=${deps.length} excludedQueryOnly=${excludedQueryOnlyDeps.length} unscoped=${unscopedDeps.length} nodes=${this.#nodes.size} edges=${this.#edges.size}`,
    );

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
    let dep = normalizeByKind(kind, rawURL);
    if (!dep) {
      return;
    }

    let context = explicitContext ?? this.#currentContext();
    let label = contextLabel(context);
    let consumer = this.#normalizeConsumer(context);

    this.#recordNode(dep, kind, context, !consumer);
    if (!consumer) {
      this.#edgesLogger().debug(`unscoped ${kind} ${dep} context=${label}`);
      return;
    }

    this.#recordEdge(consumer.url, dep, label);
    this.#edgesLogger().debug(
      `edge ${consumer.url} -> ${dep} context=${label} source=${context.source ?? '(unknown-source)'}`,
    );
  }

  #normalizeConsumer(context: RuntimeDependencyTrackingContext): {
    url: string;
    kind: RuntimeDependencyNodeKind;
  } | null {
    if (!context.consumer) {
      return null;
    }
    let preferredKind = context.consumerKind ?? 'instance';
    let preferredURL = normalizeByKind(preferredKind, context.consumer);
    if (preferredURL) {
      this.#recordNode(preferredURL, preferredKind, context, false);
      return { url: preferredURL, kind: preferredKind };
    }

    let fallbackFile = normalizeFileURL(context.consumer);
    if (fallbackFile) {
      this.#recordNode(fallbackFile, 'file', context, false);
      return { url: fallbackFile, kind: 'file' };
    }
    return null;
  }

  #recordNode(
    dep: string,
    kind: RuntimeDependencyNodeKind,
    context: RuntimeDependencyTrackingContext,
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
    if (context.mode === 'query') {
      record.queryContexts.add(contextLabel(context));
    } else {
      record.nonQueryContexts.add(contextLabel(context));
    }
    if (unscoped) {
      record.hasUnscopedAccess = true;
    }
  }

  #recordEdge(from: string, to: string, context: string) {
    let key = `${from}|${to}`;
    let edge = this.#edges.get(key);
    if (!edge) {
      edge = {
        from,
        to,
        contexts: new Set(),
      };
      this.#edges.set(key, edge);
    }
    edge.contexts.add(context);
  }

  #currentContext(): RuntimeDependencyTrackingContext {
    return this.#contextStack[this.#contextStack.length - 1]?.context ?? {};
  }

  #summaryLogger(): ReturnType<typeof logger> {
    if (!this.#summaryLog) {
      this.#summaryLog = logger('dependency-tracker:summary');
    }
    return this.#summaryLog;
  }

  #edgesLogger(): ReturnType<typeof logger> {
    if (!this.#edgesLog) {
      this.#edgesLog = logger('dependency-tracker:edges');
    }
    return this.#edgesLog;
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
