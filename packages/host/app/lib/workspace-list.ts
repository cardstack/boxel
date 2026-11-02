import { ri, type RealmIdentifier } from '@cardstack/runtime-common';

import config from '@cardstack/host/config/environment';
import { catalogRealmURL, leadWith } from '@cardstack/host/lib/utils';

// Shared by the workspace chooser and the dashboard, which list the same
// workspaces and catalogs and navigate their tiles the same way.

interface RealmDates {
  createdAt?: string | null;
  lastPublishedAt?: string | Record<string, string> | null;
}

export function isHostedRealm(info: RealmDates): boolean {
  return !!(
    info.lastPublishedAt &&
    typeof info.lastPublishedAt === 'object' &&
    Object.keys(info.lastPublishedAt).length > 0
  );
}

// A workspace's wallpaper as a CSS background image, for the dashboard's tiles
// and the rail's favorites alike.
export function wallpaperImage(
  backgroundURL: string | null | undefined,
): string | undefined {
  return backgroundURL ? `url("${backgroundURL}")` : undefined;
}

// Newest first. Realms without a valid createdAt (e.g. a broken/orphaned realm
// reference) sort to the end rather than clumping at the front.
export function sortByCreatedAtDesc<T extends string>(
  urls: T[],
  infoFor: (url: T) => RealmDates,
): T[] {
  let times = new Map(
    urls.map((url) => {
      let createdAt = infoFor(url).createdAt;
      let time = createdAt ? new Date(createdAt).getTime() : NaN;
      return [url, Number.isNaN(time) ? null : time];
    }),
  );
  return [...urls].sort((a, b) => {
    let aTime = times.get(a) ?? null;
    let bTime = times.get(b) ?? null;
    if (aTime === null && bTime === null) {
      return 0;
    }
    if (aTime === null) {
      return 1;
    }
    if (bTime === null) {
      return -1;
    }
    return bTime - aTime;
  });
}

// The boxel-homepage realm is a catalog in production, but not one to list.
export function listedCatalogRealmURLs<T extends string>(urls: T[]): T[] {
  if (config.environment !== 'production') {
    return urls;
  }
  return urls.filter((url) => !url.includes('/boxel-homepage/'));
}

// The listed catalogs as the dashboard orders them: newest first, except the
// Boxel catalog, which always leads.
export function orderedCatalogRealmURLs<T extends string>(
  urls: T[],
  infoFor: (url: T) => RealmDates,
): T[] {
  return leadWith(
    sortByCreatedAtDesc(listedCatalogRealmURLs(urls), infoFor),
    catalogRealmURL,
  );
}

// The favorites among the listed workspaces and catalogs, so a favorite
// whose realm was archived or removed isn't shown.
export function listedFavoriteRealmIdentifiers(
  favorites: string[],
  workspaces: RealmIdentifier[],
  catalogs: RealmIdentifier[],
): RealmIdentifier[] {
  let listed = new Set<string>([
    ...workspaces,
    ...listedCatalogRealmURLs(catalogs),
  ]);
  return favorites.filter((url) => listed.has(url)).map(ri);
}

// Names every unreachable server: trusted servers are few in practice, so a
// comma-joined list stays readable.
export function unreachableRealmServersMessage(
  serverURLs: string[],
  isRetrying: boolean,
): string {
  let hosts = serverURLs.map((serverURL) => {
    try {
      return new URL(serverURL).host;
    } catch {
      return serverURL;
    }
  });
  let reason = `Couldn’t reach ${hosts.join(', ')}. Some workspaces may be missing`;
  return isRetrying
    ? `${reason} — retrying…`
    : `${reason} — reload to try again.`;
}

// Favorite tiles span the Your Workspaces row: two tiles' width for every
// three that fit per row, rounded up. Null before a tile has been measured.
export function favoritesTileWidth(
  gridWidth: number,
  tileWidth: number,
  gap: number,
): number | null {
  if (!tileWidth) {
    return null;
  }
  let perRow = Math.max(1, Math.floor((gridWidth + gap) / (tileWidth + gap)));
  let slots = Math.ceil(perRow / 2);
  let rowWidth = perRow * tileWidth + (perRow - 1) * gap;
  return (rowWidth - (slots - 1) * gap) / slots;
}

// From the tile at `currentIndex`, finds the nearest row of `[data-nav-index]`
// tiles in `direction` and returns the index of the tile whose horizontal
// center is closest. Undefined when there is no row that way.
export function nearestNavIndexInRow(
  container: HTMLElement,
  currentIndex: number,
  direction: 1 | -1,
): number | undefined {
  let tiles = [...container.querySelectorAll('[data-nav-index]')].map(
    (element) => ({
      index: Number((element as HTMLElement).dataset.navIndex),
      rect: element.getBoundingClientRect(),
    }),
  );
  let current = tiles.find((tile) => tile.index === currentIndex);
  if (!current) {
    return undefined;
  }
  let currentCenterX = current.rect.left + current.rect.width / 2;
  let candidates = tiles.filter((tile) =>
    direction === 1
      ? tile.rect.top > current.rect.top + 1
      : tile.rect.top < current.rect.top - 1,
  );
  if (candidates.length === 0) {
    return undefined;
  }
  // Tiles in the nearest row share (near-)identical tops.
  let targetRowTop =
    direction === 1
      ? Math.min(...candidates.map((tile) => tile.rect.top))
      : Math.max(...candidates.map((tile) => tile.rect.top));
  let rowTiles = candidates.filter(
    (tile) => Math.abs(tile.rect.top - targetRowTop) <= 1,
  );
  let distance = (tile: (typeof tiles)[number]) =>
    Math.abs(tile.rect.left + tile.rect.width / 2 - currentCenterX);
  return rowTiles.reduce((closest, tile) =>
    distance(tile) < distance(closest) ? tile : closest,
  ).index;
}
