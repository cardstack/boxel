import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { isIgnoredTreeSegment, isValidTreePath } from './tree-hash.ts';

// Reading and writing a deck's tree as plain bytes. Everything that moves
// trees around — fork, rebase, restore — goes through here, so they all
// agree on what a tree IS: the same files the tree hash covers, and nothing
// a depot keeps for its own bookkeeping.

export async function readTreeFromDir(
  dir: string,
): Promise<Map<string, Buffer>> {
  let files = new Map<string, Buffer>();
  async function walk(current: string, prefix: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (let entry of entries) {
      if (isIgnoredTreeSegment(entry.name)) {
        continue;
      }
      let path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        await walk(join(current, entry.name), path);
      } else if (entry.isFile()) {
        files.set(path, await readFile(join(current, entry.name)));
      }
    }
  }
  await walk(dir, '');
  return files;
}

export interface WriteTreeResult {
  written: string[];
  deleted: string[];
}

/**
 * Makes `dir` hold exactly `files`. Only bytes that actually differ are
 * written — a no-op write would still be a save, and every save here
 * publishes and seals.
 */
export async function writeTreeToDir(
  dir: string,
  files: Map<string, Buffer>,
  options: { prune?: boolean } = {},
): Promise<WriteTreeResult> {
  let current = await readTreeFromDir(dir);
  let written: string[] = [];
  for (let [path, bytes] of files) {
    if (!isValidTreePath(path)) {
      throw new Error(`refusing to write unsafe path: ${path}`);
    }
    if (current.get(path)?.equals(bytes)) {
      continue;
    }
    let destination = join(dir, ...path.split('/'));
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
    written.push(path);
  }
  let deleted: string[] = [];
  if (options.prune !== false) {
    for (let path of current.keys()) {
      if (files.has(path)) {
        continue;
      }
      await rm(join(dir, ...path.split('/')), { force: true });
      deleted.push(path);
    }
  }
  return { written: written.sort(), deleted: deleted.sort() };
}
