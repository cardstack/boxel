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

// @ts-expect-error TS1470, as above
const GUIDES = import.meta.glob<string>(
  '../../../choreo-gallery/realm/docs/guides/*.md',
  { query: '?raw', import: 'default', eager: true },
);

/**
 * The gallery's guides, Markdown, keyed by slug: `core-start`. The index,
 * `README.md`, is not a guide.
 */
export function choreoGalleryGuides(): Record<string, string> {
  let guides: Record<string, string> = {};
  for (let [path, source] of Object.entries(GUIDES)) {
    let slug = path.replace(/^.*\//, '').replace(/\.md$/, '');
    if (slug !== 'README') {
      guides[slug] = source;
    }
  }
  return guides;
}

/**
 * The gallery realm cut down to a gallery of the given demos, for a test that
 * indexes the realm: every module, the theme, those demos' instances, and an
 * index card that links them in the order given. The realm's other card
 * instances stay out, so indexing renders only what the test opens.
 */
export function choreoGalleryRealmOf(demos: string[]): RealmContents {
  let contents: RealmContents = {};
  for (let [file, source] of Object.entries(choreoGalleryContents())) {
    if (
      !file.endsWith('.json') ||
      file === 'theme.json' ||
      demos.some((slug) => file === `demos/${slug}.json`)
    ) {
      contents[file] = source;
    }
  }
  contents['index.json'] = {
    data: {
      type: 'card',
      attributes: {},
      relationships: Object.fromEntries(
        demos.map((slug, index) => [
          `demos.${index}`,
          { links: { self: `./demos/${slug}` } },
        ]),
      ),
      meta: { adoptsFrom: { module: './gallery', name: 'ChoreoGallery' } },
    },
  };
  return contents;
}
