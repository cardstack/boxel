import type { RealmContents } from './index';

// The Choreo gallery realm's own source files, read from
// packages/choreo-gallery/realm at build time, so a test exercises the cards
// the gallery serves rather than a copy of them.
const ROOT = '../../../choreo-gallery/realm/';
// Vite compiles this module as ES, where `import.meta.glob` is defined; the
// package type-checks under `nodenext` as CommonJS, which rejects the syntax.
// @ts-expect-error TS1470, as above
const SOURCES = import.meta.glob<string>(
  '../../../choreo-gallery/realm/**/*.{gts,ts,json}',
  { query: '?raw', import: 'default', eager: true },
);

/**
 * The gallery realm's modules and card instances, keyed by their path in the
 * realm, for `setupIntegrationTestRealm`. The gallery's own `boxel test`
 * files and its realm config stay out: the test realm keeps its own config.
 */
export function choreoGalleryContents(): RealmContents {
  let contents: RealmContents = {};
  for (let [path, source] of Object.entries(SOURCES)) {
    let file = path.slice(ROOT.length);
    if (file.endsWith('.test.gts') || file === 'realm.json') {
      continue;
    }
    contents[file] = source;
  }
  return contents;
}
