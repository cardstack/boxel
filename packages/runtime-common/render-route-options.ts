import stringify from 'safe-stable-stringify';
import { isResolvedCodeRef } from './code-ref.ts';
import type { ResolvedCodeRef } from './code-ref.ts';
import type { FileDefBindings } from './file-def-bindings.ts';

export interface RenderRouteOptions {
  // Drop everything the tab has cached before the render: its evaluated
  // module graph, its HTTP fetch cache, and its store. The expensive half is
  // the module graph — the first card after a drop re-fetches and
  // re-evaluates every module it reaches — so this is for callers that need
  // the module bytes re-read, not for callers that only need a clean store.
  clearCache?: true;
  // Drop only the tab's store: the instances it holds resident, the
  // documents it has cached, and the local-id pairings it has resolved. An
  // index pass sends this on its first render so that no pass is handed an
  // instance another pass left behind. It is the cheap half of `clearCache`,
  // and the half that does not depend on whether any module changed.
  //
  // The out-of-process prerender server closes the same gap a second way, by
  // tagging each visit with its render scope so the store can observe the job
  // boundary itself (`GcCardStore.observeIndexingJob`). The in-browser driver
  // tags nothing, so there this flag is the only thing that moves that
  // boundary — which is why it is sent per pass rather than left to the scope.
  resetStore?: true;
  // The realm's loader epoch this render belongs to (see
  // `RealmGenerationsTable.loader_epoch`). The render route resets its
  // loader + store when this differs from the epoch the tab last cleared
  // for, then records it — one reset per tab per module change.
  loaderEpoch?: string;
  cardRender?: true;
  fileExtract?: true;
  fileRender?: true;
  fileDefCodeRef?: ResolvedCodeRef;
  fileContentHash?: string;
  fileContentSize?: number;
  // The file's server-side timestamps (epoch seconds), so the extract's
  // resource carries the same `meta.lastModified` / `meta.resourceCreatedAt`
  // the realm stamps on a served file-meta document. The fileRender pass
  // hydrates its FileDef from that resource, and the FileDef shells render
  // the modified time from `meta` — without these the prerendered HTML omits
  // a segment that a live render of the same file shows.
  fileLastModified?: number;
  fileCreatedAt?: number;
  // The realm's own binding of file extension to FileDef subclass, for the
  // realm this render belongs to.
  //
  // `fileDefCodeRef` above types the file the render targets. This types the
  // files the render *reaches*: a card whose template renders a linked FileDef
  // makes the render store build that file's metadata document itself, from
  // the bytes, rather than fetching the document the realm would have typed.
  // Without the realm's bindings that store resolves the platform default, and
  // the prerendered HTML shows the base class's template for a file whose row
  // says it is the author's subclass.
  //
  // Carried with the realm it came from, because a card may link a file in
  // another realm and one realm's bindings say nothing about another's.
  fileDefBindings?: { realm: string; types: FileDefBindings };
}

function isFileDefBindings(
  value: unknown,
): value is { realm: string; types: FileDefBindings } {
  if (value == null || typeof value !== 'object') {
    return false;
  }
  let { realm, types } = value as { realm?: unknown; types?: unknown };
  if (typeof realm !== 'string' || types == null || typeof types !== 'object') {
    return false;
  }
  return Object.values(types as Record<string, unknown>).every(
    (ref) => ref != null && typeof ref === 'object' && isResolvedCodeRef(ref),
  );
}

export function parseRenderRouteOptions(
  raw: string | undefined | null,
): RenderRouteOptions {
  if (!raw) {
    return {};
  }
  try {
    let parsed = JSON.parse(raw) as RenderRouteOptions;
    let options: RenderRouteOptions = {};
    if (parsed.clearCache) {
      options.clearCache = true;
    }
    if (parsed.resetStore) {
      options.resetStore = true;
    }
    if (typeof parsed.loaderEpoch === 'string') {
      options.loaderEpoch = parsed.loaderEpoch;
    }
    if (parsed.cardRender) {
      options.cardRender = true;
    }
    if (parsed.fileExtract) {
      options.fileExtract = true;
      if (isResolvedCodeRef(parsed.fileDefCodeRef)) {
        options.fileDefCodeRef = parsed.fileDefCodeRef;
      }
      if (typeof parsed.fileContentHash === 'string') {
        options.fileContentHash = parsed.fileContentHash;
      }
      if (typeof parsed.fileContentSize === 'number') {
        options.fileContentSize = parsed.fileContentSize;
      }
      if (typeof parsed.fileLastModified === 'number') {
        options.fileLastModified = parsed.fileLastModified;
      }
      if (typeof parsed.fileCreatedAt === 'number') {
        options.fileCreatedAt = parsed.fileCreatedAt;
      }
    }
    if (parsed.fileRender) {
      options.fileRender = true;
      if (isResolvedCodeRef(parsed.fileDefCodeRef)) {
        options.fileDefCodeRef = parsed.fileDefCodeRef;
      }
    }
    // Not gated on any pass: the render that needs these is the card render,
    // which reaches a linked file the other passes never name.
    if (isFileDefBindings(parsed.fileDefBindings)) {
      options.fileDefBindings = parsed.fileDefBindings;
    }
    return options;
  } catch {
    return {};
  }
}

export function serializeRenderRouteOptions(
  options: RenderRouteOptions = {},
): string {
  let serialized: RenderRouteOptions = {};
  if (options.clearCache) {
    serialized.clearCache = true;
  }
  if (options.resetStore) {
    serialized.resetStore = true;
  }
  if (options.loaderEpoch !== undefined) {
    serialized.loaderEpoch = options.loaderEpoch;
  }
  if (options.cardRender) {
    serialized.cardRender = true;
  }
  if (options.fileExtract) {
    serialized.fileExtract = true;
    if (options.fileDefCodeRef) {
      serialized.fileDefCodeRef = options.fileDefCodeRef;
    }
    if (options.fileContentHash) {
      serialized.fileContentHash = options.fileContentHash;
    }
    if (options.fileContentSize !== undefined) {
      serialized.fileContentSize = options.fileContentSize;
    }
    if (options.fileLastModified !== undefined) {
      serialized.fileLastModified = options.fileLastModified;
    }
    if (options.fileCreatedAt !== undefined) {
      serialized.fileCreatedAt = options.fileCreatedAt;
    }
  }
  if (options.fileRender) {
    serialized.fileRender = true;
    if (options.fileDefCodeRef) {
      serialized.fileDefCodeRef = options.fileDefCodeRef;
    }
  }
  // Omitted for a realm that binds nothing, so the option adds nothing to the
  // render URL of every realm that has not asked for one.
  if (
    options.fileDefBindings &&
    Object.keys(options.fileDefBindings.types).length > 0
  ) {
    serialized.fileDefBindings = options.fileDefBindings;
  }
  return stringify(serialized) ?? '{}';
}
