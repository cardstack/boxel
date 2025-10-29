import deburr from 'lodash/deburr';

import { realmURL } from '@cardstack/runtime-common';

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

export function iconURLFor(word: string) {
  if (!word) {
    return undefined;
  }
  let cleansedWord = cleanseString(word).replace(/^[0-9]+/, '');
  return iconURLs[cleansedWord.charAt(0)];
}

export function getRandomBackgroundURL() {
  const index = Math.floor(Math.random() * backgroundURLs.length);
  return backgroundURLs[index];
}

const iconURLs: { [letter: string]: string } = Object.freeze({
  a: 'https://boxel-images.boxel.ai/icons/Letter-a.png',
  b: 'https://boxel-images.boxel.ai/icons/Letter-b.png',
  c: 'https://boxel-images.boxel.ai/icons/Letter-c.png',
  d: 'https://boxel-images.boxel.ai/icons/Letter-d.png',
  e: 'https://boxel-images.boxel.ai/icons/Letter-e.png',
  f: 'https://boxel-images.boxel.ai/icons/Letter-f.png',
  g: 'https://boxel-images.boxel.ai/icons/Letter-g.png',
  h: 'https://boxel-images.boxel.ai/icons/Letter-h.png',
  i: 'https://boxel-images.boxel.ai/icons/Letter-i.png',
  j: 'https://boxel-images.boxel.ai/icons/Letter-j.png',
  k: 'https://boxel-images.boxel.ai/icons/Letter-k.png',
  l: 'https://boxel-images.boxel.ai/icons/Letter-l.png',
  m: 'https://boxel-images.boxel.ai/icons/Letter-m.png',
  n: 'https://boxel-images.boxel.ai/icons/Letter-n.png',
  o: 'https://boxel-images.boxel.ai/icons/Letter-o.png',
  p: 'https://boxel-images.boxel.ai/icons/Letter-p.png',
  q: 'https://boxel-images.boxel.ai/icons/Letter-q.png',
  r: 'https://boxel-images.boxel.ai/icons/Letter-r.png',
  s: 'https://boxel-images.boxel.ai/icons/Letter-s.png',
  t: 'https://boxel-images.boxel.ai/icons/Letter-t.png',
  u: 'https://boxel-images.boxel.ai/icons/Letter-u.png',
  v: 'https://boxel-images.boxel.ai/icons/Letter-v.png',
  w: 'https://boxel-images.boxel.ai/icons/Letter-w.png',
  x: 'https://boxel-images.boxel.ai/icons/Letter-x.png',
  y: 'https://boxel-images.boxel.ai/icons/Letter-y.png',
  z: 'https://boxel-images.boxel.ai/icons/letter-z.png',
});
const backgroundURLs: readonly string[] = Object.freeze([
  'https://boxel-images.boxel.ai/background-images/4k-arabic-teal.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-arrow-weave.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-atmosphere-curvature.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-brushed-slabs.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-coral-reefs.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-crescent-lake.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-curvilinear-stairs.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-desert-dunes.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-doodle-board.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-fallen-leaves.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-flowing-mesh.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-glass-reflection.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-glow-cells.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-granite-peaks.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-green-wormhole.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-joshua-dawn.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-lava-river.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-leaves-moss.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-light-streaks.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-lowres-glitch.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-marble-shimmer.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-metallic-leather.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-microscopic-crystals.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-moon-face.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-mountain-runway.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-origami-flock.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-paint-swirl.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-pastel-triangles.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-perforated-sheet.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-plastic-ripples.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-powder-puff.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-radiant-crystal.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-redrock-canyon.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-rock-portal.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-rolling-hills.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-sand-stone.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-silver-fur.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-spa-pool.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-stained-glass.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-stone-veins.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-tangerine-plains.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-techno-floor.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-thick-frost.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-water-surface.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-watercolor-splashes.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-wildflower-field.jpg',
  'https://boxel-images.boxel.ai/background-images/4k-wood-grain.jpg',
]);

export function urlForRealmLookup(card: CardDef) {
  let urlForRealmLookup = card.id ?? card[realmURL]?.href;
  if (!urlForRealmLookup) {
    throw new Error(
      `bug: cannot determine a URL to use for realm lookup of a card--this should always be set even for new cards`,
    );
  }
  return urlForRealmLookup;
}

/**
 * Safely constructs a URL to a skill card in the skills realm.
 * Uses the URL constructor to handle path joining safely.
 *
 * @param skillId - The ID of the skill (e.g., 'boxel-environment', 'catalog-listing')
 * @returns The complete URL to the skill card
 *
 * @example
 * skillCardURL('boxel-environment') // 'http://localhost:4201/skills/Skill/boxel-environment'
 * skillCardURL('catalog-listing')   // 'http://localhost:4201/skills/Skill/catalog-listing'
 */
export function skillCardURL(skillId: string): string {
  const skillsRealmURL = ENV.resolvedSkillsRealmURL;
  return new URL(`Skill/${skillId}`, skillsRealmURL).href;
}
