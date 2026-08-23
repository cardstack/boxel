import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { hashBytes, readStoredPack, unpack } from '@cardstack/deck/node';

export const DECK_VERSION_INDEX_FORMAT = 'boxel-deck-version-index-v1';

export interface DeckIndexCard {
  rri: string;
  sourcePath: string;
  document: Record<string, unknown>;
  searchText: string;
}

export interface DeckVersionIndexSnapshot {
  format: typeof DECK_VERSION_INDEX_FORMAT;
  packageRRI: string;
  treeHash: string;
  indexHash: string;
  cards: DeckIndexCard[];
}

function collectStrings(value: unknown, output: string[]): void {
  if (typeof value === 'string') {
    output.push(value);
  } else if (Array.isArray(value)) {
    for (let child of value) {
      collectStrings(child, output);
    }
  } else if (value && typeof value === 'object') {
    for (let child of Object.values(value)) {
      collectStrings(child, output);
    }
  }
}

function cardPath(sourcePath: string): string {
  return sourcePath.endsWith('.json') ? sourcePath.slice(0, -5) : sourcePath;
}

function snapshotBytes(
  snapshot: Omit<DeckVersionIndexSnapshot, 'indexHash'>,
): Buffer {
  return Buffer.from(`${JSON.stringify(snapshot, null, 2)}\n`);
}

function indexPath(realmDir: string, treeHash: string): string {
  return join(realmDir, '.deck', 'indexes', 'versions', `${treeHash}.json`);
}

function parseSnapshot(bytes: Buffer): DeckVersionIndexSnapshot {
  let parsed = JSON.parse(bytes.toString()) as DeckVersionIndexSnapshot;
  if (
    parsed.format !== DECK_VERSION_INDEX_FORMAT ||
    typeof parsed.packageRRI !== 'string' ||
    typeof parsed.treeHash !== 'string' ||
    typeof parsed.indexHash !== 'string' ||
    !Array.isArray(parsed.cards)
  ) {
    throw new Error('invalid immutable Deck Version index snapshot');
  }
  let { indexHash: _indexHash, ...withoutHash } = parsed;
  if (hashBytes(snapshotBytes(withoutHash)) !== parsed.indexHash) {
    throw new Error('Deck Version index snapshot hash mismatch');
  }
  return parsed;
}

export async function buildDeckVersionIndex(options: {
  realmDir: string;
  packageName: string;
  version: string;
}): Promise<DeckVersionIndexSnapshot> {
  let storeDir = join(options.realmDir, '.deck', 'store');
  let packBytes = await readStoredPack(
    storeDir,
    options.packageName,
    options.version,
  );
  if (!packBytes) {
    throw new Error(
      `no stored Version ${options.packageName}@${options.version}`,
    );
  }
  let { files, treeHash } = unpack(packBytes);
  let packageRRI = `@${options.packageName}@${options.version}/`;
  let cards = indexDeckCards(files, packageRRI);
  let withoutHash: Omit<DeckVersionIndexSnapshot, 'indexHash'> = {
    format: DECK_VERSION_INDEX_FORMAT,
    packageRRI,
    treeHash,
    cards,
  };
  let snapshot: DeckVersionIndexSnapshot = {
    ...withoutHash,
    indexHash: hashBytes(snapshotBytes(withoutHash)),
  };
  let path = indexPath(options.realmDir, treeHash);
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(path, `${JSON.stringify(snapshot, null, 2)}\n`, {
      flag: 'wx',
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error;
    }
    let existing = parseSnapshot(await readFile(path));
    if (
      existing.treeHash !== snapshot.treeHash ||
      existing.indexHash !== snapshot.indexHash
    ) {
      throw new Error(`immutable Deck Version index collision for ${treeHash}`);
    }
    return existing;
  }
  return snapshot;
}

export function indexDeckCards(
  files: Map<string, Buffer>,
  packageRRI: string,
): DeckIndexCard[] {
  let cards: DeckIndexCard[] = [];
  for (let [sourcePath, bytes] of [...files.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (sourcePath.startsWith('_source/') || !sourcePath.endsWith('.json')) {
      continue;
    }
    let document: Record<string, unknown>;
    try {
      document = JSON.parse(bytes.toString()) as Record<string, unknown>;
    } catch {
      continue;
    }
    let data = document.data;
    if (
      !data ||
      typeof data !== 'object' ||
      (data as { type?: unknown }).type !== 'card'
    ) {
      continue;
    }
    let strings: string[] = [];
    collectStrings(document, strings);
    cards.push({
      rri: `${packageRRI}${cardPath(sourcePath)}`,
      sourcePath,
      document,
      searchText: strings.join(' ').toLocaleLowerCase(),
    });
  }
  return cards;
}

export function queryDeckVersionIndex(
  snapshot: DeckVersionIndexSnapshot,
  query: string | undefined,
): DeckIndexCard[] {
  let needle = query?.trim().toLocaleLowerCase();
  return needle
    ? snapshot.cards.filter((card) => card.searchText.includes(needle))
    : snapshot.cards;
}
