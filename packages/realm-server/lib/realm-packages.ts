// Publishing a realm's own apps as versioned packages.
//
// Until this existed, the only thing that could BE a Version was something
// handed to the store as a string. A realm's cards — the actual content
// anyone cares about pinning — had no versions at all: not realm-level, not
// card-level, none. `AccountCard.gts` was a live mutable URL and there was no
// path from it to an address another realm could depend on.
//
// WHERE THE DECLARATION LIVES. In the package, not in a registry the realm
// keeps — `deck-a-package-carries-its-own-name.md`. A package named by the
// depot holding it gets renamed when it moves, and since a pin is a name,
// every pin breaks on a move that changed no bytes. So `crm/importmap.json`
// says what `crm/` is, and copying that directory elsewhere carries its
// identity along:
//
//   {
//     "deck": {
//       "publisher": "acme",
//       "packages": {
//         "crm": {
//           "version": "2.0.0",
//           "entry":   "$DECK/app.gts",
//           "exports": { "./account": "$DECK/account.gts" }
//         }
//       }
//     }
//   }
//
// Paths are pack-relative because inside a package `$DECK/` means the
// package's own root. There is no `root` to declare — the package IS the
// directory holding its manifest — and nothing to translate.
//
// A publisher is OPTIONAL, and absent means depot-local: held and served,
// never published where anyone outside can pin it. No ceremony while a
// package is nobody else's business; adding a namespace is the visible moment
// it went public.
//
// THE GRAIN IS THE APP, not the card, and that is a decision rather than a
// limitation. `crm` ships CRMApp, AccountCard, LeadCard and ContactCard,
// which depend on each other — LeadCard converts to AccountCard. Versioning
// them separately would let someone pin a combination that never existed and
// was never tested together, which is a compatibility matrix nobody asked
// for. One pack means every pin names a combination somebody published.
// Individual cards stay reachable through `exports`, so
// `experiments/crm@2.0.0/account` addresses one card without giving it a
// version of its own.
//
// WHERE THE BYTES GO. Into the package store, beside vendored libraries,
// rather than being served live out of the realm's tree. A published Version
// must not change when the realm it came from is edited, moved or deleted,
// and the store is the only place that is true. The realm keeps a short
// alias — `<realm>/@crm@2.0.0/…` — which redirects into the store, so the
// `$DECK`-relative spelling in the design doc still works without putting a
// mutable tree on the read path.

import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { TREE_ROOT } from '@cardstack/deck/import-map';
import { IMPORT_MAP_PATH } from '@cardstack/deck/import-map';
import { pack, readTreeFromDir, unpack } from '@cardstack/deck/node';
import { transpileJS } from '@cardstack/runtime-common/transpile';

export interface RealmPackageDeclaration {
  /** The semver this package claims. */
  version?: string;
  /** The module a bare import of the package resolves to, pack-relative:
   *  inside a package, `$DECK/` means the package's own root. */
  entry?: string;
  /** Short public names for modules inside the pack, pack-relative. */
  exports?: Record<string, string>;
}

export interface RealmPackage {
  /** Directory holding the manifest. Everything under it is the package. */
  dir: string;
  /** Realm-relative path of that directory, for messages. */
  path: string;
  /** The short name. The store name is `<publisher>/<key>`. */
  key: string;
  /** Absent means depot-local: held and served, never published beyond the
   *  depot holding it. */
  publisher?: string;
  declaration: RealmPackageDeclaration;
}

export type ManifestReadResult =
  | {
      kind: 'package';
      key: string;
      publisher?: string;
      declaration: RealmPackageDeclaration;
    }
  | { kind: 'none' }
  | { kind: 'invalid'; detail: string };

/**
 * Read a package's own manifest.
 *
 * The manifest is IN the package, which is the whole point — a package that
 * is named by the depot holding it gets renamed when it moves, and since a
 * pin is a name, every pin breaks on a move that changed no bytes. Deck has
 * always worked this way: `discoverDecks` finds decks by scanning for
 * manifests, because packages say what they are.
 *
 * One package per directory. `deck.packages` is a map because a pack may
 * describe several, but a DIRECTORY is one package, and a manifest naming two
 * leaves no way to say which one the directory is.
 */
export function readPackageManifest(jsonText: string): ManifestReadResult {
  let parsed: any;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e: any) {
    return { kind: 'invalid', detail: `not valid JSON: ${e?.message ?? e}` };
  }
  let vendor = parsed?.deck ?? parsed?.boxel ?? {};
  let packages = vendor.packages;
  if (!packages || typeof packages !== 'object' || Array.isArray(packages)) {
    // An importmap.json with no packages block is a resolution map, not a
    // package manifest. Ordinary, not an error.
    return { kind: 'none' };
  }
  let keys = Object.keys(packages);
  if (keys.length !== 1) {
    return {
      kind: 'invalid',
      detail:
        `declares ${keys.length} packages (${keys.join(', ') || 'none'}); a ` +
        'directory is one package',
    };
  }
  return {
    kind: 'package',
    key: keys[0],
    publisher:
      typeof vendor.publisher === 'string' ? vendor.publisher : undefined,
    declaration: packages[keys[0]] ?? {},
  };
}

// Directories that never hold a package, skipped so a scan does not walk a
// dependency tree or a VCS store.
const SKIP = new Set(['node_modules', '.git', '.jj', '.package-store']);

/**
 * Find the packages a realm holds, by scanning for manifests.
 *
 * Nothing registers and nothing is configured — the same rule `discoverDecks`
 * states for a depot. The realm's own `importmap.json` is skipped: it is the
 * realm's resolution map, not a package manifest, and per
 * `deck-a-package-resolves-through-its-own-map.md` those are different jobs.
 *
 * Depth-limited because a realm is an arbitrary tree rather than a depot's
 * fixed two-level layout, and an unbounded walk on every lookup would put a
 * full-tree scan on a request path. Three levels covers `crm/`, `apps/crm/`
 * and `team/apps/crm/`, which is further than anyone has needed.
 */
export async function discoverRealmPackages(
  realmDir: string,
  maxDepth = 3,
): Promise<{ packages: RealmPackage[]; problems: string[] }> {
  let packages: RealmPackage[] = [];
  let problems: string[] = [];

  async function walk(dir: string, path: string, depth: number) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    // The realm root is skipped (depth 0): its map resolves the realm, it does
    // not describe a package.
    if (
      depth > 0 &&
      entries.some((e) => e.isFile() && e.name === IMPORT_MAP_PATH)
    ) {
      let text = await readFile(join(dir, IMPORT_MAP_PATH), 'utf8').catch(
        () => undefined,
      );
      let result = text
        ? readPackageManifest(text)
        : ({ kind: 'none' } as const);
      if (result.kind === 'invalid') {
        problems.push(`${path}/${IMPORT_MAP_PATH} ${result.detail}`);
      } else if (result.kind === 'package') {
        // The manifest is authoritative and the layout is a convention that
        // should agree with it. A disagreement is reported rather than
        // resolved by a precedence rule nobody would remember.
        let folder = path.split('/').at(-1);
        if (folder !== result.key) {
          problems.push(
            `${path}/${IMPORT_MAP_PATH} names the package "${result.key}" but ` +
              `it lives in "${folder}"`,
          );
        }
        packages.push({
          dir,
          path,
          key: result.key,
          publisher: result.publisher,
          declaration: result.declaration,
        });
        // A package does not contain another package.
        return;
      }
    }
    if (depth >= maxDepth) {
      return;
    }
    for (let entry of entries) {
      if (entry.isDirectory() && !SKIP.has(entry.name)) {
        await walk(
          join(dir, entry.name),
          path ? `${path}/${entry.name}` : entry.name,
          depth + 1,
        );
      }
    }
  }

  await walk(realmDir, '', 0);
  return { packages, problems };
}

/**
 * The name this package takes in the store.
 *
 * A bare key — no publisher — means depot-local. It resolves inside the depot
 * holding it and is not publishable beyond it, so no ceremony is owed while a
 * package is nobody else's business, and adding a namespace is the visible
 * moment it went public.
 *
 * The key stays the SHORT name, never the full one: the store's manifest check
 * looks a package up by the last segment of its name, so a manifest keyed by
 * `acme/crm` would look up a key that is not there and silently skip the check
 * tying a pack to the version it is published under.
 */
export function storeNameFor(
  publisher: string | undefined,
  key: string,
): string {
  return publisher ? `${publisher}/${key}` : key;
}

export type PackRefusal =
  | 'no-such-package'
  | 'no-version'
  | 'empty-package'
  | 'build-output-collision'
  | 'build-failed';

// What gets compiled on the way into a pack, and what the compiled sibling is
// called. `.d.ts` is excluded: it is types, not a module, and content-tag has
// nothing to do to it.
const TRANSPILABLE = /\.(gts|gjs|ts)$/;
const IS_DECLARATION = /\.d\.ts$/;

export function builtPathFor(path: string): string {
  return `${path.replace(TRANSPILABLE, '')}.js`;
}

/**
 * Drop build output from a pack's file list, leaving what a human wrote.
 *
 * A published pack holds both, so a comparison against it has to take the
 * same side of that split — otherwise a candidate's authored files look like
 * a tree with every compiled module deleted, and the structural pass reports
 * MAJOR for a republish that changed nothing. Which it did, once.
 *
 * Derived files are recognised structurally rather than from a manifest
 * entry: a `.js` whose transpilable sibling sits beside it in the same pack
 * is output. A hand-written `.js` with no such sibling is authored and stays.
 */
export function authoredOnly<T>(tree: Map<string, T>): Map<string, T> {
  let out = new Map<string, T>();
  for (let [path, value] of tree) {
    let isDerived =
      path.endsWith('.js') &&
      ['gts', 'gjs', 'ts'].some((ext) =>
        tree.has(`${path.slice(0, -'.js'.length)}.${ext}`),
      );
    if (!isDerived) {
      out.set(path, value);
    }
  }
  return out;
}

export type PackRealmPackageResult =
  | {
      kind: 'packed';
      bytes: Buffer;
      treeHash: string;
      /** Pack-relative paths, for showing what is in the Version. */
      files: string[];
      /** The AUTHORED files only, keyed by pack-relative path. What the
       *  structural pass compares and what a diff should show — comparing
       *  compiled output would report babel's choices as API changes. */
      sources: Map<string, string>;
      /** Relative imports that appear to leave the pack. Reported rather
       *  than refused — see `findEscapingImports`. */
      warnings: string[];
    }
  | { kind: 'refused'; code: PackRefusal; detail: string };

// `$DECK/app.gts` → `app.gts`. Inside a package manifest the token means the
// package's own root, so stripping it yields a pack-relative path directly —
// there is nothing to translate, which is the simplification that came free
// when identity moved into the package.
function stripTreeRoot(value: string): string {
  return value.startsWith(TREE_ROOT) ? value.slice(TREE_ROOT.length) : value;
}

/**
 * Relative imports that appear to leave the pack.
 *
 * WARNINGS, NOT REFUSALS. An import that escapes the pack root produces a
 * Version that cannot load, so it is worth surfacing loudly — but this reads
 * `.gts` too, which is not JavaScript, so the detector is a text scan rather
 * than a parse and can be wrong in both directions. Refusing on a scan that
 * might be wrong would block a publish over a string in a comment; reporting
 * it puts the judgement where the ruling already puts every other judgement
 * about a proposal, which is in front of the reviewer.
 *
 * A `$DECK/` import is deliberately NOT flagged. Per the design doc §5 that
 * is the escape hatch — a live reference out of the snapshot, visible in the
 * file, chosen by the author.
 */
export function findEscapingImports(files: Map<string, Buffer>): string[] {
  let warnings: string[] = [];
  let pattern = /\bfrom\s+['"](\.[^'"]*)['"]/g;
  for (let [path, bytes] of files) {
    if (!/\.(gts|gjs|ts|js|mjs)$/.test(path)) {
      continue;
    }
    let dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    for (let match of bytes.toString('utf8').matchAll(pattern)) {
      let specifier = match[1];
      let segments = `${dir}/${specifier}`.split('/');
      let stack: string[] = [];
      let escaped = false;
      for (let segment of segments) {
        if (segment === '' || segment === '.') continue;
        if (segment === '..') {
          if (stack.length === 0) {
            escaped = true;
            break;
          }
          stack.pop();
        } else {
          stack.push(segment);
        }
      }
      if (escaped) {
        warnings.push(`${path} imports ${specifier}, which leaves the pack`);
      }
    }
  }
  return warnings;
}

// Relative specifiers written without an extension, which is how a card
// module normally imports its sibling: `import Account from './account'`.
const RELATIVE_SPECIFIER = /(\bfrom\s*|\bimport\s*\(\s*)(['"])(\.[^'"]*)\2/g;

function resolveSibling(fromPath: string, specifier: string): string {
  let dir = fromPath.includes('/')
    ? fromPath.slice(0, fromPath.lastIndexOf('/'))
    : '';
  let stack = dir ? dir.split('/') : [];
  for (let segment of specifier.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') stack.pop();
    else stack.push(segment);
  }
  return stack.join('/');
}

/**
 * Point a compiled module's relative imports at the compiled siblings.
 *
 * A realm resolves `./account` by trying extensions against its own file
 * system. The package store does not: it serves exactly the path asked for,
 * so an extensionless import inside a published Version is a 404. Rewriting
 * the specifier is the fix, and it belongs HERE — before the seal — because
 * after the seal the bytes at an immutable address must not depend on
 * anything a later server decides to do.
 *
 * Only specifiers that resolve to a module actually in this pack are touched.
 * One that leaves the pack is already reported as a warning and is left
 * exactly as written, so the published bytes say plainly what they need.
 */
export function pointAtBuiltSiblings(
  source: string,
  fromPath: string,
  authored: Set<string>,
): string {
  return source.replace(
    RELATIVE_SPECIFIER,
    (whole, lead: string, quote: string, specifier: string) => {
      if (/\.[a-z]+$/i.test(specifier)) {
        return whole;
      }
      let target = resolveSibling(fromPath, specifier);
      let hit = [...authored].find(
        (p) => p.replace(TRANSPILABLE, '') === target,
      );
      return hit ? `${lead}${quote}${specifier}.js${quote}` : whole;
    },
  );
}

/**
 * Build the pack for one package, out of the directory that holds its
 * manifest.
 *
 * The package IS its directory — there is no root to declare and no realm
 * path to translate, because the manifest sits inside the thing it describes.
 *
 * The manifest in the pack is DERIVED from the authored one rather than
 * copied verbatim: entry and exports are moved onto the compiled modules,
 * since an entry is an address a consumer imports and the source does not
 * run. Everything else passes through. That derivation is a transform before
 * the seal, which is where transforms belong.
 */
export async function packRealmPackage({
  packageDir,
  key,
  declaration,
}: {
  packageDir: string;
  key: string;
  declaration: RealmPackageDeclaration | undefined;
}): Promise<PackRealmPackageResult> {
  if (!declaration) {
    return {
      kind: 'refused',
      code: 'no-such-package',
      detail: `no package "${key}" in this realm`,
    };
  }
  if (!declaration.version) {
    return {
      kind: 'refused',
      code: 'no-version',
      detail: `package "${key}" declares no version`,
    };
  }

  let files = await readTreeFromDir(packageDir);
  // The manifest is always there — it is how the package was found — so the
  // only way to be empty is to hold nothing else.
  if (files.size <= 1) {
    return {
      kind: 'refused',
      code: 'empty-package',
      detail: `package "${key}" holds nothing but its manifest`,
    };
  }

  // COMPILE BEFORE THE SEAL. A realm transpiles `.gts` on the way out; the
  // package store serves the bytes it holds and nothing else. Publishing the
  // source alone therefore ships a module whose first decorator is a syntax
  // error to whoever loads it.
  //
  // The transform runs HERE rather than at serve time because a Version's
  // bytes are immutable: an address that promises "these exact bytes forever"
  // cannot have its content decided later by whichever compiler happens to be
  // deployed. That is the transform-zone rule — a transform may run before
  // the seal, never after it — and it is why the built module is part of what
  // gets hashed.
  //
  // BOTH ARE KEPT. Source at the path the author wrote it, compiled at a `.js`
  // sibling. The source is what a human reads and what the structural pass
  // compares; the `.js` is what a consumer imports. Same split as a published
  // npm package, for the same reason.
  let authored = new Set(
    [...files.keys()].filter(
      (p) =>
        TRANSPILABLE.test(p) &&
        !IS_DECLARATION.test(p) &&
        // The manifest is authored too, but it is data and it is replaced by
        // the derived one below.
        p !== IMPORT_MAP_PATH,
    ),
  );
  let built = new Map<string, Buffer>();
  for (let path of authored) {
    let target = builtPathFor(path);
    if (files.has(target)) {
      return {
        kind: 'refused',
        code: 'build-output-collision',
        detail:
          `${path} compiles to ${target}, which already exists in package ` +
          `"${key}". Rename one of them — publishing would have to silently ` +
          'drop the hand-written file.',
      };
    }
    try {
      let compiled = await transpileJS(
        files.get(path)!.toString('utf8'),
        `/${path}`,
      );
      built.set(
        target,
        Buffer.from(pointAtBuiltSiblings(compiled, path, authored)),
      );
    } catch (e: any) {
      // A module that does not compile cannot be published, and saying which
      // one and why is the whole value of failing here rather than at the
      // consumer's import.
      return {
        kind: 'refused',
        code: 'build-failed',
        detail: `${path} did not compile: ${String(e?.message ?? e)}`,
      };
    }
  }

  // Entry and exports name the BUILT module rather than the source. An entry
  // is an address a consumer imports, and handing them the source would hand
  // them the bytes that do not run.
  let asBuilt = (p: string) => (authored.has(p) ? builtPathFor(p) : p);
  let entry = declaration.entry
    ? asBuilt(stripTreeRoot(declaration.entry))
    : undefined;
  let exports: Record<string, string> = {};
  for (let [alias, target] of Object.entries(declaration.exports ?? {})) {
    exports[alias] = `${TREE_ROOT}${asBuilt(stripTreeRoot(target))}`;
  }

  let manifest = {
    deck: {
      packages: {
        [key]: {
          version: declaration.version,
          ...(entry ? { entry: `${TREE_ROOT}${entry}` } : {}),
          ...(Object.keys(exports).length ? { exports } : {}),
        },
      },
    },
  };

  let inputs = [
    // The derived manifest replaces the authored one at the same path, so it
    // is written last-wins rather than added alongside.
    ...[...files.entries()]
      .filter(([path]) => path !== IMPORT_MAP_PATH)
      .map(([path, bytes]) => ({ path, bytes })),
    {
      path: IMPORT_MAP_PATH,
      bytes: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`),
    },
    ...[...built.entries()].map(([path, bytes]) => ({ path, bytes })),
  ];
  let bytes = pack(inputs);
  return {
    kind: 'packed',
    bytes,
    treeHash: unpack(bytes).treeHash,
    files: inputs.map((f) => f.path).sort(),
    sources: new Map(
      [...files.entries()].map(([path, b]) => [path, b.toString('utf8')]),
    ),
    // Read from the SOURCE, which is where the author wrote the import. The
    // compiled sibling has already had its relative specifiers rewritten, so
    // scanning it would report resolved paths back at somebody looking for
    // the line they typed.
    warnings: findEscapingImports(files),
  };
}
