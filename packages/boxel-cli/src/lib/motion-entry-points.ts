/**
 * The glimmer-motion and `@cardstack/choreo` specifiers card code may
 * import: exactly the ids the host shims for them (`shimExternals` in
 * `packages/host/app/lib/externals.ts`).
 *
 * Both packages publish more subpaths than this through their `./*`
 * export pattern, but a card can only load what the host shims. `boxel
 * parse` aliases these ids, and only these, onto the bundled source, so a
 * card importing any other subpath is reported as an unresolved module
 * instead of type-checking clean and then failing to load.
 * `tests/card-runtime-packages.test.ts` holds this list equal to the shims.
 */
export const MOTION_ENTRY_POINTS = [
  'glimmer-motion',
  'glimmer-motion/layout-group',
  'glimmer-motion/motion-config',
  'glimmer-motion/presence',
  'glimmer-motion/reorder/group',
  'glimmer-motion/reorder/item',
  'glimmer-motion/test-support',
  '@cardstack/choreo',
  '@cardstack/choreo/choreo',
  '@cardstack/choreo/steps',
  '@cardstack/choreo/test-support',
  '@cardstack/choreo/film',
  '@cardstack/choreo/film/clip',
  '@cardstack/choreo/film/film',
  '@cardstack/choreo/film/graph/adjust',
  '@cardstack/choreo/film/graph/host',
  '@cardstack/choreo/film/graph/nodes',
  '@cardstack/choreo/film/joins',
  '@cardstack/choreo/film/overlays',
  '@cardstack/choreo/film/picture',
  '@cardstack/choreo/film/plate',
  '@cardstack/choreo/film/player',
  '@cardstack/choreo/film/rail',
  '@cardstack/choreo/film/titles',
] as const;

/**
 * tsconfig `paths` entries mapping each entry point onto its package's
 * source directory: a package root to its `index`, a subpath to the
 * module of the same name, which resolves to a `.ts` / `.gts` file or a
 * directory's `index`.
 */
export function motionEntryPointPaths(sourceDirs: {
  glimmerMotion: string;
  choreo: string;
}): Record<string, string[]> {
  let roots: [string, string][] = [
    ['glimmer-motion', sourceDirs.glimmerMotion],
    ['@cardstack/choreo', sourceDirs.choreo],
  ];
  let paths: Record<string, string[]> = {};
  for (let specifier of MOTION_ENTRY_POINTS) {
    let [packageName, dir] = roots.find(
      ([name]) => specifier === name || specifier.startsWith(`${name}/`),
    )!;
    let subpath = specifier.slice(packageName.length + 1);
    paths[specifier] = [`${dir}/${subpath || 'index'}`];
  }
  return paths;
}
