/**
 * Default icon and background URL generators for new realms.
 *
 * Shared by host, software-factory, and any other package that creates realms.
 * Pure JS — no external dependencies.
 */

const ICON_URLS: { [letter: string]: string } = Object.freeze({
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

const BACKGROUND_URLS: readonly string[] = Object.freeze([
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

/**
 * Generate a letter-based icon URL from a realm/workspace name.
 * Returns undefined if the name has no alphabetic characters.
 */
export function iconURLFor(word: string): string | undefined {
  if (!word) {
    return undefined;
  }
  let cleansed = word
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/^[0-9]+/, '');
  return ICON_URLS[cleansed.charAt(0)];
}

/**
 * Pick a random background image URL from the predefined set.
 */
export function getRandomBackgroundURL(): string {
  let index = Math.floor(Math.random() * BACKGROUND_URLS.length);
  return BACKGROUND_URLS[index];
}
