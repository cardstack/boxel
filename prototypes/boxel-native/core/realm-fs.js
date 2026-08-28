import { createHash } from 'node:crypto';

export function md5(content) {
  return createHash('md5').update(content).digest('hex');
}

export class RealmFs {
  constructor() {
    /** @type {Map<string, { content: string, mtimeMs: number }>} */
    this.files = new Map();
  }

  list() {
    return [...this.files.keys()].sort();
  }

  read(relativePath) {
    const entry = this.files.get(relativePath);
    if (!entry) return null;
    return entry.content;
  }

  stat(relativePath) {
    const entry = this.files.get(relativePath);
    if (!entry) return null;
    return { mtimeMs: entry.mtimeMs, hash: md5(entry.content) };
  }

  write(relativePath, content, mtimeMs = Date.now()) {
    this.files.set(relativePath, { content, mtimeMs });
  }

  delete(relativePath) {
    this.files.delete(relativePath);
  }

  hashes() {
    const out = new Map();
    for (const [path, entry] of this.files) {
      out.set(path, md5(entry.content));
    }
    return out;
  }

  mtimes() {
    const out = new Map();
    for (const [path, entry] of this.files) {
      out.set(path, entry.mtimeMs);
    }
    return out;
  }

  snapshot() {
    const out = {};
    for (const [path, entry] of this.files) {
      out[path] = { content: entry.content, mtimeMs: entry.mtimeMs };
    }
    return out;
  }
}

export class SimulatedRemote {
  constructor() {
    /** @type {Map<string, { content: string, mtimeSec: number }>} */
    this.files = new Map();
  }

  mtimes() {
    const out = new Map();
    for (const [path, entry] of this.files) {
      out.set(path, entry.mtimeSec);
    }
    return out;
  }

  hashes() {
    const out = new Map();
    for (const [path, entry] of this.files) {
      out.set(path, md5(entry.content));
    }
    return out;
  }

  read(relativePath) {
    return this.files.get(relativePath)?.content ?? null;
  }

  write(relativePath, content, mtimeSec = Math.floor(Date.now() / 1000)) {
    this.files.set(relativePath, { content, mtimeSec });
  }

  delete(relativePath) {
    this.files.delete(relativePath);
  }
}
