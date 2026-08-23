import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  canonicalJson,
  hashProtocolObject,
  isHash,
  type JsonValue,
} from '@cardstack/deck/node';
import { readObject, readTree } from '@cardstack/deck/object-store';

import {
  DeckProtocolIntegrityError,
  openDeckRepositoryProtocol,
  type CanonicalBranchSnapshot,
} from './deck-repository-protocol.ts';
import type { DeckCollaborationPolicy } from './deck-collaboration-policy.ts';
import { indexDeckCards, type DeckIndexCard } from './deck-version-index.ts';

export const REALM_VIEW_CONTEXT_SPEC = 'boxel-realm-view-context-v1';
export const DECK_INDEX_GENERATION_SPEC = 'boxel-deck-index-generation-v1';

export interface RealmViewContext {
  schema: typeof REALM_VIEW_CONTEXT_SPEC;
  realmRRI: string;
  branch: string;
  repositoryHash: string;
  treeHash: string;
  lockHash: string;
  historyHead: string;
}

export interface DeckIndexGeneration {
  schema: typeof DECK_INDEX_GENERATION_SPEC;
  view: RealmViewContext;
  cards: DeckIndexCard[];
}

export interface DeckBranchIndexSnapshot {
  view: RealmViewContext;
  indexGenerationHash: string;
  cards: DeckIndexCard[];
}

export class DeckIndexPendingError extends Error {}

function generationPath(realmDir: string, hash: string): string {
  return join(
    realmDir,
    '.deck',
    'indexes',
    'generations',
    hash.slice(0, 2),
    `${hash}.json`,
  );
}

function realmViewContext(branch: CanonicalBranchSnapshot): RealmViewContext {
  return {
    schema: REALM_VIEW_CONTEXT_SPEC,
    realmRRI: branch.realmRRI,
    branch: branch.branch,
    repositoryHash: branch.head.repositoryHash,
    treeHash: branch.repository.members[branch.realmRRI],
    lockHash: branch.repository.lockHash,
    historyHead: branch.head.historyHead,
  };
}

function parseGeneration(
  bytes: Buffer,
  expectedHash: string,
): DeckIndexGeneration {
  let value = JSON.parse(bytes.toString()) as DeckIndexGeneration;
  if (
    value.schema !== DECK_INDEX_GENERATION_SPEC ||
    value.view?.schema !== REALM_VIEW_CONTEXT_SPEC ||
    typeof value.view.realmRRI !== 'string' ||
    typeof value.view.branch !== 'string' ||
    !isHash(value.view.repositoryHash) ||
    !isHash(value.view.treeHash) ||
    !isHash(value.view.lockHash) ||
    typeof value.view.historyHead !== 'string' ||
    !Array.isArray(value.cards) ||
    hashProtocolObject(value as unknown as JsonValue) !== expectedHash
  ) {
    throw new DeckProtocolIntegrityError(
      `invalid Deck index generation ${expectedHash}`,
    );
  }
  return value;
}

export async function readDeckIndexGeneration(
  realmDir: string,
  hash: string,
): Promise<DeckIndexGeneration | undefined> {
  if (!isHash(hash)) return undefined;
  try {
    return parseGeneration(
      await readFile(generationPath(realmDir, hash)),
      hash,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

export async function buildDeckBranchIndex(options: {
  realmDir: string;
  branch: CanonicalBranchSnapshot;
  historyHead: string;
  repositoryHash: string;
  treeHash: string;
  lockHash: string;
}): Promise<DeckBranchIndexSnapshot> {
  let view: RealmViewContext = {
    schema: REALM_VIEW_CONTEXT_SPEC,
    realmRRI: options.branch.realmRRI,
    branch: options.branch.branch,
    repositoryHash: options.repositoryHash,
    treeHash: options.treeHash,
    lockHash: options.lockHash,
    historyHead: options.historyHead,
  };
  let storeDir = join(options.realmDir, '.deck', 'store');
  let tree = await readTree(storeDir, options.treeHash);
  if (!tree) {
    throw new DeckProtocolIntegrityError(
      `missing index source tree ${options.treeHash}`,
    );
  }
  let files = new Map<string, Buffer>();
  for (let entry of tree.entries) {
    let bytes = await readObject(storeDir, entry.sha256);
    if (!bytes) {
      throw new DeckProtocolIntegrityError(
        `missing index source object ${entry.sha256} for ${entry.path}`,
      );
    }
    files.set(entry.path, bytes);
  }
  let generation: DeckIndexGeneration = {
    schema: DECK_INDEX_GENERATION_SPEC,
    view,
    cards: indexDeckCards(files, view.realmRRI),
  };
  let indexGenerationHash = hashProtocolObject(
    generation as unknown as JsonValue,
  );
  let path = generationPath(options.realmDir, indexGenerationHash);
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(path, canonicalJson(generation as unknown as JsonValue), {
      flag: 'wx',
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    parseGeneration(await readFile(path), indexGenerationHash);
  }
  return { view, indexGenerationHash, cards: generation.cards };
}

function sameView(a: RealmViewContext, b: RealmViewContext): boolean {
  return (
    a.realmRRI === b.realmRRI &&
    a.branch === b.branch &&
    a.repositoryHash === b.repositoryHash &&
    a.treeHash === b.treeHash &&
    a.lockHash === b.lockHash &&
    a.historyHead === b.historyHead
  );
}

export async function readDeckBranchIndex(options: {
  realmDir: string;
  realmRRI: string;
  branch: string;
  policy: DeckCollaborationPolicy;
}): Promise<DeckBranchIndexSnapshot> {
  let branch = await openDeckRepositoryProtocol(options).readBranch(
    options.branch,
  );
  if (!branch) throw new Error(`branch not found: ${options.branch}`);
  let expected = realmViewContext(branch);
  let generation = await readDeckIndexGeneration(
    options.realmDir,
    branch.head.indexGenerationHash,
  );
  if (!generation) {
    throw new DeckIndexPendingError(
      `branch ${options.branch} index generation is not available`,
    );
  }
  if (!sameView(generation.view, expected)) {
    throw new DeckProtocolIntegrityError(
      `branch ${options.branch} does not match index generation ${branch.head.indexGenerationHash}`,
    );
  }
  return {
    view: generation.view,
    indexGenerationHash: branch.head.indexGenerationHash,
    cards: generation.cards,
  };
}

export function queryDeckBranchIndex(
  snapshot: DeckBranchIndexSnapshot,
  query: string | undefined,
): DeckIndexCard[] {
  let needle = query?.trim().toLocaleLowerCase();
  return needle
    ? snapshot.cards.filter(({ searchText }) => searchText.includes(needle))
    : snapshot.cards;
}
