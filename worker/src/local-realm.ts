import { RealmAdapter, Kind, FileRef } from '@cardstack/runtime-common';

export class LocalRealm implements RealmAdapter {
  constructor(private fs: FileSystemDirectoryHandle) {}

  async *readdir(
    path: string,
    opts?: { create?: true }
  ): AsyncGenerator<{ name: string; path: string; kind: Kind }, void> {
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
    path: string,
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
  while (pathSegments.length > 1) {
    let segment = pathSegments.shift()!;
    handle = await handle.getDirectoryHandle(segment, { create });
  }

  if (targetKind === 'file') {
    return (await handle.getFileHandle(
      pathSegments[0],
      opts
    )) as HandleKind<Target>;
  }
  return (await handle.getDirectoryHandle(
    pathSegments[0],
    opts
  )) as HandleKind<Target>;
}
