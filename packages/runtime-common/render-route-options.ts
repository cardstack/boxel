import stringify from 'safe-stable-stringify';

export interface RenderRouteOptions {
  clearCache?: true;
  fileExtract?: true;
  fileDefModule?: string;
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
      if (typeof parsed.fileDefModule === 'string') {
        options.fileDefModule = parsed.fileDefModule;
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
    if (options.fileDefModule) {
      serialized.fileDefModule = options.fileDefModule;
    }
  }
  return stringify(serialized) ?? '{}';
}
