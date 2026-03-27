import deburr from 'lodash/deburr';

import {
  realmURL,
  RealmPaths,
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

// usage example for realm url: `catalogRealm.url`, `skillsRealm.url`
export const catalogRealm = ENV.resolvedCatalogRealmURL
  ? new RealmPaths(new URL(ENV.resolvedCatalogRealmURL))
  : null;
export const skillsRealm = new RealmPaths(new URL(ENV.resolvedSkillsRealmURL));

/**
 * Safely constructs a URL to a skill card in the skills realm.
 * Uses the URL constructor to handle path joining safely.
 *
 * @param skillId - The ID of the skill (e.g., 'boxel-environment', 'catalog-listing')
 * @returns The complete URL to the skill card
 *
 * @example
 * skillCardURL('catalog-listing')   // 'http://localhost:4201/skills/Skill/catalog-listing'
 */
export function skillCardURL(skillId: string): string {
  return skillsRealm.fileURL(`Skill/${skillId}`).href;
}

export const devSkillId = skillsRealm.fileURL(devSkillLocalPath).href;
export const envSkillId = skillsRealm.fileURL(envSkillLocalPath).href;
