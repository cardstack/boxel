import { tracked } from '@glimmer/tracking';

import { executableExtensions } from '@cardstack/runtime-common';
import { transpileJS } from '@cardstack/runtime-common/transpile';

import {
  classifyCardSourceForSandbox,
  type CardRenderSandboxTier,
  type CardSourceSandboxClassification,
} from '@cardstack/host/lib/realm-sandbox-source-policy';

export const CodePreviewSandboxContextName = 'code-preview-sandbox';

let nextPreviewSandbox = 0;

export interface CodePreviewDraft {
  readonly sourceURL: string;
  readonly source: string;
  readonly revision: number;
}

export interface CodePreviewError {
  type: 'compile' | 'runtime';
  message: string;
}

export type CodePreviewGenerationPhase =
  | 'idle'
  | 'draft'
  | 'evaluating'
  | 'rendered'
  | 'persisting'
  | 'persisted'
  | 'acknowledged'
  | 'failed';

export interface CodePreviewGenerationState {
  readonly phase: CodePreviewGenerationPhase;
  readonly revision: number;
  readonly sourceURL?: string;
  readonly lastKnownGoodRevision?: number;
  readonly clientRequestId?: string;
  readonly error?: CodePreviewError;
}

export interface PreparedCodePreviewCommit {
  readonly clientRequestId: string;
  shouldDeferStoreRefresh(): boolean;
  persisted(): void;
  failed(): void;
}

export interface VolatileModuleGeneration {
  readonly sourceURL: string;
  readonly source: string;
  readonly revision: number;
  readonly expiresAt: number;
}

// Fast, deterministic source fingerprint for in-memory caches. Callers retain
// and compare the full source alongside this key, so a hash collision can
// only replace a cache entry, never execute another source's compiled output.
export function codePreviewSourceHash(source: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index++) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${source.length}:${(hash >>> 0).toString(36)}`;
}

// Keep recently edited modules in their stable HMR sandbox long enough for a
// natural editing pause without handing them back to the canonical loader.
export const DEFAULT_VOLATILE_MODULE_QUIET_PERIOD_MS = 90_000;

export function codePreviewModuleKey(sourceURL: string): string {
  let url = new URL(sourceURL);
  url.search = '';
  url.hash = '';
  for (let extension of executableExtensions) {
    if (url.pathname.endsWith(extension)) {
      url.pathname = url.pathname.slice(0, -extension.length);
      break;
    }
  }
  return url.href;
}

// Source mutation is the boundary that makes a module volatile. Monaco and
// AI search/replace both publish into this short-lived buffer; neither Code
// mode nor Act mode is itself sufficient. The buffer lets consecutive edits
// compose without waiting for the realm/indexing round trip, then expires back
// to the ordinary canonical loader after a quiet period.
export class VolatileModuleRegistry {
  private modules = new Map<string, VolatileModuleGeneration>();
  // Keep the most recently published object separate from the expiring lease.
  // Async lint/save work uses object identity to prove that no newer source
  // generation was published while it yielded. Expiration alone must not make
  // a slow lint response look stale, while clear() must invalidate it.
  private latestPublished = new Map<string, VolatileModuleGeneration>();

  constructor(
    private quietPeriodMs = DEFAULT_VOLATILE_MODULE_QUIET_PERIOD_MS,
    private now: () => number = () => Date.now(),
  ) {}

  begin(sourceURL: string, canonicalSource: string): VolatileModuleGeneration {
    let current = this.current(sourceURL);
    if (current) {
      return current;
    }
    return this.publish(sourceURL, canonicalSource);
  }

  publish(sourceURL: string, source: string): VolatileModuleGeneration {
    let key = codePreviewModuleKey(sourceURL);
    let previous = this.current(sourceURL);
    let generation = Object.freeze({
      sourceURL,
      source,
      revision: (previous?.revision ?? 0) + 1,
      expiresAt: this.now() + this.quietPeriodMs,
    });
    this.modules.set(key, generation);
    this.latestPublished.set(key, generation);
    return generation;
  }

  isLatestPublished(generation: VolatileModuleGeneration): boolean {
    return (
      this.latestPublished.get(codePreviewModuleKey(generation.sourceURL)) ===
      generation
    );
  }

  current(sourceURL: string): VolatileModuleGeneration | undefined {
    let key = codePreviewModuleKey(sourceURL);
    let generation = this.modules.get(key);
    if (generation && generation.expiresAt <= this.now()) {
      this.modules.delete(key);
      return undefined;
    }
    return generation;
  }

  isVolatile(sourceURL: string): boolean {
    return this.current(sourceURL) != null;
  }

  clear(sourceURL: string): void {
    let key = codePreviewModuleKey(sourceURL);
    this.modules.delete(key);
    this.latestPublished.delete(key);
  }
}

// Monaco owns raw editable GTS/TS source, while Loader consumes compiled
// JavaScript (and performs its own ESM-to-AMD registration transform). Keep
// the source conversion explicit at every execution boundary so SES and
// iframe previews consume the same immutable draft generation.
export function compileCodePreviewDraftSource(
  draft: CodePreviewDraft,
): Promise<string> {
  let debugFilename: string;
  try {
    debugFilename = new URL(draft.sourceURL).pathname;
  } catch {
    debugFilename = draft.sourceURL;
  }
  return transpileJS(draft.source, debugFilename);
}

export function sameCodePreviewModuleURL(left: string, right: string): boolean {
  try {
    return codePreviewModuleKey(left) === codePreviewModuleKey(right);
  } catch {
    return false;
  }
}

interface CachedCodePreviewAnalysis {
  source: string;
  classification?: Promise<CardSourceSandboxClassification>;
  compiled?: Promise<string>;
}

// Classification and transpilation are source-derived and independent of an
// Ember service or a particular preview instance. Keeping the bounded LRU here
// prevents each renderer path from parsing the same draft independently.
export class CodePreviewAnalysisCache {
  private analyses = new Map<string, CachedCodePreviewAnalysis>();

  constructor(
    private onHit: () => void = () => undefined,
    private onMiss: () => void = () => undefined,
    private maxEntries = 64,
  ) {}

  classificationFor(
    draft: Pick<CodePreviewDraft, 'sourceURL' | 'source'>,
  ): Promise<CardSourceSandboxClassification> {
    let analysis = this.analysisFor(draft);
    analysis.classification ??= classifyCardSourceForSandbox(draft.source);
    return analysis.classification;
  }

  compiledFor(
    draft: Pick<CodePreviewDraft, 'sourceURL' | 'source' | 'revision'>,
  ): Promise<string> {
    let analysis = this.analysisFor(draft);
    analysis.compiled ??= compileCodePreviewDraftSource(draft);
    return analysis.compiled;
  }

  prewarm(draft: CodePreviewDraft): void {
    void this.classificationFor(draft).catch(() => undefined);
    void this.compiledFor(draft).catch(() => undefined);
  }

  private analysisFor(
    draft: Pick<CodePreviewDraft, 'sourceURL' | 'source'>,
  ): CachedCodePreviewAnalysis {
    let key = `${codePreviewModuleKey(draft.sourceURL)}|${codePreviewSourceHash(draft.source)}`;
    let analysis = this.analyses.get(key);
    if (analysis?.source === draft.source) {
      this.onHit();
      this.analyses.delete(key);
      this.analyses.set(key, analysis);
      return analysis;
    }
    this.onMiss();
    analysis = { source: draft.source };
    this.analyses.set(key, analysis);
    while (this.analyses.size > this.maxEntries) {
      let oldest = this.analyses.keys().next().value as string | undefined;
      if (oldest == null) {
        break;
      }
      this.analyses.delete(oldest);
    }
    return analysis;
  }
}

// One instance belongs to one mounted Code mode surface. The unsaved Monaco
// buffer is deliberately held outside the Store and ordinary realm loaders so
// an editor can evaluate drafts without changing Interact or another preview.
export default class CodePreviewSandbox {
  readonly id = `code-preview-${++nextPreviewSandbox}`;
  active = true;

  // Source and revision are one atomic value. Evaluators must capture this
  // object before they yield so revision N can never fetch revision N + 1's
  // mutable source while Monaco is producing another change.
  @tracked draft?: CodePreviewDraft;
  // Code mode starts in its private SES runtime. Source classification can
  // promote DOM-heavy isolated/embedded/edit rendering to an iframe, but the
  // format policy is applied by CardRenderer: fitted, atom, head, and markdown
  // always remain composable SES surfaces.
  @tracked sandboxTier: CardRenderSandboxTier = 'compartment';
  @tracked sandboxReason = 'code-preview-ses';
  @tracked moduleError?: CodePreviewError;
  // One monotonic record connects the local draft, sandbox evaluation,
  // persistence, realm acknowledgement, and last-known-good render. Async
  // callbacks carry the immutable draft/client id they started with and are
  // ignored when a newer generation has become current.
  @tracked generationState: CodePreviewGenerationState = {
    phase: 'idle',
    revision: 0,
  };
  private canonicalRefreshDeferred = false;
  private draftClassifications = new WeakMap<
    CodePreviewDraft,
    Promise<CardSourceSandboxClassification>
  >();

  get sourceURL() {
    return this.draft?.sourceURL;
  }

  get source() {
    return this.draft?.source;
  }

  get revision() {
    return this.draft?.revision ?? 0;
  }

  update(sourceURL: string, source: string) {
    if (this.sourceURL === sourceURL && this.source === source) {
      return;
    }
    let changedModule =
      this.sourceURL != null &&
      !sameCodePreviewModuleURL(this.sourceURL, sourceURL);
    let draft = Object.freeze({
      sourceURL,
      source,
      revision: this.revision + 1,
    });
    this.draft = draft;
    this.generationState = {
      phase: 'draft',
      revision: draft.revision,
      sourceURL: draft.sourceURL,
      ...(this.generationState.lastKnownGoodRevision != null
        ? {
            lastKnownGoodRevision: this.generationState.lastKnownGoodRevision,
          }
        : {}),
    };
    if (changedModule) {
      this.moduleError = undefined;
    }
  }

  reload() {
    let current = this.draft;
    if (!current) {
      return false;
    }
    this.draft = Object.freeze({
      sourceURL: current.sourceURL,
      source: current.source,
      revision: current.revision + 1,
    });
    this.generationState = {
      phase: 'draft',
      revision: this.draft.revision,
      sourceURL: this.draft.sourceURL,
      ...(this.generationState.lastKnownGoodRevision != null
        ? {
            lastKnownGoodRevision: this.generationState.lastKnownGoodRevision,
          }
        : {}),
    };
    return true;
  }

  markEvaluating(expectedDraft: CodePreviewDraft | undefined) {
    if (!this.isCurrentDraft(expectedDraft)) {
      return;
    }
    this.transition(expectedDraft, 'evaluating');
  }

  markRendered(expectedDraft: CodePreviewDraft | undefined) {
    if (!this.isCurrentDraft(expectedDraft)) {
      return;
    }
    this.moduleError = undefined;
    this.generationState = {
      phase: 'rendered',
      revision: expectedDraft.revision,
      sourceURL: expectedDraft.sourceURL,
      lastKnownGoodRevision: expectedDraft.revision,
    };
  }

  markCommitPrepared(
    expectedDraft: CodePreviewDraft | undefined,
    clientRequestId: string,
  ) {
    if (!this.isCurrentDraft(expectedDraft)) {
      return;
    }
    this.transition(expectedDraft, 'persisting', clientRequestId);
  }

  markCommitPersisted(
    expectedDraft: CodePreviewDraft | undefined,
    clientRequestId: string,
  ) {
    if (!this.isCurrentDraft(expectedDraft)) {
      return;
    }
    this.transition(expectedDraft, 'persisted', clientRequestId);
  }

  markCommitAcknowledged(
    expectedDraft: CodePreviewDraft | undefined,
    clientRequestId: string,
  ) {
    if (!this.isCurrentDraft(expectedDraft)) {
      return;
    }
    this.transition(expectedDraft, 'acknowledged', clientRequestId);
  }

  markCommitFailed(
    expectedDraft: CodePreviewDraft | undefined,
    clientRequestId: string,
    error = 'The source change could not be persisted',
  ) {
    if (!this.isCurrentDraft(expectedDraft)) {
      return;
    }
    let failure: CodePreviewError = { type: 'runtime', message: error };
    this.generationState = {
      phase: 'failed',
      revision: expectedDraft.revision,
      sourceURL: expectedDraft.sourceURL,
      clientRequestId,
      error: failure,
      ...(this.generationState.lastKnownGoodRevision != null
        ? {
            lastKnownGoodRevision: this.generationState.lastKnownGoodRevision,
          }
        : {}),
    };
  }

  classificationFor(
    draft = this.draft,
  ): Promise<CardSourceSandboxClassification> | undefined {
    if (!draft) {
      return undefined;
    }
    let classification = this.draftClassifications.get(draft);
    if (!classification) {
      classification = classifyCardSourceForSandbox(draft.source);
      this.draftClassifications.set(draft, classification);
    }
    return classification;
  }

  applySandboxDecision(tier: CardRenderSandboxTier, reason: string) {
    if (!this.active) {
      return;
    }
    this.sandboxTier = tier;
    this.sandboxReason = reason;
  }

  reportError(
    expectedDraft: CodePreviewDraft | undefined,
    error: unknown,
    type: CodePreviewError['type'] = 'runtime',
  ) {
    if (!this.active || !expectedDraft || this.draft !== expectedDraft) {
      return;
    }
    let detail =
      error instanceof Error
        ? (error.stack ?? `${error.name}: ${error.message}`)
        : String(error);
    this.moduleError = {
      type,
      message: `Unable to render the current preview for ${expectedDraft.sourceURL}:\n\n${detail}`,
    };
    this.generationState = {
      phase: 'failed',
      revision: expectedDraft.revision,
      sourceURL: expectedDraft.sourceURL,
      error: this.moduleError,
      ...(this.generationState.lastKnownGoodRevision != null
        ? {
            lastKnownGoodRevision: this.generationState.lastKnownGoodRevision,
          }
        : {}),
    };
  }

  clearError(expectedDraft: CodePreviewDraft | undefined) {
    if (this.active && expectedDraft && this.draft === expectedDraft) {
      this.moduleError = undefined;
    }
  }

  onRenderError = (error: unknown) => {
    this.reportError(this.draft, error);
  };

  onIframeGenerationResult = (revision: number, error?: string) => {
    let expectedDraft = this.draft;
    if (!expectedDraft || expectedDraft.revision !== revision) {
      return;
    }
    if (error) {
      this.reportError(expectedDraft, new Error(error), 'runtime');
    } else {
      this.markRendered(expectedDraft);
    }
  };

  matchesDraft(sourceURL: string, source: string) {
    return (
      this.active &&
      this.draft != null &&
      sameCodePreviewModuleURL(this.draft.sourceURL, sourceURL) &&
      this.draft.source === source
    );
  }

  // A locally-rendered revision remains authoritative for its mounted Code
  // mode preview after persistence. Canonical Store consumers still need one
  // refresh, but doing it between the POST response and matching realm event
  // would destroy the stable preview boundary.
  deferCanonicalRefresh() {
    this.canonicalRefreshDeferred = true;
  }

  consumeDeferredCanonicalRefresh() {
    let deferred = this.canonicalRefreshDeferred;
    this.canonicalRefreshDeferred = false;
    return deferred;
  }

  deactivate() {
    this.active = false;
  }

  private isCurrentDraft(
    expectedDraft: CodePreviewDraft | undefined,
  ): expectedDraft is CodePreviewDraft {
    return this.active && expectedDraft != null && this.draft === expectedDraft;
  }

  private transition(
    draft: CodePreviewDraft,
    phase: CodePreviewGenerationPhase,
    clientRequestId?: string,
  ) {
    this.generationState = {
      phase,
      revision: draft.revision,
      sourceURL: draft.sourceURL,
      ...(clientRequestId ? { clientRequestId } : {}),
      ...(this.generationState.lastKnownGoodRevision != null
        ? {
            lastKnownGoodRevision: this.generationState.lastKnownGoodRevision,
          }
        : {}),
    };
  }
}
