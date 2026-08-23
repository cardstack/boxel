import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';

import { treeHashFromEntries } from '@cardstack/deck/node';

export const DECK_WORKSPACE_STATE_SPEC = 'boxel-deck-workspace-v2';
export const DECK_BRANCH_OBSERVATION_SPEC = 'boxel-deck-branch-observation-v2';
export const DECK_WORKSPACE_STATE_FILE = '.boxel-sync.json';

const HASH = /^[0-9a-f]{64}$/;

export interface DeckBranchObservation {
  repositoryHash: string;
  treeHash: string;
  lockHash: string;
  refGeneration: number;
}

export interface DeckBranchSnapshot extends DeckBranchObservation {
  schema: typeof DECK_BRANCH_OBSERVATION_SPEC;
  realmRRI: string;
  branchId: string;
  branchName: string;
  historyHead: string;
  indexGenerationHash: string;
  checkpointHash: string | null;
  files: Record<string, string>;
}

/**
 * Client evidence of the exact branch state from which a local workspace was
 * materialized. Canonical state remains in the realm's `.deck/` directory.
 */
export interface DeckWorkspaceState {
  schema: typeof DECK_WORKSPACE_STATE_SPEC;
  realmRRI: string;
  realmURL: string;
  branchId: string;
  branchName: string;
  baseRepositoryHash: string;
  baseTreeHash: string;
  baseLockHash: string;
  baseHistoryHead: string;
  baseIndexGenerationHash: string;
  observedRefGeneration: number;
  files: Record<string, string>;
}

export type ContentSideStatus = 'unchanged' | 'changed' | 'added' | 'deleted';
export type ContentSyncAction = 'noop' | 'push' | 'pull' | 'conflict';

export interface ContentSyncEntry {
  path: string;
  baseHash?: string;
  localHash?: string;
  remoteHash?: string;
  localStatus: ContentSideStatus;
  remoteStatus: ContentSideStatus;
  action: ContentSyncAction;
}

export interface ContentSyncPlan {
  baseTreeHash: string;
  localTreeHash: string;
  remoteTreeHash: string;
  entries: ContentSyncEntry[];
  conflicts: ContentSyncEntry[];
  canPublish: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isHashRecord(value: unknown): value is Record<string, string> {
  return (
    isRecord(value) &&
    Object.entries(value).every(
      ([path, hash]) =>
        path !== '' &&
        !path.startsWith('/') &&
        !path.includes('\\') &&
        typeof hash === 'string' &&
        HASH.test(hash),
    )
  );
}

export function isDeckWorkspaceState(
  value: unknown,
): value is DeckWorkspaceState {
  if (!isRecord(value)) return false;
  return (
    value.schema === DECK_WORKSPACE_STATE_SPEC &&
    typeof value.realmRRI === 'string' &&
    value.realmRRI.startsWith('@') &&
    value.realmRRI.endsWith('/') &&
    typeof value.realmURL === 'string' &&
    value.realmURL.endsWith('/') &&
    typeof value.branchId === 'string' &&
    value.branchId !== '' &&
    typeof value.branchName === 'string' &&
    value.branchName !== '' &&
    typeof value.baseRepositoryHash === 'string' &&
    HASH.test(value.baseRepositoryHash) &&
    typeof value.baseTreeHash === 'string' &&
    HASH.test(value.baseTreeHash) &&
    typeof value.baseLockHash === 'string' &&
    HASH.test(value.baseLockHash) &&
    typeof value.baseHistoryHead === 'string' &&
    value.baseHistoryHead.trim() !== '' &&
    typeof value.baseIndexGenerationHash === 'string' &&
    HASH.test(value.baseIndexGenerationHash) &&
    Number.isSafeInteger(value.observedRefGeneration) &&
    (value.observedRefGeneration as number) >= 1 &&
    isHashRecord(value.files) &&
    inventoryTreeHash(value.files) === value.baseTreeHash
  );
}

export function isDeckBranchSnapshot(
  value: unknown,
): value is DeckBranchSnapshot {
  if (!isRecord(value)) return false;
  return (
    value.schema === DECK_BRANCH_OBSERVATION_SPEC &&
    typeof value.realmRRI === 'string' &&
    value.realmRRI.startsWith('@') &&
    value.realmRRI.endsWith('/') &&
    typeof value.branchId === 'string' &&
    value.branchId !== '' &&
    typeof value.branchName === 'string' &&
    value.branchName !== '' &&
    typeof value.repositoryHash === 'string' &&
    HASH.test(value.repositoryHash) &&
    typeof value.treeHash === 'string' &&
    HASH.test(value.treeHash) &&
    typeof value.lockHash === 'string' &&
    HASH.test(value.lockHash) &&
    typeof value.historyHead === 'string' &&
    value.historyHead.trim() !== '' &&
    typeof value.indexGenerationHash === 'string' &&
    HASH.test(value.indexGenerationHash) &&
    Number.isSafeInteger(value.refGeneration) &&
    (value.refGeneration as number) >= 1 &&
    (value.checkpointHash === null ||
      (typeof value.checkpointHash === 'string' &&
        HASH.test(value.checkpointHash))) &&
    isHashRecord(value.files) &&
    inventoryTreeHash(value.files) === value.treeHash
  );
}

export function workspaceStateFromBranch(
  realmURL: string,
  snapshot: DeckBranchSnapshot,
): DeckWorkspaceState {
  let state: DeckWorkspaceState = {
    schema: DECK_WORKSPACE_STATE_SPEC,
    realmRRI: snapshot.realmRRI,
    realmURL: new URL(realmURL).href.replace(/\/+$/, '') + '/',
    branchId: snapshot.branchId,
    branchName: snapshot.branchName,
    baseRepositoryHash: snapshot.repositoryHash,
    baseTreeHash: snapshot.treeHash,
    baseLockHash: snapshot.lockHash,
    baseHistoryHead: snapshot.historyHead,
    baseIndexGenerationHash: snapshot.indexGenerationHash,
    observedRefGeneration: snapshot.refGeneration,
    files: snapshot.files,
  };
  if (!isDeckWorkspaceState(state)) {
    throw new Error('branch observation cannot become workspace state');
  }
  return state;
}

export function hashWorkspaceBytes(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function hashWorkspaceFile(filePath: string): Promise<string> {
  return hashWorkspaceBytes(await readFile(filePath));
}

const LOCAL_METADATA = new Set([
  '.boxel-watch.lock',
  '.boxel-sync.json',
  '.boxel-history',
  '.claude',
  '.deck',
  '.git',
  '.jj',
  '.DS_Store',
  'node_modules',
]);

export async function hashDeckWorkspaceDirectory(
  localDir: string,
): Promise<Record<string, string>> {
  let files: Record<string, string> = {};
  async function visit(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    await Promise.all(
      entries.map(async (entry) => {
        if (LOCAL_METADATA.has(entry.name)) return;
        let absolutePath = join(dir, entry.name);
        if (entry.isDirectory()) return visit(absolutePath);
        if (!entry.isFile()) return;
        let path = relative(localDir, absolutePath).split(sep).join('/');
        files[path] = await hashWorkspaceFile(absolutePath);
      }),
    );
  }
  await visit(localDir);
  return Object.fromEntries(
    Object.entries(files).sort(([a], [b]) =>
      Buffer.compare(Buffer.from(a), Buffer.from(b)),
    ),
  );
}

export function inventoryTreeHash(files: Record<string, string>): string {
  return treeHashFromEntries(
    Object.entries(files).map(([path, sha256]) => ({ path, sha256 })),
  ).treeHash;
}

export async function loadDeckWorkspaceState(
  localDir: string,
): Promise<DeckWorkspaceState | undefined> {
  let path = join(localDir, DECK_WORKSPACE_STATE_FILE);
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new Error(`${DECK_WORKSPACE_STATE_FILE} is not valid JSON`);
  }
  if (!isDeckWorkspaceState(value)) {
    throw new Error(
      `${DECK_WORKSPACE_STATE_FILE} is not a ${DECK_WORKSPACE_STATE_SPEC} record`,
    );
  }
  return value;
}

export async function saveDeckWorkspaceState(
  localDir: string,
  state: DeckWorkspaceState,
): Promise<void> {
  if (!isDeckWorkspaceState(state)) {
    throw new Error(
      `refusing to write an invalid ${DECK_WORKSPACE_STATE_SPEC}`,
    );
  }
  let path = join(localDir, DECK_WORKSPACE_STATE_FILE);
  await mkdir(dirname(path), { recursive: true });
  let temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`);
  await rename(temporary, path);
}

function sideStatus(
  baseHash: string | undefined,
  sideHash: string | undefined,
): ContentSideStatus {
  if (sideHash === baseHash) return 'unchanged';
  if (baseHash === undefined) return 'added';
  if (sideHash === undefined) return 'deleted';
  return 'changed';
}

function actionFor(
  baseHash: string | undefined,
  localHash: string | undefined,
  remoteHash: string | undefined,
): ContentSyncAction {
  if (localHash === remoteHash) return 'noop';
  if (remoteHash === baseHash) return 'push';
  if (localHash === baseHash) return 'pull';
  return 'conflict';
}

/** Three-way classification over bytes only. File mtimes are not an input. */
export function planContentAddressedSync(options: {
  base: Record<string, string>;
  local: Record<string, string>;
  remote: Record<string, string>;
}): ContentSyncPlan {
  let paths = new Set([
    ...Object.keys(options.base),
    ...Object.keys(options.local),
    ...Object.keys(options.remote),
  ]);
  let entries = [...paths]
    .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
    .map((path): ContentSyncEntry => {
      let baseHash = options.base[path];
      let localHash = options.local[path];
      let remoteHash = options.remote[path];
      return {
        path,
        ...(baseHash ? { baseHash } : {}),
        ...(localHash ? { localHash } : {}),
        ...(remoteHash ? { remoteHash } : {}),
        localStatus: sideStatus(baseHash, localHash),
        remoteStatus: sideStatus(baseHash, remoteHash),
        action: actionFor(baseHash, localHash, remoteHash),
      };
    });
  let conflicts = entries.filter(({ action }) => action === 'conflict');
  return {
    baseTreeHash: inventoryTreeHash(options.base),
    localTreeHash: inventoryTreeHash(options.local),
    remoteTreeHash: inventoryTreeHash(options.remote),
    entries,
    conflicts,
    canPublish: conflicts.length === 0,
  };
}

export class DeckBranchMovedError extends Error {}

export function assertObservedBranchHead(
  base: DeckWorkspaceState,
  remote: DeckBranchObservation,
): void {
  if (
    base.observedRefGeneration !== remote.refGeneration ||
    base.baseRepositoryHash !== remote.repositoryHash ||
    base.baseTreeHash !== remote.treeHash ||
    base.baseLockHash !== remote.lockHash
  ) {
    throw new DeckBranchMovedError(
      `branch ${base.branchName} moved from generation ${base.observedRefGeneration} to ${remote.refGeneration}; pull or sync before publishing`,
    );
  }
}
