import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { isExactVersionRRI, parseRRI, realmRRI } from '@cardstack/deck';
import {
  canonicalJson,
  isHash,
  listReviews,
  previewReview,
  readBranchHead,
  readCheckpoint,
  readRepository,
  readRepositoryLock,
  readReview,
  realmDeckPath,
  type BranchHead,
  type Checkpoint,
  type JsonValue,
  type Repository,
  type RepositoryMergeResult,
  type ReviewSnapshot,
  type StoredReview,
} from '@cardstack/deck/node';

import {
  hasDeckCollaboration,
  type DeckCollaborationPolicy,
} from './deck-collaboration-policy.ts';

export class DeckCollaborationUnavailableError extends Error {}
export class DeckProtocolIntegrityError extends Error {}

export interface CanonicalBranchSnapshot {
  realmRRI: string;
  branch: string;
  head: BranchHead;
  checkpoint?: Checkpoint;
  repository: Repository;
  lock: JsonValue;
}

export interface CanonicalReviewSnapshot {
  ref: ReviewSnapshot;
  checkpoint: Checkpoint;
  repository: Repository;
  lock: JsonValue;
}

export interface CanonicalReview {
  stored: StoredReview;
  base: CanonicalReviewSnapshot;
  target: CanonicalReviewSnapshot;
  source: CanonicalReviewSnapshot;
}

export const VERSION_ORIGIN_SPEC = 'boxel-deck-version-origin-v1';

export interface VersionOrigin {
  schema: typeof VERSION_ORIGIN_SPEC;
  versionRRI: string;
  checkpointHash: string;
  repositoryHash: string;
  treeHash: string;
  indexHash: string;
  lockHash: string;
}

export interface DeckRepositoryProtocol {
  readonly realmRRI: string;
  readBranch(branch: string): Promise<CanonicalBranchSnapshot | undefined>;
  readReview(number: number): Promise<CanonicalReview | undefined>;
  listReviews(): Promise<CanonicalReview[]>;
  previewReview(number: number): Promise<RepositoryMergeResult>;
  readVersionOrigin(versionRRI: string): Promise<VersionOrigin | undefined>;
  recordVersionOrigin(options: {
    versionRRI: string;
    checkpointHash: string;
    treeHash: string;
    indexHash: string;
  }): Promise<VersionOrigin>;
}

function integrity(message: string): never {
  throw new DeckProtocolIntegrityError(message);
}

async function readCanonicalRepository(
  realmDir: string,
  expectedRealmRRI: string,
  hash: string,
): Promise<{ repository: Repository; lock: JsonValue }> {
  let repository = await readRepository(realmDir, hash);
  if (!repository) integrity(`missing Repository ${hash}`);
  if (
    !repository.roots.includes(expectedRealmRRI) ||
    !(expectedRealmRRI in repository.members)
  ) {
    integrity(
      `Repository ${hash} does not contain canonical root ${expectedRealmRRI}`,
    );
  }
  let lock = await readRepositoryLock(realmDir, repository.lockHash);
  if (!lock) integrity(`missing Repository lock ${repository.lockHash}`);
  return { repository, lock };
}

async function readCanonicalReviewSnapshot(
  realmDir: string,
  expectedRealmRRI: string,
  ref: ReviewSnapshot,
): Promise<CanonicalReviewSnapshot> {
  if (realmRRI(ref.repository) !== expectedRealmRRI) {
    integrity(
      `Review snapshot names ${ref.repository}, expected ${expectedRealmRRI}`,
    );
  }
  let checkpoint = await readCheckpoint(realmDir, ref.checkpointHash);
  if (!checkpoint) integrity(`missing Checkpoint ${ref.checkpointHash}`);
  let { repository, lock } = await readCanonicalRepository(
    realmDir,
    expectedRealmRRI,
    checkpoint.repositoryHash,
  );
  return { ref, checkpoint, repository, lock };
}

function versionOriginPath(
  realmDir: string,
  expectedRealmRRI: string,
  identifier: string,
): string {
  if (!isExactVersionRRI(identifier)) {
    throw new Error('Version origin requires an exact Version RRI');
  }
  let parsed = parseRRI(identifier);
  let mutableRealmRRI = `@${parsed.scope}/${parsed.name}/`;
  if (mutableRealmRRI !== expectedRealmRRI || parsed.path !== '') {
    throw new Error(`Version ${identifier} does not name ${expectedRealmRRI}`);
  }
  return realmDeckPath(realmDir, 'versions', `${parsed.version}.json`);
}

async function validateVersionOrigin(
  realmDir: string,
  expectedRealmRRI: string,
  value: VersionOrigin,
): Promise<VersionOrigin> {
  if (
    value.schema !== VERSION_ORIGIN_SPEC ||
    !isHash(value.checkpointHash) ||
    !isHash(value.repositoryHash) ||
    !isHash(value.treeHash) ||
    !isHash(value.indexHash) ||
    !isHash(value.lockHash)
  ) {
    integrity('invalid Version origin');
  }
  versionOriginPath(realmDir, expectedRealmRRI, value.versionRRI);
  let checkpoint = await readCheckpoint(realmDir, value.checkpointHash);
  if (!checkpoint) integrity(`missing Checkpoint ${value.checkpointHash}`);
  if (
    checkpoint.repositoryHash !== value.repositoryHash ||
    checkpoint.indexGenerationHash !== value.indexHash
  ) {
    integrity(`Version ${value.versionRRI} does not match its Checkpoint`);
  }
  let { repository } = await readCanonicalRepository(
    realmDir,
    expectedRealmRRI,
    value.repositoryHash,
  );
  if (
    repository.members[expectedRealmRRI] !== value.treeHash ||
    repository.lockHash !== value.lockHash
  ) {
    integrity(`Version ${value.versionRRI} does not match its Repository`);
  }
  return value;
}

export function openDeckRepositoryProtocol(options: {
  realmDir: string;
  realmRRI: string;
  policy: DeckCollaborationPolicy | undefined;
}): DeckRepositoryProtocol {
  let canonicalRealmRRI = realmRRI(options.realmRRI);
  if (!hasDeckCollaboration(options.policy, canonicalRealmRRI)) {
    throw new DeckCollaborationUnavailableError(
      `Deck collaboration is not enabled for ${canonicalRealmRRI}`,
    );
  }

  return {
    realmRRI: canonicalRealmRRI,

    async readBranch(branch) {
      let head = await readBranchHead(options.realmDir, branch);
      if (!head) return undefined;
      let { repository, lock } = await readCanonicalRepository(
        options.realmDir,
        canonicalRealmRRI,
        head.repositoryHash,
      );
      let checkpoint = head.latestCheckpointHash
        ? await readCheckpoint(options.realmDir, head.latestCheckpointHash)
        : undefined;
      if (head.latestCheckpointHash && !checkpoint) {
        integrity(`missing Checkpoint ${head.latestCheckpointHash}`);
      }
      let exactCheckpoint =
        checkpoint &&
        checkpoint.repositoryHash === head.repositoryHash &&
        checkpoint.historyHead === head.historyHead &&
        checkpoint.indexGenerationHash === head.indexGenerationHash
          ? checkpoint
          : undefined;
      return {
        realmRRI: canonicalRealmRRI,
        branch,
        head,
        ...(exactCheckpoint ? { checkpoint: exactCheckpoint } : {}),
        repository,
        lock,
      };
    },

    async readReview(number) {
      let stored = await readReview(options.realmDir, number);
      if (!stored) return undefined;
      let [base, target, source] = await Promise.all([
        readCanonicalReviewSnapshot(
          options.realmDir,
          canonicalRealmRRI,
          stored.review.base,
        ),
        readCanonicalReviewSnapshot(
          options.realmDir,
          canonicalRealmRRI,
          stored.review.target,
        ),
        readCanonicalReviewSnapshot(
          options.realmDir,
          canonicalRealmRRI,
          stored.review.source,
        ),
      ]);
      return { stored, base, target, source };
    },

    async listReviews() {
      let stored = await listReviews(options.realmDir);
      let values = await Promise.all(
        stored.map(({ ref }) => this.readReview(ref.number)),
      );
      return values.filter(
        (value): value is CanonicalReview => value !== undefined,
      );
    },

    async previewReview(number) {
      if (!(await this.readReview(number))) {
        throw new Error(`no Review #${number}`);
      }
      return previewReview(options.realmDir, number);
    },

    async readVersionOrigin(identifier) {
      let path = versionOriginPath(
        options.realmDir,
        canonicalRealmRRI,
        identifier,
      );
      let value: VersionOrigin;
      try {
        value = JSON.parse(await readFile(path, 'utf8')) as VersionOrigin;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT')
          return undefined;
        throw error;
      }
      if (value.versionRRI !== identifier) {
        integrity(`Version origin at ${path} names ${value.versionRRI}`);
      }
      return validateVersionOrigin(options.realmDir, canonicalRealmRRI, value);
    },

    async recordVersionOrigin(origin) {
      let checkpoint = await readCheckpoint(
        options.realmDir,
        origin.checkpointHash,
      );
      if (!checkpoint) integrity(`missing Checkpoint ${origin.checkpointHash}`);
      let { repository } = await readCanonicalRepository(
        options.realmDir,
        canonicalRealmRRI,
        checkpoint.repositoryHash,
      );
      let value: VersionOrigin = {
        schema: VERSION_ORIGIN_SPEC,
        versionRRI: origin.versionRRI,
        checkpointHash: origin.checkpointHash,
        repositoryHash: checkpoint.repositoryHash,
        treeHash: origin.treeHash,
        indexHash: origin.indexHash,
        lockHash: repository.lockHash,
      };
      await validateVersionOrigin(options.realmDir, canonicalRealmRRI, value);
      let path = versionOriginPath(
        options.realmDir,
        canonicalRealmRRI,
        origin.versionRRI,
      );
      let bytes = canonicalJson(value as unknown as JsonValue);
      await mkdir(dirname(path), { recursive: true });
      try {
        await writeFile(path, bytes, { flag: 'wx' });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        let existing = await readFile(path);
        if (!existing.equals(bytes)) {
          integrity(
            `Version origin already exists with different bytes: ${path}`,
          );
        }
      }
      return value;
    },
  };
}
