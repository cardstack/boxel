import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { discoverDecks } from './deck-scan.ts';
import { IMPORT_MAP_PATH } from './import-map.ts';
import { mergeTrees } from './merge.ts';
import { unpack } from './pack.ts';
import {
  readStoreMeta,
  readStoredPack,
  resolveVersionSpec,
  type StoreMeta,
} from './store.ts';
import { readTreeFromDir, writeTreeToDir } from './tree.ts';
import { treeHashFromDir } from './tree-hash.ts';

// An OFFER is a fork that remembers where it came from.
//
// `deck fork` records the base — package, version, and treeHash — in the
// fork's own import map, so the fork IS the proposal: no side table, no
// server state, no branch. Everything a three-way merge needs is in the
// tree, and the tree is sealed and served like everything else.
//
// The rebase daemon exists because of what that makes possible: since the
// base is exact and both sides are content-addressed, a machine can keep
// every open proposal merged against upstream continuously. Contributors
// never rebase; maintainers only ever look at the ones that stopped
// merging. That is what makes 200 open proposals a queue instead of a
// backlog.
//
// Rebasing is not a special kind of write. It writes files into the fork's
// working tree, which the watcher then auto-publishes and seals like any
// other save — so a rebase is visible, addressable, and revertable.
//
// Federation note: `forkedFrom.package` is `<publisher>/<package>` within
// one depot today. When this lands in the realm server — Matrix identity,
// many federated depots — the same field takes an origin, `actor` carries
// the Matrix user id that made the offer, and nothing else here changes:
// the merge inputs are still three content addresses.

export interface ForkedFrom {
  // `<publisher>/<package>` in this depot.
  package: string;
  // The version forked, when a sealed one was. Absent means the live tree.
  version?: string;
  // The identity that matters: what the base tree WAS.
  treeHash: string;
  // Who made the offer, when that is known. The seal already records an
  // author; this is the durable, in-tree claim.
  actor?: string;
}

export interface Offer {
  publisher: string;
  package: string;
  // `<publisher>/<package>` of the FORK.
  name: string;
  dir: string;
  forkedFrom: ForkedFrom;
}

export type RebaseState =
  // Upstream has published nothing since the base: nothing to absorb.
  | 'current'
  // Upstream moved and the merge is clean.
  | 'rebased'
  // Upstream moved and both sides changed the same thing.
  | 'conflicted'
  // The base tree is not in the store, so no three-way merge is possible.
  | 'unresolvable';

export interface RebasePlan {
  offer: Offer;
  upstream: string;
  upstreamVersion?: string;
  upstreamTreeHash?: string;
  state: RebaseState;
  conflicts: string[];
  detail?: string;
  // The merged tree, when the merge is clean. Absent otherwise — a
  // conflicted rebase writes NOTHING.
  files?: Map<string, Buffer>;
}

export function readForkedFrom(
  mapText: string,
  packageName: string,
): ForkedFrom | undefined {
  let parsed;
  try {
    parsed = JSON.parse(mapText);
  } catch {
    return undefined;
  }
  let vendor = parsed?.deck ?? parsed?.boxel;
  let value = vendor?.packages?.[packageName]?.forkedFrom;
  if (!value || typeof value !== 'object' || typeof value.treeHash !== 'string') {
    return undefined;
  }
  return value as ForkedFrom;
}

export function writeForkedFrom(
  mapText: string,
  packageName: string,
  forkedFrom: ForkedFrom,
): string {
  let parsed = JSON.parse(mapText);
  let vendor = (parsed.deck ??= {});
  let packages = (vendor.packages ??= {});
  let entry = (packages[packageName] ??= {});
  entry.forkedFrom = forkedFrom;
  return JSON.stringify(parsed, null, 2) + '\n';
}

/** Every deck in the depot that declares a base — i.e. every open offer. */
export async function discoverOffers(depotDir: string): Promise<Offer[]> {
  let offers: Offer[] = [];
  for (let deck of await discoverDecks(depotDir)) {
    let mapText: string;
    try {
      mapText = await readFile(join(deck.dir, IMPORT_MAP_PATH), 'utf8');
    } catch {
      continue;
    }
    let forkedFrom = readForkedFrom(mapText, deck.package);
    if (forkedFrom) {
      offers.push({ ...deck, forkedFrom });
    }
  }
  return offers;
}

// Which upstream state to rebase onto: a released one if there is one,
// otherwise the freshest seal. A proposal chasing an unreleased dev line is
// a choice, so it has to be asked for.
function upstreamSpec(meta: StoreMeta, onto?: string): string | undefined {
  if (onto) {
    return onto;
  }
  if (meta.tags.latest) {
    return 'latest';
  }
  if (meta.tags.dev) {
    return 'dev';
  }
  return undefined;
}

function versionWithTreeHash(
  meta: StoreMeta,
  treeHash: string,
): string | undefined {
  return Object.entries(meta.versions).find(
    ([, record]) => record.treeHash === treeHash,
  )?.[0];
}

async function treeAtVersion(
  storeDir: string,
  name: string,
  version: string,
): Promise<Map<string, Buffer> | undefined> {
  let bytes = await readStoredPack(storeDir, name, version);
  return bytes ? unpack(bytes).files : undefined;
}

export interface PlanRebaseOptions {
  depotDir: string;
  storeDir: string;
  offer: Offer;
  onto?: string;
}

export async function planRebase(
  options: PlanRebaseOptions,
): Promise<RebasePlan> {
  let { storeDir, offer, onto } = options;
  let upstream = offer.forkedFrom.package;
  let base: RebasePlan = {
    offer,
    upstream,
    state: 'unresolvable',
    conflicts: [],
  };
  let meta = await readStoreMeta(storeDir, upstream);
  if (!meta || Object.keys(meta.versions).length === 0) {
    return { ...base, detail: `${upstream} has no published versions` };
  }
  let spec = upstreamSpec(meta, onto);
  if (!spec) {
    return { ...base, detail: `${upstream} has no latest or dev tag` };
  }
  let resolution = resolveVersionSpec(spec, meta);
  if (resolution.kind === 'not-found' || resolution.kind === 'invalid') {
    return { ...base, detail: `${upstream}@${spec}: ${resolution.detail}` };
  }
  let upstreamVersion = resolution.version;
  let upstreamTreeHash = meta.versions[upstreamVersion].treeHash;
  base = { ...base, upstreamVersion, upstreamTreeHash };

  if (upstreamTreeHash === offer.forkedFrom.treeHash) {
    return { ...base, state: 'current' };
  }
  // The base tree has to be readable for a three-way merge to mean
  // anything. Guessing a base is how merges silently lose work.
  let baseVersion = versionWithTreeHash(meta, offer.forkedFrom.treeHash);
  if (!baseVersion) {
    return {
      ...base,
      detail: `the base tree ${offer.forkedFrom.treeHash.slice(0, 12)} is not in the store (pruned, or never published)`,
    };
  }
  let baseTree = await treeAtVersion(storeDir, upstream, baseVersion);
  let ourTree = await treeAtVersion(storeDir, upstream, upstreamVersion);
  if (!baseTree || !ourTree) {
    return { ...base, detail: `a pack is missing for ${upstream}` };
  }
  let theirTree = await readTreeFromDir(offer.dir);
  let { files, conflicts } = mergeTrees(baseTree, ourTree, theirTree);
  if (conflicts.length > 0) {
    return { ...base, state: 'conflicted', conflicts };
  }
  return { ...base, state: 'rebased', conflicts: [], files };
}

export interface RebaseApplied {
  written: string[];
  deleted: string[];
  changed: boolean;
}

/**
 * Writes a clean rebase into the fork's working tree and moves its base
 * pointer to the upstream state it just absorbed. The watcher does the rest:
 * the merged state auto-publishes as the proposal's next dev version, and is
 * sealed, so a rebase can be inspected and undone like any other save.
 */
export async function applyRebase(
  plan: RebasePlan,
): Promise<RebaseApplied> {
  if (plan.state !== 'rebased' || !plan.files) {
    throw new Error(
      `cannot apply a ${plan.state} rebase of ${plan.offer.name}`,
    );
  }
  let files = new Map(plan.files);
  let mapPath = join(plan.offer.dir, IMPORT_MAP_PATH);
  let mapText =
    files.get(IMPORT_MAP_PATH)?.toString('utf8') ??
    (await readFile(mapPath, 'utf8'));
  files.set(
    IMPORT_MAP_PATH,
    Buffer.from(
      writeForkedFrom(mapText, plan.offer.package, {
        ...plan.offer.forkedFrom,
        version: plan.upstreamVersion,
        treeHash: plan.upstreamTreeHash!,
      }),
      'utf8',
    ),
  );
  let { written, deleted } = await writeTreeToDir(plan.offer.dir, files);
  return { written, deleted, changed: written.length + deleted.length > 0 };
}

/** The treeHash of a deck's working tree — the offer's current proposal. */
export async function offerTreeHash(offer: Offer): Promise<string> {
  return (await treeHashFromDir(offer.dir)).treeHash;
}

export async function writeOfferMap(
  dir: string,
  packageName: string,
  forkedFrom: ForkedFrom,
): Promise<void> {
  let mapPath = join(dir, IMPORT_MAP_PATH);
  let mapText = await readFile(mapPath, 'utf8');
  await writeFile(mapPath, writeForkedFrom(mapText, packageName, forkedFrom));
}
