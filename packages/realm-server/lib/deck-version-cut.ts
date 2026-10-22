import { join } from 'node:path';

import {
  checkpoint,
  pack,
  publishToStore,
  readStoreMeta,
  storeCheckpoint,
  unpack,
  type Actor,
} from '@cardstack/deck/node';
import { readObject, readTree } from '@cardstack/deck/object-store';

import type { DeckCollaborationPolicy } from './deck-collaboration-policy.ts';
import {
  DeckProtocolIntegrityError,
  openDeckRepositoryProtocol,
  type VersionOrigin,
} from './deck-repository-protocol.ts';
import { storePackageName } from './deck-realm-packages.ts';
import { buildDeckVersionIndex } from './deck-version-index.ts';

export const DECK_VERSION_CUT_SPEC = 'boxel-deck-version-cut-v1';

export interface DeckVersionCutRequest {
  schema: typeof DECK_VERSION_CUT_SPEC;
  // The semver to cut. Defaults to the version the package's own
  // package.json declares at the branch head, and must agree with it.
  version?: string;
  // The Repository the caller observed. A head that moved since is refused,
  // so a Version is never cut from a state the caller did not see.
  expectedRepositoryHash?: string;
}

// The Version exists already, or the branch moved since the caller read it.
export class DeckVersionConflictError extends Error {}
// The request cannot name a Version: no such package at the head, an invalid
// semver, or one package.json does not declare.
export class DeckVersionRequestError extends Error {}

export interface DeckVersionCut extends VersionOrigin {
  packageRRI: string;
  version: string;
}

/**
 * Cut an exact semver Version of one package the realm hosts, from the
 * package's tree at the branch head.
 *
 * A Version names a tree the store already holds: the branch writer stored
 * each package's tree when it accepted the write, so publishing it writes the
 * Version's record and copies no bytes. Deck core's store refuses a number it
 * already holds and checks that the tree's package.json declares it. A
 * Checkpoint then pins the exact Repository and History head the Version came
 * from, and the write-once origin record ties the two together.
 */
export async function cutDeckVersion(options: {
  realmDir: string;
  realmRRI: string;
  packageRRI: string;
  branch: string;
  policy: DeckCollaborationPolicy;
  request: DeckVersionCutRequest;
  actor?: Actor;
  now?: Date;
}): Promise<DeckVersionCut> {
  if (options.request.schema !== DECK_VERSION_CUT_SPEC) {
    throw new DeckVersionRequestError('unsupported Deck Version cut request');
  }
  let protocol = openDeckRepositoryProtocol(options);
  let snapshot = await protocol.readBranch(options.branch);
  if (!snapshot) {
    throw new DeckVersionRequestError(`branch not found: ${options.branch}`);
  }
  let expected = options.request.expectedRepositoryHash;
  if (expected !== undefined && expected !== snapshot.head.repositoryHash) {
    throw new DeckVersionConflictError(
      `branch ${options.branch} moved since it was read`,
    );
  }
  let treeHash = snapshot.repository.members[options.packageRRI];
  if (!treeHash) {
    throw new DeckVersionRequestError(
      `${options.packageRRI} is not a package on ${options.branch}`,
    );
  }

  let storeDir = join(options.realmDir, '.deck', 'store');
  let tree = await readTree(storeDir, treeHash);
  if (!tree) {
    throw new DeckProtocolIntegrityError(`missing package tree ${treeHash}`);
  }
  let entries: { path: string; bytes: Buffer }[] = [];
  for (let entry of tree.entries) {
    let bytes = await readObject(storeDir, entry.sha256);
    if (!bytes) {
      throw new DeckProtocolIntegrityError(
        `missing tree object ${entry.sha256} for ${entry.path}`,
      );
    }
    entries.push({ path: entry.path, bytes });
  }
  let declared = declaredVersion(entries, options.packageRRI);
  let version = options.request.version ?? declared;
  if (version !== declared) {
    throw new DeckVersionRequestError(
      `package.json declares ${options.packageRRI} version ${declared}, not ${version}`,
    );
  }

  let packageName = storePackageName(options.packageRRI);
  if ((await readStoreMeta(storeDir, packageName))?.versions[version]) {
    throw new DeckVersionConflictError(
      `${options.packageRRI.slice(0, -1)}@${version} already exists`,
    );
  }
  let packed = pack(entries);
  if (unpack(packed).treeHash !== treeHash) {
    throw new DeckProtocolIntegrityError(
      `package tree ${treeHash} does not re-pack to itself`,
    );
  }
  try {
    await publishToStore(storeDir, packageName, version, packed, {
      now: options.now,
    });
  } catch (error) {
    let message = (error as Error).message;
    if (message.startsWith('version already published')) {
      throw new DeckVersionConflictError(message);
    }
    if (message.startsWith('not an exact canonical semver version')) {
      throw new DeckVersionRequestError(message);
    }
    throw error;
  }

  let index = await buildDeckVersionIndex({
    realmDir: options.realmDir,
    packageName,
    version,
  });
  let versionRRI = `${options.packageRRI.slice(0, -1)}@${version}/`;
  let checkpointHash = await storeCheckpoint(
    options.realmDir,
    checkpoint({
      repositoryHash: snapshot.head.repositoryHash,
      parents: snapshot.head.latestCheckpointHash
        ? [snapshot.head.latestCheckpointHash]
        : [],
      historyHead: snapshot.head.historyHead,
      indexGenerationHash: index.indexHash,
      author: options.actor ?? { id: options.realmRRI },
      message: `Version ${versionRRI}`,
      createdAt: (options.now ?? new Date()).toISOString(),
    }),
  );
  let origin = await protocol.recordVersionOrigin({
    versionRRI,
    checkpointHash,
    treeHash,
    indexHash: index.indexHash,
  });
  return { ...origin, packageRRI: options.packageRRI, version };
}

function declaredVersion(
  entries: { path: string; bytes: Buffer }[],
  packageRRI: string,
): string {
  let manifest = entries.find(({ path }) => path === 'package.json');
  let parsed: { name?: unknown; version?: unknown } | undefined;
  try {
    parsed = manifest ? JSON.parse(manifest.bytes.toString('utf8')) : undefined;
  } catch {
    parsed = undefined;
  }
  if (
    typeof parsed?.name !== 'string' ||
    `${parsed.name}/` !== packageRRI ||
    typeof parsed.version !== 'string'
  ) {
    throw new DeckVersionRequestError(
      `${packageRRI} has no package.json declaring its name and version at the branch head`,
    );
  }
  return parsed.version;
}
