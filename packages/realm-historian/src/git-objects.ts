// Loose git objects, written in git's own format so that git reads them and
// nothing else has to: an object is the zlib deflate of
// `<type> <length>\0<body>`, named by the SHA-1 of those same bytes, at
// `objects/<first 2 hex>/<remaining 38>`.
//
// Each object goes to a temp file beside its final path, is fsynced, then
// renamed into place, so a reader never sees a partial object and a crash
// leaves at most a temp file. An object whose file exists is not written
// again: its name is its content, so the file is already right.

import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { mkdir, open, rename, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';

export type ObjectType = 'blob' | 'tree' | 'commit';

export const BLOB_MODE = '100644';
export const TREE_MODE = '40000';

export interface TreeEntry {
  mode: typeof BLOB_MODE | typeof TREE_MODE;
  name: string;
  // The entry's object id, as 40 hex characters.
  id: string;
}

export interface Identity {
  name: string;
  email: string;
  // Seconds since the epoch; written with a UTC offset.
  timestamp: number;
}

export interface CommitInput {
  tree: string;
  parents: string[];
  author: Identity;
  committer: Identity;
  message: string;
}

export interface WriteResult {
  id: string;
  // False when the object's file already existed.
  written: boolean;
}

const textEncoder = new TextEncoder();

// The object's id: the SHA-1 of the header and body git hashes.
export function hashObject(type: ObjectType, body: Uint8Array): string {
  return createHash('sha1').update(framed(type, body)).digest('hex');
}

function framed(type: ObjectType, body: Uint8Array): Uint8Array {
  let header = textEncoder.encode(`${type} ${body.byteLength}\0`);
  let bytes = new Uint8Array(header.byteLength + body.byteLength);
  bytes.set(header);
  bytes.set(body, header.byteLength);
  return bytes;
}

export function blobBody(content: string | Uint8Array): Uint8Array {
  return typeof content === 'string' ? textEncoder.encode(content) : content;
}

// A tree body: each entry as `<mode> <name>\0<20 raw id bytes>`, in git's
// order, which sorts names as if every subtree's name ended in `/`.
export function treeBody(entries: TreeEntry[]): Uint8Array {
  let sorted = [...entries].sort((a, b) =>
    sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0,
  );
  let parts: Uint8Array[] = [];
  for (let entry of sorted) {
    if (
      entry.name === '' ||
      entry.name.includes('/') ||
      entry.name.includes('\0')
    ) {
      throw new Error(`invalid tree entry name ${JSON.stringify(entry.name)}`);
    }
    parts.push(textEncoder.encode(`${entry.mode} ${entry.name}\0`));
    parts.push(Uint8Array.from(Buffer.from(entry.id, 'hex')));
  }
  return concat(parts);
}

function sortKey(entry: TreeEntry): string {
  return entry.mode === TREE_MODE ? `${entry.name}/` : entry.name;
}

// A commit body. The message is written as given, with a newline added when
// it lacks one, so a trailer block stays the message's last paragraph.
export function commitBody({
  tree,
  parents,
  author,
  committer,
  message,
}: CommitInput): Uint8Array {
  let lines = [`tree ${tree}`];
  for (let parent of parents) {
    lines.push(`parent ${parent}`);
  }
  lines.push(`author ${identityLine(author)}`);
  lines.push(`committer ${identityLine(committer)}`);
  let body = `${lines.join('\n')}\n\n${message}`;
  return textEncoder.encode(body.endsWith('\n') ? body : `${body}\n`);
}

function identityLine({ name, email, timestamp }: Identity): string {
  for (let [label, value] of [
    ['name', name],
    ['email', email],
  ]) {
    if (/[<>\n]/.test(value)) {
      throw new Error(`invalid ${label} ${JSON.stringify(value)}`);
    }
  }
  return `${name} <${email}> ${Math.floor(timestamp)} +0000`;
}

export class ObjectStore {
  #gitDir: string;

  constructor(gitDir: string) {
    this.#gitDir = gitDir;
  }

  get gitDir(): string {
    return this.#gitDir;
  }

  async writeBlob(content: string | Uint8Array): Promise<WriteResult> {
    return this.write('blob', blobBody(content));
  }

  async writeTree(entries: TreeEntry[]): Promise<WriteResult> {
    return this.write('tree', treeBody(entries));
  }

  async writeCommit(commit: CommitInput): Promise<WriteResult> {
    return this.write('commit', commitBody(commit));
  }

  // Writes the object unless its file exists, and returns its id.
  async write(type: ObjectType, body: Uint8Array): Promise<WriteResult> {
    let id = hashObject(type, body);
    let path = this.pathOf(id);
    if (await exists(path)) {
      return { id, written: false };
    }
    let directory = join(this.#gitDir, 'objects', id.slice(0, 2));
    await mkdir(directory, { recursive: true });
    let temp = join(
      directory,
      `tmp_obj_${process.pid}_${Math.random().toString(36).slice(2, 10)}`,
    );
    let handle = await open(temp, 'wx', 0o444);
    try {
      await handle.writeFile(deflateSync(framed(type, body)));
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(temp, path);
    } catch (error) {
      await unlink(temp).catch(() => {});
      throw error;
    }
    return { id, written: true };
  }

  pathOf(id: string): string {
    return join(this.#gitDir, 'objects', id.slice(0, 2), id.slice(2));
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

function concat(parts: Uint8Array[]): Uint8Array {
  let length = parts.reduce((sum, part) => sum + part.byteLength, 0);
  let bytes = new Uint8Array(length);
  let offset = 0;
  for (let part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
}

// A flat map of paths to entries, written as nested trees. A path's entry is
// a blob id, or a tree id for a subtree written separately, such as a
// size-only entry.
export class TreeBuilder {
  #entries = new Map<string, { mode: TreeEntry['mode']; id: string }>();

  set(path: string, entry: { mode: TreeEntry['mode']; id: string }): void {
    if (path === '' || path.startsWith('/') || path.endsWith('/')) {
      throw new Error(`invalid path ${JSON.stringify(path)}`);
    }
    this.#entries.set(path, entry);
  }

  delete(path: string): void {
    this.#entries.delete(path);
  }

  get size(): number {
    return this.#entries.size;
  }

  // Writes every tree the entries need and returns the root's id.
  async write(store: ObjectStore): Promise<string> {
    return (await this.#writeDirectory(store, '')).id;
  }

  async #writeDirectory(
    store: ObjectStore,
    prefix: string,
  ): Promise<WriteResult> {
    let entries: TreeEntry[] = [];
    let subdirectories = new Set<string>();
    for (let [path, entry] of this.#entries) {
      if (!path.startsWith(prefix)) {
        continue;
      }
      let rest = path.slice(prefix.length);
      let slash = rest.indexOf('/');
      if (slash === -1) {
        entries.push({ mode: entry.mode, name: rest, id: entry.id });
      } else {
        subdirectories.add(rest.slice(0, slash));
      }
    }
    for (let name of subdirectories) {
      let { id } = await this.#writeDirectory(store, `${prefix}${name}/`);
      entries.push({ mode: TREE_MODE, name, id });
    }
    return store.writeTree(entries);
  }
}
