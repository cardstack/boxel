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
  #contextStack: RuntimeDependencyTrackingContext[] = [];
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

  withContext<T>(
    context: RuntimeDependencyTrackingContext,
    cb: () => T,
  ): T {
    if (!this.#isActive) {
      return cb();
    }

    let merged = {
      ...this.#currentContext(),
      ...context,
    } satisfies RuntimeDependencyTrackingContext;
    this.#contextStack.push(merged);

    try {
      let result = cb();
      if (isPromiseLike(result)) {
        return result.finally(() => {
          this.#contextStack.pop();
        }) as T;
      }
      this.#contextStack.pop();
      return result;
    } catch (err) {
      this.#contextStack.pop();
      throw err;
    }
  }

  trackModule(url: string): void {
    this.#track('module', url);
  }

  trackInstance(url: string): void {
    this.#track('instance', url);
  }

  trackFile(url: string): void {
    this.#track('file', url);
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
        if (!hasNonQueryContext && hasQueryContext && !record.hasUnscopedAccess) {
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
    if (rootKind === 'instance') {
      this.#rootCandidates.add(normalized.replace(/\.json$/, ''));
    } else {
      this.#rootCandidates.add(normalized.replace(/\.json$/, ''));
      this.#rootCandidates.add(`${normalized}.json`);
    }
  }

  #track(kind: RuntimeDependencyNodeKind, rawURL: string): void {
    if (!this.#isActive) {
      return;
    }
    let dep = normalizeByKind(kind, rawURL);
    if (!dep) {
      return;
    }

    let context = this.#currentContext();
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
    return this.#contextStack[this.#contextStack.length - 1] ?? {};
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

export function trackRuntimeModuleDependency(url: string): void {
  getTracker().trackModule(url);
}

export function trackRuntimeInstanceDependency(url: string): void {
  getTracker().trackInstance(url);
}

export function trackRuntimeFileDependency(url: string): void {
  getTracker().trackFile(url);
}

export function snapshotRuntimeDependencies(opts?: {
  excludeQueryOnly?: boolean;
}): RuntimeDependencyTrackerSnapshot {
  return getTracker().snapshot(opts);
}
