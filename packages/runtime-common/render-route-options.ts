import stringify from 'safe-stable-stringify';
import { isResolvedCodeRef } from './code-ref';
import type { ResolvedCodeRef } from './code-ref';

export interface RenderRouteOptions {
  clearCache?: true;
  fileExtract?: true;
  fileRender?: true;
  fileDefCodeRef?: ResolvedCodeRef;
  fileContentHash?: string;
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
    if (parsed.fileExtract) {
      options.fileExtract = true;
      if (isResolvedCodeRef(parsed.fileDefCodeRef)) {
        options.fileDefCodeRef = parsed.fileDefCodeRef;
      }
      if (typeof parsed.fileContentHash === 'string') {
        options.fileContentHash = parsed.fileContentHash;
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
  if (options.fileExtract) {
    serialized.fileExtract = true;
    if (options.fileDefCodeRef) {
      serialized.fileDefCodeRef = options.fileDefCodeRef;
    }
    if (options.fileContentHash) {
      serialized.fileContentHash = options.fileContentHash;
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
