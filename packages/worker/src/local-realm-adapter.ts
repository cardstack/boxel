import {
  RealmAdapter,
  Kind,
  FileRef,
  createResponse,
} from '@cardstack/runtime-common';
import { Deferred } from '@cardstack/runtime-common/deferred';
import { LocalPath } from '@cardstack/runtime-common/paths';

export class LocalRealmAdapter implements RealmAdapter {
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
    let s = new MessageStream();
    let response = createResponse(s.readable, responseInit);
    setupCloseHandler(s.readable, cleanup);
    return { response, writable: s.writable };
  }
}

const closeHandlers: WeakMap<ReadableStream, () => void> = new WeakMap();
export function setupCloseHandler(stream: ReadableStream, fn: () => void) {
  closeHandlers.set(stream, fn);
}

class MessageStream {
  private pendingWrite: { chunk: string; deferred: Deferred<void> } | undefined;
  private pendingRead:
    | { controller: ReadableStreamDefaultController; deferred: Deferred<void> }
    | undefined;

  readable: ReadableStream = new ReadableStream(this);
  writable: WritableStream = new WritableStream(this);

  async pull(controller: ReadableStreamDefaultController) {
    if (this.pendingRead) {
      throw new Error(
        'bug: did not expect node to call read until after we push data from the prior read'
      );
    }
    if (this.pendingWrite) {
      let { chunk, deferred } = this.pendingWrite;
      this.pendingWrite = undefined;
      // TODO: better way to handle encoding
      controller.enqueue(Uint8Array.from(chunk, (x) => x.charCodeAt(0)));
      deferred.fulfill();
    } else {
      this.pendingRead = { controller, deferred: new Deferred() };
      await this.pendingRead.deferred.promise;
    }
  }

  async write(chunk: string, _controller: WritableStreamDefaultController) {
    if (this.pendingWrite) {
      throw new Error(
        'bug: did not expect node to call write until after we call the callback'
      );
    }
    if (this.pendingRead) {
      let { controller, deferred } = this.pendingRead;
      this.pendingRead = undefined;
      try {
        // TODO: better way to handle encoding
        controller.enqueue(Uint8Array.from(chunk, (x) => x.charCodeAt(0)));
      } catch (err) {
        let cleanup = closeHandlers.get(this.readable);
        if (!cleanup) {
          throw new Error('no cleanup function found');
        }
        cleanup();
      }
      deferred.fulfill();
    } else {
      this.pendingWrite = { chunk, deferred: new Deferred() };
      await this.pendingWrite.deferred.promise;
    }
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
