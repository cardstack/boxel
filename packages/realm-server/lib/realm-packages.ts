// Publishing a realm's own apps as versioned packages.
//
// Until this existed, the only thing that could BE a Version was something
// handed to the store as a string. A realm's cards — the actual content
// anyone cares about pinning — had no versions at all: not realm-level, not
// card-level, none. `AccountCard.gts` was a live mutable URL and there was no
// path from it to an address another realm could depend on.
//
// WHAT A REALM DECLARES. `deck-multi-package-design.md` §2: one realm holds
// many packages, each with its own semver, declared in the realm's own
// `importmap.json` under the vendor key.
//
//   "boxel": {
//     "publisher": "experiments",
//     "packages": {
//       "crm": {
//         "version": "2.0.0",
//         "root":    "$DECK/crm/",
//         "entry":   "$DECK/crm/app.gts",
//         "exports": { "./account": "$DECK/crm/account.gts" }
//       }
//     }
//   }
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

import { join } from 'path';
import { TREE_ROOT } from '@cardstack/deck/import-map';
import { IMPORT_MAP_PATH } from '@cardstack/deck/import-map';
import { pack, readTreeFromDir, unpack } from '@cardstack/deck/node';
import { transpileJS } from '@cardstack/runtime-common/transpile';

export interface RealmPackageDeclaration {
  /** The semver this realm is claiming for the package. */
  version?: string;
  /** The subtree that becomes the pack, as `$DECK/<path>/`. */
  root?: string;
  /** The module a bare import of the package resolves to. */
  entry?: string;
  /** Short public names for modules inside the pack. */
  exports?: Record<string, string>;
}

export interface RealmPackageMap {
  /** The publishing identity for this realm; store names are
   *  `<publisher>/<key>`. */
  publisher?: string;
  packages: Record<string, RealmPackageDeclaration>;
}

/**
 * What a realm declares it publishes.
 *
 * Tolerant on purpose: a realm with no packages block is the ordinary case,
 * not an error, and it should read as "publishes nothing" rather than
 * throwing somewhere up the call stack.
 */
export function readRealmPackages(jsonText: string): RealmPackageMap {
  let parsed: any;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { packages: {} };
  }
  let vendor = parsed?.boxel ?? parsed?.deck ?? {};
  let packages = vendor.packages;
  return {
    publisher:
      typeof vendor.publisher === 'string' ? vendor.publisher : undefined,
    packages:
      packages && typeof packages === 'object' && !Array.isArray(packages)
        ? packages
        : {},
  };
}

/**
 * The name this package takes in the store.
 *
 * `<publisher>/<key>`, so the key stays the short app name the realm's own
 * map is written in terms of. That is not cosmetic: the store's manifest
 * check looks the package up by the LAST segment of its name, so a map keyed
 * by the full name would look up a key that isn't there and silently skip the
 * check that ties a pack to the version it is published under.
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
  | 'no-root'
  | 'root-escapes-realm'
  | 'empty-root'
  | 'root-has-own-map'
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

// `$DECK/crm/` → `crm/`. A value that does not carry the token is taken as
// already realm-relative, which is what a hand-edited map tends to contain.
function stripTreeRoot(value: string): string {
  return value.startsWith(TREE_ROOT) ? value.slice(TREE_ROOT.length) : value;
}

function withinRoot(root: string, path: string): string | undefined {
  let normalizedRoot = root.replace(/\/+$/, '');
  let rel = stripTreeRoot(path);
  if (!normalizedRoot) {
    return rel;
  }
  return rel.startsWith(`${normalizedRoot}/`)
    ? rel.slice(normalizedRoot.length + 1)
    : undefined;
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
 * Build the pack for one declared package, out of the realm's tree on disk.
 *
 * The pack gets its OWN `importmap.json`, generated here rather than copied,
 * with entry and export paths rewritten pack-relative. That file is what
 * makes the published bytes self-describing: the store's publish gate reads
 * the version out of it and refuses a pack that disagrees with the version it
 * is being published under, and the serve door resolves the entry through it.
 * A realm subtree that already carries its own map at its root is refused
 * rather than overwritten — two maps claiming the same root is a question
 * only the author can answer.
 */
export async function packRealmPackage({
  realmDir,
  key,
  declaration,
}: {
  realmDir: string;
  key: string;
  declaration: RealmPackageDeclaration | undefined;
}): Promise<PackRealmPackageResult> {
  if (!declaration) {
    return {
      kind: 'refused',
      code: 'no-such-package',
      detail: `this realm's importmap.json declares no package "${key}"`,
    };
  }
  if (!declaration.version) {
    return {
      kind: 'refused',
      code: 'no-version',
      detail: `package "${key}" declares no version`,
    };
  }
  if (!declaration.root) {
    return {
      kind: 'refused',
      code: 'no-root',
      detail:
        `package "${key}" declares no root, so there is no way to know which ` +
        'files it is. Add "root": "$DECK/<path>/".',
    };
  }

  let root = stripTreeRoot(declaration.root).replace(/\/+$/, '');
  // A root that climbs out of the realm would pack somebody else's files.
  // Checked here rather than trusted to the filesystem: `join` would happily
  // resolve it and the read would succeed.
  if (
    root.startsWith('/') ||
    root.split('/').some((segment) => segment === '..')
  ) {
    return {
      kind: 'refused',
      code: 'root-escapes-realm',
      detail: `root ${declaration.root} leaves the realm`,
    };
  }

  let files = await readTreeFromDir(root ? join(realmDir, root) : realmDir);
  if (files.size === 0) {
    return {
      kind: 'refused',
      code: 'empty-root',
      detail: `${declaration.root} holds no files`,
    };
  }
  if (files.has(IMPORT_MAP_PATH)) {
    return {
      kind: 'refused',
      code: 'root-has-own-map',
      detail:
        `${declaration.root} already contains ${IMPORT_MAP_PATH}. Publishing ` +
        'would have to overwrite it with the generated manifest, and which ' +
        'map wins is not a question this can answer for you.',
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
      (p) => TRANSPILABLE.test(p) && !IS_DECLARATION.test(p),
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
          `${path} compiles to ${target}, which already exists in ` +
          `${declaration.root}. Rename one of them — publishing would have to ` +
          'silently drop the hand-written file.',
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

  // Entry and exports are declared realm-relative and must land pack-relative:
  // inside the published Version, `$DECK/` means the pack root, not the realm.
  // They also name the BUILT module rather than the source — an entry is an
  // address a consumer imports, and importing the source would hand them the
  // bytes that do not run.
  let asBuilt = (p: string) => (authored.has(p) ? builtPathFor(p) : p);
  let entry = declaration.entry
    ? withinRoot(root, declaration.entry)
    : undefined;
  entry = entry ? asBuilt(entry) : undefined;
  let exports: Record<string, string> = {};
  for (let [alias, target] of Object.entries(declaration.exports ?? {})) {
    let inside = withinRoot(root, target);
    if (inside) {
      exports[alias] = `${TREE_ROOT}${asBuilt(inside)}`;
    }
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
    {
      path: IMPORT_MAP_PATH,
      bytes: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`),
    },
    ...[...files.entries()].map(([path, bytes]) => ({ path, bytes })),
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
