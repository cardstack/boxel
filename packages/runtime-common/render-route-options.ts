import stringify from 'safe-stable-stringify';

export interface RenderRouteOptions {
  clearCache?: true;
}

export function parseRenderRouteOptions(
  raw: string | undefined | null,
): RenderRouteOptions {
  if (!raw) {
    return {};
  }
  try {
    let parsed = JSON.parse(raw) as RenderRouteOptions;
    return parsed.clearCache ? { clearCache: true } : {};
  } catch {
    return {};
  }
}

export function serializeRenderRouteOptions(
  options: RenderRouteOptions = {},
): string {
  if (options.clearCache) {
    return stringify({ clearCache: true }) ?? '{}';
  }
  return stringify({}) ?? '{}';
}
