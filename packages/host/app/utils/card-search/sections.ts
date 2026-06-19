import type {
  CodeRef,
  RenderableSearchEntryLike,
} from '@cardstack/runtime-common';

import { urlForRealmLookup } from '@cardstack/host/lib/utils';

import type { CardDef } from 'https://cardstack.com/base/card-api';

// ── Section types ──

export interface RealmSectionInfo {
  name: string;
  iconURL: string | null;
  publishable: boolean | null;
}

export interface RealmSection {
  sid: string;
  type: 'realm';
  realmUrl: string;
  realmInfo: RealmSectionInfo;
  cards: RenderableSearchEntryLike[];
  totalCount: number;
}

export type RecentsSection =
  | {
      sid: string;
      type: 'recents';
      kind: 'prerendered';
      cards: RenderableSearchEntryLike[];
      totalCount: number;
    }
  | {
      sid: string;
      type: 'recents';
      kind: 'live';
      cards: CardDef[];
      totalCount: number;
    };

export interface UrlSection {
  sid: string;
  type: 'url';
  card: CardDef;
  realmUrl: string;
  realmInfo: RealmSectionInfo;
}

export type SearchSheetSection = RealmSection | RecentsSection | UrlSection;

// ── Realm info resolution ──

export interface RealmInfoLookup {
  info(realmURL: string): {
    name: string;
    iconURL: string | null;
    publishable: boolean | null;
  } | null;
}

function realmNameFromUrl(realmUrl: string): string {
  try {
    const pathname = new URL(realmUrl).pathname;
    const segments = pathname.split('/').filter(Boolean);
    return segments[segments.length - 1] ?? 'Workspace';
  } catch {
    return 'Workspace';
  }
}

function resolveRealmInfo(
  realmUrl: string,
  realm: RealmInfoLookup,
): RealmSectionInfo {
  const info = realm.info(realmUrl);
  return {
    name: info?.name ?? realmNameFromUrl(realmUrl),
    iconURL: info?.iconURL ?? null,
    publishable: info?.publishable ?? null,
  };
}

function realmUrlForCard(cardIdOrUrl: string, realmURLs: string[]): string {
  for (const realm of realmURLs) {
    if (cardIdOrUrl.startsWith(realm)) {
      return realm;
    }
  }
  try {
    const url = new URL(cardIdOrUrl);
    return `${url.origin}${url.pathname.split('/').slice(0, -1)?.join('/') ?? ''}/`;
  } catch {
    return '';
  }
}

// ── Section builders ──

export function buildRecentsSection(
  cards: RenderableSearchEntryLike[],
): RecentsSection | undefined {
  if (cards.length === 0) {
    return undefined;
  }
  return {
    sid: 'recents',
    type: 'recents',
    kind: 'prerendered',
    cards,
    totalCount: cards.length,
  };
}

export function buildLiveRecentsSection(
  cards: CardDef[],
): RecentsSection | undefined {
  if (cards.length === 0) {
    return undefined;
  }
  return {
    sid: 'recents',
    type: 'recents',
    kind: 'live',
    cards,
    totalCount: cards.length,
  };
}

export function buildUrlSection(
  card: CardDef | undefined,
  isURL: boolean,
  realmURLs: string[],
  realm: RealmInfoLookup,
): UrlSection | undefined {
  if (!isURL || !card) {
    return undefined;
  }
  const urlForRealm = urlForRealmLookup(card);
  const realmUrl = realmUrlForCard(urlForRealm, realmURLs);
  return {
    sid: `url:${card.id}`,
    type: 'url',
    card,
    realmUrl,
    realmInfo: resolveRealmInfo(realmUrl, realm),
  };
}

export function buildQuerySections(
  instances: RenderableSearchEntryLike[],
  opts: {
    isURL: boolean;
    isSearchKeyEmpty: boolean;
    hasBaseFilter: boolean;
    realmURLs: string[];
    offerToCreate?: { ref: CodeRef; relativeTo: URL | undefined };
    realm: RealmInfoLookup;
  },
): RealmSection[] | null {
  if (opts.isURL) {
    return null;
  }
  // In search-sheet mode (no baseFilter), skip when search key is empty
  if (!opts.hasBaseFilter && opts.isSearchKeyEmpty) {
    return null;
  }

  const byRealm = new Map<string, RenderableSearchEntryLike[]>();
  for (const card of instances) {
    const list: RenderableSearchEntryLike[] = byRealm.get(card.realmUrl) ?? [];
    list.push(card);
    byRealm.set(card.realmUrl, list);
  }

  const sections: RealmSection[] = [];
  for (const [realmUrl, realmCards] of byRealm) {
    sections.push({
      sid: `realm:${realmUrl}`,
      type: 'realm',
      realmUrl,
      realmInfo: resolveRealmInfo(realmUrl, opts.realm),
      cards: realmCards,
      totalCount: realmCards.length,
    });
  }

  // When offerToCreate is provided, include empty sections for all
  // available/selected realms that have no results, so users can
  // create new cards in those realms.
  if (opts.offerToCreate) {
    for (const realmUrl of opts.realmURLs) {
      if (!byRealm.has(realmUrl)) {
        sections.push({
          sid: `realm:${realmUrl}`,
          type: 'realm',
          realmUrl,
          realmInfo: resolveRealmInfo(realmUrl, opts.realm),
          cards: [],
          totalCount: 0,
        });
      }
    }
  }

  return sections;
}

/**
 * Combines recents, URL, and query sections into a single ordered list.
 * Moves the focused section (if any) to the front.
 */
export function assembleSections(
  recents: RecentsSection | undefined,
  urlSection: UrlSection | undefined,
  querySections: RealmSection[] | null,
  focusedSectionId: string | null,
): SearchSheetSection[] {
  const sections: SearchSheetSection[] = [];

  if (recents) {
    sections.push(recents);
  }
  if (urlSection) {
    sections.push(urlSection);
  }
  if (querySections) {
    sections.push(...querySections);
  }

  // Move focused section to front so it appears at the top
  if (focusedSectionId) {
    const idx = sections.findIndex((s) => s.sid === focusedSectionId);
    if (idx > 0) {
      const [focused] = sections.splice(idx, 1);
      sections.unshift(focused);
    }
  }

  return sections;
}
