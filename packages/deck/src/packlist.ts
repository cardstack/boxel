import {
  TREE_HASH_SPEC,
  treeHashFromEntries,
  type TreeHashEntry,
} from './tree-hash.ts';
import { CANONICAL_ZIP_SPEC } from './canonical-zip.ts';

// The packlist is the pack's manifest: the decklist plus transport facts.
// It records ONLY what transport needs — everything it says about content
// must be derivable from the tree, and it may never contradict the
// import map (which travels inside the pack verbatim, as a tree file).
//
// Reserved name: `packlist.json` sits at the zip root as the FIRST entry
// and is NOT part of the logical tree (it describes the tree). A deck tree
// may not contain its own root-level packlist.json.
//
// Determinism: a canonical pack must be byte-reproducible (round-trip law
// 2), so nothing in the packlist may come from a clock — provenance fields
// are caller-supplied inputs, never defaults.

export const PACKLIST_PATH = 'packlist.json';
export const PACK_FORMAT = 'deck-pack-v1';

export interface PacklistEntry {
  path: string;
  size: number;
  sha256: string;
}

/**
 * How much of the closure a pack carries.
 *
 * What varies between packs is not what they are but what they assume the
 * RECIPIENT already has. Naming that assumption is the difference between an
 * artifact that can be opened and one that merely looks complete.
 *
 * `bare`     — the tree's own files and nothing else; assumes the recipient
 *              reaches the same dependencies the source did. Backup,
 *              inspection, host-to-host migration.
 * `hermetic` — the full closure; assumes nothing but a runtime. Archival.
 *
 * A third mode, negotiated against what the far side declares it can already
 * reach, is deliberately absent: that is in-motion protocol and is not
 * designed. These two are the endpoints and need no conversation.
 */
export type PackMode = 'bare' | 'hermetic';

/**
 * What a pack did NOT carry, stated rather than implied.
 *
 * Every pack prunes something — a `bare` pack prunes the entire external
 * closure. Leaving that unrecorded is what makes an artifact
 * ambient-dependent: it opens on a machine that happens to reach the same
 * things the source did, and fails everywhere else with no explanation.
 */
export interface PrunedRecord {
  /** Dependencies the tree references but the pack does not contain. */
  external?: { specifier: string; from: string }[];
  /** Absolute references left exactly as found, being neither declared
   *  dependencies nor part of this tree — the classifier's `foreign` list.
   *  They may dangle at the destination, and saying so is the point. */
  unresolved?: string[];
}

/**
 * What a pack brought with it, stated rather than inferred.
 *
 * The mirror of `PrunedRecord`, and needed for the same reason. Once a
 * dependency's bytes are inside the tree, nothing distinguishes them from the
 * tree's own code — a recipient cannot tell a carried `three` from something
 * the author wrote. That is the exact ambiguity `vendoredFrom` exists to
 * close for a vendored deck, and a hermetic pack needs it per dependency.
 *
 * `from` is the canonical upstream URL, so the copy can be deduped against
 * one the recipient already holds, upgraded, or checked against upstream.
 * `entry` is where the specifier now resolves inside the tree. The rest of
 * the carried files are in the packlist like any others; `modules` and
 * `bytes` are there so the size of what arrived is readable without walking
 * it.
 */
export interface CarriedRecord {
  specifier: string;
  from: string;
  entry: string;
  modules: number;
  bytes: number;
}

/**
 * Where a pack came from, and what it assumed.
 *
 * This is the input to re-homing. Without it, intake is prefix-matching over
 * every string in the tree and hoping; with it, a receiving realm can tell a
 * declared dependency from a piece of data that merely looks like one.
 *
 * Everything here is CALLER-SUPPLIED. A canonical pack must be
 * byte-reproducible, so nothing may come from a clock, a hostname, or an
 * environment probe.
 */
export interface PackProvenance {
  sourceDepot?: string;
  /**
   * The URL prefix that meant "this tree" at the source.
   *
   * The one field intake cannot do without: it is what says which absolutes
   * pointed at the thing being moved, as opposed to somewhere else.
   */
  sourceBase?: string;
  /** `publisher/package`, as the source knew it. */
  package?: string;
  /**
   * The exact Version this pack seals.
   *
   * Not bookkeeping. On merge-into-an-existing-realm this is the common
   * ancestor — the difference between a three-way merge and asking someone
   * to pick a side.
   */
  version?: string;
  sealChangeId?: string;
  createdBy?: string;
  createdAt?: string; // caller-supplied ISO time; omitted by default

  mode?: PackMode;
  pruned?: PrunedRecord;
  /** Dependencies whose bytes ride inside this pack. Empty or absent for
   *  `bare`, which carries nothing. */
  carried?: CarriedRecord[];
  /**
   * The decklist as it resolved at seal time, flattened.
   *
   * Redundant when the tree's own `importmap.json` needs no ancestry, and
   * essential when it does: `extends` names a parent the recipient may have
   * no way to reach. Derived, never contradictory — it must be the
   * flattening of this tree's own map against its parents.
   */
  resolved?: {
    imports: Record<string, string>;
    scopes?: Record<string, Record<string, string>>;
  };
  /** What produced the tree, where that is not derivable from it. A derived
   *  or minified pack is its own subject (A3/A4), not its source. */
  toolchain?: Record<string, string>;
}

// A faithful pack's packlist. Derived packs (sanitized, subset) add
// `derivedFrom`/`subsetOf` + a transforms record — deliberately NOT
// modeled yet; the server only ever emits faithful packs.
export interface Packlist {
  format: typeof PACK_FORMAT;
  canonicalZip: typeof CANONICAL_ZIP_SPEC;
  treeHash: { spec: typeof TREE_HASH_SPEC; hash: string };
  entries: PacklistEntry[];
  provenance?: PackProvenance;
}

export function createPacklist(
  files: readonly { path: string; size: number; sha256: string }[],
  provenance?: PackProvenance,
): Packlist {
  let hashEntries: TreeHashEntry[] = files.map(({ path, sha256 }) => ({
    path,
    sha256,
  }));
  let { treeHash, entries: sorted } = treeHashFromEntries(hashEntries);
  let sizeByPath = new Map(files.map((f) => [f.path, f.size]));
  return {
    format: PACK_FORMAT,
    canonicalZip: CANONICAL_ZIP_SPEC,
    treeHash: { spec: TREE_HASH_SPEC, hash: treeHash },
    entries: sorted.map(({ path, sha256 }) => ({
      path,
      size: sizeByPath.get(path)!,
      sha256,
    })),
    ...(provenance && Object.keys(provenance).length > 0 ? { provenance } : {}),
  };
}

/**
 * Whether a pack says enough about itself to be re-homed.
 *
 * A pack that fails this is still a perfectly good pack: it round-trips, it
 * verifies, it restores in place. It just cannot be moved to a different
 * address without guessing — and guessing is what corrupts content. Better
 * to report that up front than to discover it after a migration has
 * rewritten someone's artwork URLs.
 */
export function intakeReadiness(packlist: Packlist): {
  ready: boolean;
  missing: string[];
} {
  let p = packlist.provenance;
  let missing: string[] = [];
  if (!p?.sourceBase) {
    missing.push(
      'provenance.sourceBase — which absolutes pointed at this tree',
    );
  }
  if (!p?.version) {
    missing.push('provenance.version — the ancestor a merge would need');
  }
  if (!p?.mode) {
    missing.push('provenance.mode — what the recipient is assumed to have');
  }
  return { ready: missing.length === 0, missing };
}

function validateProvenance(p: unknown): void {
  if (p === undefined) {
    return;
  }
  if (typeof p !== 'object' || p === null || Array.isArray(p)) {
    throw new Error('packlist provenance is not an object');
  }
  let prov = p as PackProvenance;
  for (let key of [
    'sourceDepot',
    'sourceBase',
    'package',
    'version',
    'sealChangeId',
    'createdBy',
    'createdAt',
  ] as const) {
    if (prov[key] !== undefined && typeof prov[key] !== 'string') {
      throw new Error(`packlist provenance.${key} must be a string`);
    }
  }
  if (prov.mode !== undefined && prov.mode !== 'bare' && prov.mode !== 'hermetic') {
    throw new Error(
      `unknown pack mode: ${JSON.stringify(prov.mode)} (expected "bare" or "hermetic")`,
    );
  }
  if (prov.pruned !== undefined) {
    if (typeof prov.pruned !== 'object' || prov.pruned === null) {
      throw new Error('packlist provenance.pruned is not an object');
    }
    let { external, unresolved } = prov.pruned;
    if (external !== undefined) {
      if (!Array.isArray(external)) {
        throw new Error('packlist provenance.pruned.external is not an array');
      }
      for (let entry of external) {
        if (
          typeof entry?.specifier !== 'string' ||
          typeof entry?.from !== 'string'
        ) {
          throw new Error('packlist provenance.pruned.external entry is malformed');
        }
      }
    }
    if (
      unresolved !== undefined &&
      (!Array.isArray(unresolved) ||
        unresolved.some((u) => typeof u !== 'string'))
    ) {
      throw new Error('packlist provenance.pruned.unresolved is not a string array');
    }
  }
  if (prov.carried !== undefined) {
    if (!Array.isArray(prov.carried)) {
      throw new Error('packlist provenance.carried is not an array');
    }
    for (let entry of prov.carried) {
      if (
        typeof entry?.specifier !== 'string' ||
        typeof entry?.from !== 'string' ||
        typeof entry?.entry !== 'string' ||
        typeof entry?.modules !== 'number' ||
        typeof entry?.bytes !== 'number'
      ) {
        throw new Error('packlist provenance.carried entry is malformed');
      }
    }
    // A `bare` pack that claims to have carried something is describing a
    // pack that does not exist. Catching it here means intake never has to
    // decide which half of the contradiction to believe.
    if (prov.mode === 'bare' && prov.carried.length > 0) {
      throw new Error(
        'packlist provenance: mode "bare" carries nothing, but provenance.carried is non-empty',
      );
    }
  }
  if (prov.resolved !== undefined) {
    if (
      typeof prov.resolved !== 'object' ||
      prov.resolved === null ||
      typeof prov.resolved.imports !== 'object' ||
      prov.resolved.imports === null
    ) {
      throw new Error('packlist provenance.resolved has no imports object');
    }
  }
}

export function serializePacklist(packlist: Packlist): Buffer {
  return Buffer.from(JSON.stringify(packlist, null, 2) + '\n', 'utf8');
}

export function parsePacklist(bytes: Buffer): Packlist {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error('packlist.json is not valid JSON');
  }
  let p = parsed as Packlist;
  if (p?.format !== PACK_FORMAT) {
    throw new Error(
      `unsupported pack format: ${JSON.stringify((p as { format?: unknown })?.format)} (expected ${PACK_FORMAT})`,
    );
  }
  if (p.canonicalZip !== CANONICAL_ZIP_SPEC) {
    throw new Error(`unsupported canonical zip spec: ${p.canonicalZip}`);
  }
  if (p.treeHash?.spec !== TREE_HASH_SPEC || !p.treeHash?.hash) {
    throw new Error('packlist has no usable treeHash');
  }
  if (!Array.isArray(p.entries)) {
    throw new Error('packlist has no entries array');
  }
  validateProvenance(p.provenance);
  for (let entry of p.entries) {
    if (
      typeof entry?.path !== 'string' ||
      typeof entry?.size !== 'number' ||
      typeof entry?.sha256 !== 'string'
    ) {
      throw new Error('packlist entry is malformed');
    }
  }
  return p;
}
