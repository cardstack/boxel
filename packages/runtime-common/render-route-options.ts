import stringify from 'safe-stable-stringify';

export interface RenderRouteOptions {
  includesCodeChange?: true;
  resetStore?: true;
}

export function parseRenderRouteOptions(
  raw: string | undefined | null,
): RenderRouteOptions {
  if (!raw) {
    return {};
  }
  try {
    return JSON.parse(raw) as RenderRouteOptions;
  } catch {
    return {};
  }
}

export function serializeRenderRouteOptions(
  options: RenderRouteOptions = {},
): string {
  return stringify(options);
}
