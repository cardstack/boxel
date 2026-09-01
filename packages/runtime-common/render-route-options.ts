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
  // The instance-data snapshot this render must be pure over — the
  // prerender-html pass sends its batch id. The render route resets its
  // store (loader untouched) when this differs from the epoch the tab last
  // reset for, then records it: one reset per tab per batch, so instances
  // stay warm across one batch's visits but a later batch never reads a
  // linked card the store loaded under an earlier generation. The loader
  // epoch alone cannot cover this — an instance-only invalidation keeps it
  // by design.
  instanceEpoch?: string;
  cardRender?: true;
  fileExtract?: true;
  fileRender?: true;
  fileDefCodeRef?: ResolvedCodeRef;
  fileContentHash?: string;
  fileContentSize?: number;
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
    if (typeof parsed.instanceEpoch === 'string') {
      options.instanceEpoch = parsed.instanceEpoch;
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
  if (options.instanceEpoch !== undefined) {
    serialized.instanceEpoch = options.instanceEpoch;
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
  }
  if (options.fileRender) {
    serialized.fileRender = true;
    if (options.fileDefCodeRef) {
      serialized.fileDefCodeRef = options.fileDefCodeRef;
    }
  }
  return stringify(serialized) ?? '{}';
}
