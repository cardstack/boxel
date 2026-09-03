// The mapping between a junit suite name and the test file it came from.
//
// Shared by scripts/generate-test-module-timings.mjs, which needs it to turn a
// CI report into shard weights, and tests/shard-assignment-test.ts, which pins
// the convention that makes the mapping possible in the first place.
//
// File discovery is re-exported from the splitter rather than repeated, so the
// two cannot drift: a weight generated for a file the splitter never runs is
// dead data, and a file the splitter runs but the generator cannot name packs
// at DEFAULT_WEIGHT forever.

import shardTestModules from './shard-test-modules.cjs';

const { collectTestModules, testsDir } = shardTestModules;

export { testsDir };

export function discoverTestFiles(dir = testsDir) {
  return collectTestModules(dir, '').sort();
}

// Shard assignment works in paths relative to tests/, so every suite name has
// to come back as one of those. Three shapes are in use:
//
//   info-test.ts                      a file directly under tests/
//   realm-endpoints/info-test.ts      a nested file, path-qualified
//   node-realm-test.ts | file stat …  a file's second top-level module
//
// A path-qualified name already is a path; a bare basename needs the map,
// which holds null for a basename two files share rather than attributing both
// to whichever sorted first.
export function createResolver(files) {
  const byPath = new Set(files);
  const byBasename = new Map();
  for (const file of files) {
    const base = file.split('/').pop();
    byBasename.set(base, byBasename.has(base) ? null : file);
  }

  // Returns a path, null for an ambiguous basename, or undefined for a name
  // that belongs to no file. Dropping a ` | qualifier` is a retry rather than
  // a guess: the shortened name still has to name a file on disk to be
  // accepted, so a module genuinely called `foo | bar` stays unmatched instead
  // of being attributed somewhere plausible.
  return function resolveFile(name) {
    if (byPath.has(name)) {
      return name;
    }
    if (byBasename.has(name)) {
      return byBasename.get(name);
    }
    const qualifier = name.indexOf(' | ');
    return qualifier === -1 ? undefined : resolveFile(name.slice(0, qualifier));
  };
}
