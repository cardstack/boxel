// Shared base-realm computation bodies. These functions have no card loader,
// Ember, DOM or browser dependency. Browser inputs may be tracked instances;
// native inputs are the corresponding normalized data and resolved references.
export function baseJsonQueryableValue(
  _value?: unknown,
  _stack?: unknown[],
): null {
  return null;
}

export interface BaseCardInfoValues<TTheme = unknown> {
  name?: string | null;
  summary?: string | null;
  theme?: TTheme | null;
  cardThumbnailURL?: string | null;
  cardThumbnail?: { url?: string | null } | null;
}

export function baseCardTitle(
  info: BaseCardInfoValues,
  displayName: string | (() => string),
) {
  return info.name?.trim()?.length
    ? info.name
    : `Untitled ${typeof displayName === 'function' ? displayName() : displayName}`;
}

export function baseCardDescription(info: BaseCardInfoValues) {
  return info.summary;
}

export function baseCardTheme<TTheme>(info: BaseCardInfoValues<TTheme>) {
  return info.theme;
}

export function baseCardThumbnailURL(
  info: BaseCardInfoValues,
  screenshotURL: () => string | undefined,
) {
  // Preserve short-circuiting: an authored URL must not cause an ImageDef or
  // screenshot dependency to be read. The native caller supplies indexed
  // screenshot metadata; it never captures a screenshot to compute this URL.
  return info.cardThumbnailURL || info.cardThumbnail?.url || screenshotURL();
}
