import { posix } from 'node:path';
import { extractSpecifiers } from './vendor.ts';

// The module graph of a tree, walked with nothing but the tree.
//
// This is how L6 is checked. "A sealed deck resolves everything it contains"
// is a question about relative edges: follow every one from the entry, and
// see whether the tree answers. Anything that is not relative — a bare name,
// a `node:` builtin, an absolute URL — is external by definition, and has to
// be declared rather than found.
//
// It lived in `vendor-npm.ts` until the Tools split, because npm vendoring
// was the first thing that needed it. That was always the wrong way round:
// the walker knows nothing about npm, takes no network, and the conformance
// suite reaches for it to check a law rather than to vendor a package.
//
// Node's resolution, minus the parts a browser cannot do anyway: extension
// search and directory `index`. No `exports` map, no conditions, no CJS
// interop. Those are intake concerns and belong to Tools.

export const JS_EXTENSIONS = ['.js', '.mjs', '.cjs'];
const PARSEABLE = new Set([...JS_EXTENSIONS, '.ts', '.mts']);

export function isParseable(path: string): boolean {
  return PARSEABLE.has(posix.extname(path).toLowerCase());
}

export function normalizeJoin(fromPath: string, specifier: string): string {
  return posix.normalize(posix.join(posix.dirname(fromPath), specifier));
}

// Returns the path as published, so an already-complete specifier resolves
// to itself and needs no rewrite.
export function resolveRelative(
  fromPath: string,
  specifier: string,
  files: Map<string, Buffer>,
): string | undefined {
  let base = normalizeJoin(fromPath, specifier);
  let candidates = [
    base,
    ...JS_EXTENSIONS.map((extension) => `${base}${extension}`),
    ...JS_EXTENSIONS.map((extension) => `${base}/index${extension}`),
  ];
  return candidates.find((candidate) => files.has(candidate));
}

export interface SourceGraph {
  entry: string;
  modules: string[];
  // Specifiers the walk would have to leave live: bare names, `node:`
  // builtins, absolute URLs.
  externals: string[];
  // Relative specifiers that resolve to nothing in the published files.
  unresolved: string[];
  // Non-JS members of the graph (JSON, CSS, WASM). Carried, not parsed.
  assets: string[];
  bytes: number;
}

export function walkSourceGraph(
  files: Map<string, Buffer>,
  entry: string,
  options: { maxModules?: number; maxBytes?: number } = {},
): SourceGraph {
  let { maxModules = 5000, maxBytes = 64 * 1024 * 1024 } = options;
  let seen = new Set<string>();
  let externals = new Set<string>();
  let unresolved = new Set<string>();
  let assets = new Set<string>();
  let bytes = 0;
  let queue = [entry];

  while (queue.length > 0) {
    let path = queue.pop()!;
    if (seen.has(path)) {
      continue;
    }
    let content = files.get(path);
    if (!content) {
      unresolved.add(path);
      continue;
    }
    seen.add(path);
    bytes += content.length;
    if (seen.size > maxModules) {
      throw new Error(`vendor: module cap exceeded (${maxModules})`);
    }
    if (bytes > maxBytes) {
      throw new Error(`vendor: byte cap exceeded (${maxBytes})`);
    }
    if (!isParseable(path)) {
      assets.add(path);
      continue;
    }
    for (let specifier of extractSpecifiers(content.toString('utf8'))) {
      if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
        externals.add(specifier); // bare, `node:`, or an absolute URL
        continue;
      }
      let resolved = resolveRelative(path, specifier, files);
      if (resolved) {
        queue.push(resolved);
      } else {
        unresolved.add(`${path} → ${specifier}`);
      }
    }
  }

  return {
    entry,
    modules: [...seen].sort(),
    externals: [...externals].sort(),
    unresolved: [...unresolved].sort(),
    assets: [...assets].sort(),
    bytes,
  };
}
