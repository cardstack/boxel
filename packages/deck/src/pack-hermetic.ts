import { planPack } from './pack-mode.ts';
import { IMPORT_MAP_PATH, TREE_ROOT } from './import-map.ts';
import { isValidTreePath } from './tree-hash.ts';
import { vendorFromCdn } from './vendor.ts';
import type { CarriedRecord, PackProvenance } from './packlist.ts';

// Hermetic carriage: turn a tree's external dependencies into files inside it.
//
// `planPack` decides WHAT a hermetic pack must carry. It is pure and
// browser-safe, and deliberately does no fetching. This is the other half:
// the part that goes and gets the bytes.
//
// It lives in Core, on the `/node` entry, because the Boxel backport needs it
// (realm download as a pack) and the alternative is realm-server writing its
// own — forking the one thing the pack modes exist to make uniform. It costs
// Core nothing new: every module it reaches was already here, including the
// single network call site in `vendor.ts`.
//
// Nothing here is new machinery. `vendorFromCdn` already walks a module
// graph over HTTP, rewrites every followed reference to stay inside the
// pack, and refuses to finish if something would be left live. This wires
// that to the pack modes, once per declared dependency.
//
// THREE RULES, all of them refusals:
//
//   1. A carried tree may not collide with the tree it joins. The vendored
//      bytes land under `_vendor/`, and a source tree that already has a
//      `_vendor/` path is an error rather than something to merge around.
//   2. Hermetic means hermetic. `vendorFromCdn` throws when a reference
//      points somewhere it will not follow, and this does not pass
//      `allowExternal`. A pack with a live CDN reference inside it is not
//      hermetic, and calling it hermetic is worse than calling it bare.
//   3. What arrived is recorded. Once the bytes are inside the tree they
//      look like the author's own code; `provenance.carried` is what keeps
//      "this is three@0.160.0 from esm.sh" answerable.

/** Where carried bytes live. One reserved directory, so a recipient can see
 *  at a glance which half of the tree was written and which was fetched.
 *
 *  Paths under it come from `urlToTreePath`, which is `<host>/<pathname>`.
 *  A non-default port therefore puts a colon in a path segment — legal in a
 *  Deck tree, legal on POSIX, and illegal as a Windows filename. It cannot
 *  be normalised away here: those paths are already inside sealed trees, and
 *  L4 says a published Version never changes. It only bites when the source
 *  is served from an explicit port, which a real CDN is not. */
export const VENDOR_PREFIX = '_vendor';

export interface CarryHermeticOptions {
  /** The tree as it stands, including its `importmap.json`. */
  files: readonly { path: string; bytes: Buffer }[];
  /** The tree's resolved decklist: specifier → where the dependency lives. */
  imports: Record<string, string>;
  /** The URL prefix that means "this tree". Values under it are the deck's
   *  own modules and are never carried. Also the base a relative dependency
   *  value resolves against. */
  sourceBase?: string;
  /** Absolute references found in content that are neither declared
   *  dependencies nor part of this tree. No mode can carry them; they are
   *  recorded as pruned. */
  foreign?: readonly string[];
  fetchImpl?: typeof fetch;
  maxModules?: number;
  maxBytes?: number;
}

export interface CarryHermeticResult {
  /** The tree plus the carried bytes, with `importmap.json` rewritten to
   *  resolve inside. Ready to hand to `pack()`. */
  files: { path: string; bytes: Buffer }[];
  /** The decklist after rewriting — every carried specifier now `$DECK/…`. */
  imports: Record<string, string>;
  /** `mode`, `carried` and `pruned`, ready to merge into the caller's own
   *  provenance. The caller still owns `sourceBase`, `version` and the rest;
   *  those are facts about the source, not about carriage. */
  provenance: Pick<PackProvenance, 'mode' | 'carried' | 'pruned'>;
}

function resolveDependencyUrl(from: string, sourceBase?: string): string {
  try {
    return new URL(from).href;
  } catch {
    // Not absolute on its own. A depot-relative value like
    // `/site/lib/three@0.160.0/index.js` is perfectly normal and only
    // becomes fetchable once we know where the tree was served from.
    if (!sourceBase) {
      throw new Error(
        `hermetic: cannot fetch ${JSON.stringify(from)} — it is relative, and no sourceBase says what it is relative to`,
      );
    }
    return new URL(from, sourceBase).href;
  }
}

/**
 * Fetch everything a hermetic pack must carry, and fold it into the tree.
 *
 * Pure in the parts that decide and impure only in the part that fetches, so
 * the mode logic stays testable without a network: pass a `fetchImpl`.
 */
export async function carryHermetic(
  options: CarryHermeticOptions,
): Promise<CarryHermeticResult> {
  let { files, imports, sourceBase, foreign, fetchImpl, maxModules, maxBytes } =
    options;

  let plan = planPack({ mode: 'hermetic', imports, sourceBase, foreign });

  let existing = new Set(files.map((f) => f.path));
  for (let path of existing) {
    if (path === VENDOR_PREFIX || path.startsWith(`${VENDOR_PREFIX}/`)) {
      throw new Error(
        `hermetic: the tree already contains ${path}, and ${VENDOR_PREFIX}/ is reserved for carried bytes`,
      );
    }
  }

  let carriedBytes = new Map<string, Buffer>();
  let carried: CarriedRecord[] = [];
  // Two specifiers may name the same upstream URL — an app and its own
  // dependency both on `three@0.160.0`. That is L7's dedupe corollary, and
  // it must fetch once and land once, not twice.
  let byUrl = new Map<string, { entry: string; modules: number; bytes: number }>();
  let rewritten = { ...imports };

  for (let { specifier, from } of plan.vendor) {
    let entryUrl = resolveDependencyUrl(from, sourceBase);
    let already = byUrl.get(entryUrl);
    if (!already) {
      let result;
      try {
        result = await vendorFromCdn({
          entryUrl,
          fetchImpl,
          maxModules,
          maxBytes,
          // Rule 2: no `allowExternal`. A reference the walker will not
          // follow is a hermeticity failure, and it should surface here
          // rather than at the recipient's runtime.
        });
      } catch (error) {
        // The walker's own message offers `--allow-external`, which is a
        // `deck vendor` flag and does not exist here — following it would
        // send someone looking for an escape hatch that is deliberately
        // absent. Keep the detail, replace the advice.
        throw new Error(
          `hermetic: cannot carry ${JSON.stringify(specifier)} from ${entryUrl} — ${(error as Error).message.replace(/\s*\(pass allowExternal[^)]*\)/, '')}. A hermetic pack has no escape hatch: carry it, or pack bare and record it as pruned.`,
        );
      }
      let total = 0;
      for (let file of result.files) {
        let path = `${VENDOR_PREFIX}/${file.path}`;
        if (!isValidTreePath(path)) {
          throw new Error(`hermetic: ${file.path} maps to an invalid tree path`);
        }
        if (existing.has(path)) {
          throw new Error(
            `hermetic: carried file ${path} collides with the tree's own`,
          );
        }
        let seen = carriedBytes.get(path);
        if (seen && !seen.equals(file.bytes)) {
          // Same URL, different bytes, within one carry. Nothing legitimate
          // produces this; carrying either copy would silently pick a winner.
          throw new Error(
            `hermetic: two different bodies both want ${path}`,
          );
        }
        carriedBytes.set(path, file.bytes);
        total += file.bytes.length;
      }
      already = {
        entry: `${VENDOR_PREFIX}/${result.entryPath}`,
        modules: result.files.length,
        bytes: total,
      };
      byUrl.set(entryUrl, already);
    }
    rewritten[specifier] = `${TREE_ROOT}${already.entry}`;
    carried.push({
      specifier,
      from: entryUrl,
      entry: already.entry,
      modules: already.modules,
      bytes: already.bytes,
    });
  }

  let out = files.map((file) =>
    file.path === IMPORT_MAP_PATH
      ? { path: file.path, bytes: rewriteImportMap(file.bytes, rewritten) }
      : file,
  );
  for (let [path, bytes] of [...carriedBytes].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    out.push({ path, bytes });
  }

  return {
    files: out,
    imports: rewritten,
    provenance: {
      mode: 'hermetic',
      ...(carried.length > 0 ? { carried } : {}),
      ...(Object.keys(plan.pruned).length > 0 ? { pruned: plan.pruned } : {}),
    },
  };
}

/**
 * Put the rewritten values back into the tree's own manifest.
 *
 * The map file travels inside the pack verbatim and the packlist may never
 * contradict it, so rewriting the resolved decklist without rewriting the
 * file would produce a pack that disagrees with itself. Everything other
 * than `imports` is left exactly as the author wrote it.
 */
function rewriteImportMap(
  bytes: Buffer,
  imports: Record<string, string>,
): Buffer {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error(`hermetic: ${IMPORT_MAP_PATH} is not valid JSON`);
  }
  return Buffer.from(
    JSON.stringify({ ...parsed, imports }, null, 2) + '\n',
    'utf8',
  );
}
