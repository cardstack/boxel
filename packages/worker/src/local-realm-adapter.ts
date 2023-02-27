import {
  RealmAdapter,
  Kind,
  FileRef,
  createResponse,
} from '@cardstack/runtime-common';
import { LocalPath } from '@cardstack/runtime-common/paths';
import {
  WebMessageStream,
  messageCloseHandler,
} from '@cardstack/runtime-common/stream';

export class LocalRealmAdapter implements RealmAdapter {
  constructor(private fs: FileSystemDirectoryHandle) {}

  async *readdir(
    path: LocalPath,
    opts?: {
      create?: true;
    }
  ): AsyncGenerator<{ name: string; path: LocalPath; kind: Kind }, void> {
    let dirHandle = isTopPath(path)
      ? this.fs
      : await traverse(this.fs, path, 'directory', opts);
    for await (let [name, handle] of dirHandle as unknown as AsyncIterable<
      [string, FileSystemDirectoryHandle | FileSystemFileHandle]
    >) {
      let innerPath = isTopPath(path) ? name : `${path}/${name}`;
      yield { name, path: innerPath, kind: handle.kind };
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      await traverse(this.fs, path, 'directory');
      return true;
    } catch (err: any) {
      if (err.name === 'NotFoundError') {
        return false;
      }
      if (err.name === 'TypeMismatchError') {
        try {
          await traverse(this.fs, path, 'file');
          return true;
        } catch (err: any) {
          if (err.name === 'NotFoundError') {
            return false;
          }
          throw err;
        }
      }
      throw err;
    }
  }

  async openFile(path: string): Promise<FileRef | undefined> {
    try {
      let fileHandle = await traverse(this.fs, path, 'file');
      let file = await fileHandle.getFile();
      let lazyContent: ReadableStream<Uint8Array> | null = null;
      return {
        path,
        get content() {
          if (!lazyContent) {
            lazyContent =
              file.stream() as unknown as ReadableStream<Uint8Array>;
          }
          return lazyContent;
        },
        lastModified: file.lastModified,
      };
    } catch (err: any) {
      if (['TypeMismatchError', 'NotFoundError'].includes(err.name)) {
        return undefined;
      }
      throw err;
    }
  }

  async write(
    path: LocalPath,
    contents: string
  ): Promise<{ lastModified: number }> {
    let handle = await traverse(this.fs, path, 'file', { create: true });
    // TypeScript seems to lack types for the writable stream features
    let stream = await (handle as any).createWritable();
    await stream.write(contents);
    await stream.close();
    let { lastModified } = await handle.getFile();
    return { lastModified };
  }

  async remove(path: LocalPath): Promise<void> {
    if (!path) {
      return;
    }
    let pathSegments = path.split('/');
    if (pathSegments.length === 1) {
      return this.fs.removeEntry(path);
    }
    let fileName = pathSegments.pop();
    let dirHandle = await traverse(
      this.fs,
      pathSegments.join('/'),
      'directory'
    );
    return dirHandle.removeEntry(fileName!);
  }

  createStreamingResponse(
    _request: Request,
    responseInit: ResponseInit,
    cleanup: () => void
  ): { response: Response; writable: WritableStream } {
    let s = new WebMessageStream();
    let response = createResponse(s.readable, responseInit);
    messageCloseHandler(s.readable, cleanup);
    return { response, writable: s.writable };
  }

  private watcher: number | undefined = undefined;
  private entries: { path: string; lastModified?: number }[] = [];

  async subscribe(cb: (message: Record<string, any>) => void): Promise<void> {
    if (this.watcher) {
      throw new Error(`tried to subscribe to watcher twice`);
    }
    this.watcher = setInterval(async () => {
      let currentEntries = await this.getDirectoryListings('', []);
      if (this.entries.length > 0) {
        let changes = diff(this.entries, currentEntries);
        for (let [key, val] of Object.entries(changes)) {
          if (val.length > 0) {
            cb({ [key]: val.join(', ') });
          }
        }
      }
      this.entries = currentEntries;
    }, 1000);
  }

  unsubscribe(): void {
    if (!this.watcher) {
      return;
    }
    clearInterval(this.watcher);
    this.watcher = undefined;
  }

  private async getDirectoryListings(
    dirPath: string,
    entries: { path: string; lastModified?: number }[]
  ) {
    let listing = this.readdir(dirPath);
    for await (let entry of listing) {
      if (entry.kind === 'directory') {
        entries.push({ path: entry.path });
        await this.getDirectoryListings(entry.path, entries);
      } else {
        let fileRef = await this.openFile(entry.path);
        if (fileRef) {
          let { lastModified } = fileRef;
          entries.push({ path: entry.path, lastModified });
        }
      }
    }
    return entries;
  }
}

function isTopPath(path: string): boolean {
  return path === '';
}

type HandleKind<T extends Kind> = T extends 'file'
  ? FileSystemFileHandle
  : FileSystemDirectoryHandle;

export async function traverse<Target extends Kind>(
  dirHandle: FileSystemDirectoryHandle,
  path: string,
  targetKind: Target,
  opts?: { create?: boolean }
): Promise<HandleKind<Target>> {
  let pathSegments = path.split('/');
  let create = opts?.create;

  let handle = dirHandle;
  while (pathSegments.length > 1 && path !== '') {
    let segment = pathSegments.shift()!;
    handle = await handle.getDirectoryHandle(segment, { create });
  }

  if (targetKind === 'directory') {
    if (path === '') {
      return dirHandle as HandleKind<Target>;
    }
    return (await handle.getDirectoryHandle(
      pathSegments[0],
      opts
    )) as HandleKind<Target>;
  }
  return (await handle.getFileHandle(
    pathSegments[0],
    opts
  )) as HandleKind<Target>;
}

function changedEntry(
  listings: { path: string; lastModified?: number }[],
  entry: { path: string; lastModified?: number }
) {
  return listings.some(
    (item) =>
      item.path === entry.path && item.lastModified != entry.lastModified
  );
}

function hasEntry(
  listings: { path: string; lastModified?: number }[],
  entry: { path: string; lastModified?: number }
) {
  return listings.some((item) => item.path === entry.path);
}

export function diff(
  prevEntries: { path: string; lastModified?: number }[],
  currEntries: { path: string; lastModified?: number }[]
) {
  let changed = prevEntries.filter((entry) => changedEntry(currEntries, entry));
  let added = currEntries.filter((entry) => !hasEntry(prevEntries, entry));
  let removed = prevEntries.filter((entry) => !hasEntry(currEntries, entry));

  return {
    added: added.map((e) => e.path),
    removed: removed.map((e) => e.path),
    changed: changed.map((e) => e.path),
  };
}
