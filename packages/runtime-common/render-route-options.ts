import stringify from 'safe-stable-stringify';
import { isResolvedCodeRef } from './code-ref.ts';
import type { ResolvedCodeRef } from './code-ref.ts';

export interface RenderRouteOptions {
  clearCache?: true;
  // The realm's loader epoch this render belongs to (see
  // `RealmGenerationsTable.loader_epoch`). The render route resets its
  // loader + store when this differs from the epoch the tab last cleared
  // for, then records it — one reset per tab per module change.
  loaderEpoch?: string;
  // Explicit inventory capture for Lattice module admission experiments. This
  // does not change cache-reuse or publication policy.
  captureModuleSources?: true;
  cardRender?: true;
  // HTML-only Lattice visits consume the published output, never recompute it.
  latticeUseSnapshot?: true;
  // Primary indexing registers materialized owners without evaluating inputs.
  latticeDiscovery?: true;
  // An explicit producer pass. A pooled tab may retain the input global, but
  // ordinary card, module and file renders must never consume it implicitly.
  latticeRenderCheckpoint?: true;
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
    if (typeof parsed.loaderEpoch === 'string') {
      options.loaderEpoch = parsed.loaderEpoch;
    }
    if (parsed.captureModuleSources === true) {
      options.captureModuleSources = true;
    }
    if (parsed.latticeDiscovery === true) {
      options.latticeDiscovery = true;
    }
    if (parsed.latticeUseSnapshot === true) {
      options.latticeUseSnapshot = true;
    }
    if (parsed.latticeRenderCheckpoint === true) {
      options.latticeRenderCheckpoint = true;
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
  if (options.loaderEpoch !== undefined) {
    serialized.loaderEpoch = options.loaderEpoch;
  }
  if (options.captureModuleSources === true) {
    serialized.captureModuleSources = true;
  }
  if (options.latticeDiscovery) {
    serialized.latticeDiscovery = true;
  }
  if (options.latticeUseSnapshot) {
    serialized.latticeUseSnapshot = true;
  }
  if (options.latticeRenderCheckpoint) {
    serialized.latticeRenderCheckpoint = true;
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
  return stringify(serialized) ?? '{}';
}
