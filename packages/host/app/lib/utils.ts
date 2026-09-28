import { deburr } from 'lodash-es';

import {
  realmURL,
  ensureTrailingSlash,
  skillsIndexLocalPath,
} from '@cardstack/runtime-common';
export {
  iconURLFor,
  getRandomBackgroundURL,
  PERSONAL_REALM_ENDPOINT,
} from '@cardstack/runtime-common/realm-display-defaults';

import ENV from '@cardstack/host/config/environment';

import type { CardDef } from '@cardstack/base/card-api';

export function stripFileExtension(path: string): string {
  return path.replace(/\.[^/.]+$/, '');
}

// Used to generate a color for the profile avatar
// Copied from https://github.com/mui/material-ui/issues/12700
export function stringToColor(string: string | null) {
  if (!string) {
    return 'transparent';
  }

  let hash = 0;
  let i;

  for (i = 0; i < string.length; i += 1) {
    hash = string.charCodeAt(i) + ((hash << 5) - hash);
  }

  let color = '#';

  for (i = 0; i < 3; i += 1) {
    const value = (hash >> (i * 8)) & 0xff;
    color += `00${value.toString(16)}`.substr(-2);
  }

  return color;
}

export function cleanseString(value: string) {
  return deburr(value.toLocaleLowerCase())
    .replace(/'/g, '')
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^[^a-z0-9]/, '')
    .replace(/[^a-z0-9]$/, '');
}

// The workspace endpoint (URL path segment) derived from a display name or a
// user-typed endpoint. The realm server accepts only lowercase letters, digits
// and hyphens, so this normalizes near-misses like "My_Team  Space!" into
// that shape instead of letting the server reject them. Every door that
// creates a workspace derives the endpoint here so they agree on the result.
export function toWorkspaceEndpoint(value: string): string {
  return cleanseString(value)
    .replace(/_/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

// The URLs a workspace has been published to, newest publish first, from the
// realm info's `lastPublishedAt` map (published URL -> timestamp). A realm
// that was never published, or whose info is still the legacy single
// timestamp, has none.
export function publishedRealmURLsFromInfo(
  info: { lastPublishedAt?: unknown } | undefined,
): string[] {
  let lastPublishedAt = info?.lastPublishedAt;
  if (!lastPublishedAt || typeof lastPublishedAt !== 'object') {
    return [];
  }
  return Object.entries(lastPublishedAt as Record<string, unknown>)
    .sort(([, leftPublishedAt], [, rightPublishedAt]) => {
      return Number(rightPublishedAt) - Number(leftPublishedAt);
    })
    .map(([publishedRealmURL]) => publishedRealmURL);
}

export function urlForRealmLookup(card: CardDef) {
  let urlForRealmLookup = card.id ?? card[realmURL]?.href;
  if (!urlForRealmLookup) {
    throw new Error(
      `bug: cannot determine a URL to use for realm lookup of a card--this should always be set even for new cards`,
    );
  }
  return urlForRealmLookup;
}

// Catalog and Skills realm URLs as plain strings (always trailing-slashed).
// Use `.url`-style URL operations directly; for realm-membership checks
// against either of these, construct a `RealmPaths` with a VN at the call site.
export const catalogRealmURL: string | null = ENV.resolvedCatalogRealmURL
  ? ensureTrailingSlash(decodeURI(new URL(ENV.resolvedCatalogRealmURL).href))
  : null;
export const skillsRealmURL: string = ensureTrailingSlash(
  decodeURI(new URL(ENV.resolvedSkillsRealmURL).href),
);

/**
 * The URL of a `.md` skill file (`skills/<name>/SKILL.md`) in the skills
 * realm — the markdown skill form, resolved as a `MarkdownDef` whose
 * `boxel.kind: skill` frontmatter makes it a skill source. Spelled as a
 * resolved absolute URL for the same reason as `skillsIndexId`: a skill body
 * links to its references relative to its own location, and only an absolute
 * id can anchor that resolution.
 *
 * @example
 * skillFileURL('source-code-editing')  // `${skillsRealmURL}skills/source-code-editing/SKILL.md`
 */
export function skillFileURL(skillName: string): string {
  return `${skillsRealmURL}skills/${skillName}/SKILL.md`;
}

// The skills index, the default skill for every new AI room. Spelled as a
// resolved absolute URL rather than an `@cardstack/skills/` reference because
// the index routes to its siblings entirely through document-relative markdown
// links: the prompt resolves those against the skill's own id, and only an
// absolute id can anchor that resolution.
export const skillsIndexId = `${skillsRealmURL}${skillsIndexLocalPath}`;
