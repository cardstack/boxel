import { deburr } from 'lodash-es';

import {
  realmURL,
  ensureTrailingSlash,
  devSkillLocalPath,
  envSkillLocalPath,
} from '@cardstack/runtime-common';
export {
  iconURLFor,
  getRandomBackgroundURL,
} from '@cardstack/runtime-common/realm-display-defaults';

import ENV from '@cardstack/host/config/environment';

import type { CardDef } from 'https://cardstack.com/base/card-api';

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
 * Constructs a universal @cardstack/skills/ reference to a skill card.
 *
 * @param skillId - The ID of the skill (e.g., 'boxel-environment', 'catalog-listing')
 * @returns The universal skill card reference
 *
 * @example
 * skillCardURL('catalog-listing')   // '@cardstack/skills/Skill/catalog-listing'
 */
export function skillCardURL(skillId: string): string {
  return `@cardstack/skills/Skill/${skillId}`;
}

/**
 * Constructs a universal @cardstack/skills/ reference to a `.md` skill file
 * (`skills/<name>/SKILL.md`) — the markdown skill form, resolved as a
 * `MarkdownDef` whose `boxel.kind: skill` frontmatter makes it a skill source.
 *
 * @example
 * skillFileURL('source-code-editing')  // '@cardstack/skills/skills/source-code-editing/SKILL.md'
 */
export function skillFileURL(skillName: string): string {
  return `@cardstack/skills/skills/${skillName}/SKILL.md`;
}

export const devSkillId = `@cardstack/skills/${devSkillLocalPath}`;
export const envSkillId = `@cardstack/skills/${envSkillLocalPath}`;

// The markdown-first source-code-editing skill, enabled directly in code
// mode alongside the card defaults.
export const sourceCodeEditingSkillUrl = `${skillsRealmURL}skills/source-code-editing/SKILL.md`;
