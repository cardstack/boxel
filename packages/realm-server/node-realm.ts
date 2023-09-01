import {
  RealmAdapter,
  Kind,
  FileRef,
  createResponse,
  type ResponseWithNodeStream,
} from '@cardstack/runtime-common';
import { LocalPath } from '@cardstack/runtime-common/paths';
import { ServerResponse } from 'http';
import sane, { type Watcher } from 'sane';

import {
  readdirSync,
  existsSync,
  writeFileSync,
  statSync,
  ensureDirSync,
  ensureFileSync,
  createReadStream,
  removeSync,
  ReadStream,
} from 'fs-extra';
import { join } from 'path';
import { Duplex } from 'node:stream';

export class NodeAdapter implements RealmAdapter {
  constructor(private realmDir: string) {}

  async *readdir(
    path: string,
    opts?: { create?: true },
  ): AsyncGenerator<{ name: string; path: string; kind: Kind }, void> {
    if (opts?.create) {
      ensureDirSync(path);
    }
    let absolutePath = join(this.realmDir, path);
    let entries = readdirSync(absolutePath, { withFileTypes: true });
    for await (let entry of entries) {
      let isDirectory = entry.isDirectory();
      let isFile = entry.isFile();
      if (!isDirectory && !isFile) {
        continue;
      }
      let { name } = entry;
      yield {
        name,
        path: join(path, name),
        kind: isDirectory ? 'directory' : 'file',
      };
    }
  }

  private watcher: Watcher | undefined = undefined;

  async subscribe(cb: (message: Record<string, any>) => void): Promise<void> {
    if (this.watcher) {
      throw new Error(`tried to subscribe to watcher twice`);
    }
    this.watcher = sane(join(this.realmDir, '/'));
    this.watcher.on('change', (path) => cb({ updated: path }));
    this.watcher.on('add', (path) => cb({ added: path }));
    this.watcher.on('delete', (path) => cb({ removed: path }));
    this.watcher.on('error', (err) => {
      throw new Error(`watcher error: ${err}`);
    });
    await new Promise<void>((resolve) => {
      this.watcher!.on('ready', resolve);
    });
  }

  unsubscribe(): void {
    this.watcher?.close();
    this.watcher = undefined;
  }

  async exists(path: string): Promise<boolean> {
    let absolutePath = join(this.realmDir, path);
    return existsSync(absolutePath);
  }

  async openFile(path: string): Promise<FileRef | undefined> {
    let absolutePath = join(this.realmDir, path);
    if (!existsSync(absolutePath)) {
      return undefined;
    }
    let stat = statSync(absolutePath);
    // Case-insensitive file systems need this check
    if (stat.isDirectory()) {
      return undefined;
    }
    let lazyStream: ReadStream;
    return {
      path,
      get content() {
        // making this lazy is important because it means that consumers who are
        // only interested in checking for the existence of the path and never
        // consume the content don't leave an unconsumed stream.
        if (!lazyStream) {
          lazyStream = createReadStream(absolutePath);
        }
        return lazyStream;
      },
      lastModified: stat.mtime.getTime(),
    };
  }

  async write(
    path: string,
    contents: string,
  ): Promise<{ lastModified: number }> {
    let absolutePath = join(this.realmDir, path);
    ensureFileSync(absolutePath);
    writeFileSync(absolutePath, contents);
    let { mtime } = statSync(absolutePath);
    return { lastModified: mtime.getTime() };
  }

  async remove(path: LocalPath): Promise<void> {
    let absolutePath = join(this.realmDir, path);
    removeSync(absolutePath);
  }

  createStreamingResponse(
    unresolvedRealmURL: string,
    request: Request,
    responseInit: ResponseInit,
    cleanup: () => void,
  ) {
    let s = new MessageStream();
    let response = createResponse(
      unresolvedRealmURL,
      null,
      responseInit,
    ) as ResponseWithNodeStream;
    response.nodeStream = s;
    onClose(request, cleanup);
    return { response, writable: s as unknown as WritableStream };
  }
}

export function onClose(request: Request, fn: () => void) {
  closeHandlers.get(request)!.on('close', fn);
}

const closeHandlers: WeakMap<Request, ServerResponse> = new WeakMap();
export function setupCloseHandler(res: ServerResponse, request: Request) {
  closeHandlers.set(request, res);
}

class MessageStream extends Duplex {
  private pendingWrite:
    | { chunk: string; callback: (err: null | Error) => void }
    | undefined;

  private pendingRead = false;

  _read() {
    if (this.pendingRead) {
      throw new Error(
        'bug: did not expect node to call read until after we push data from the prior read',
      );
    }
    if (this.pendingWrite) {
      let { chunk, callback } = this.pendingWrite;
      this.pendingWrite = undefined;
      this.push(chunk);
      callback(null);
    } else {
      this.pendingRead = true;
    }
  }

  _write(
    chunk: string,
    _encoding: string,
    callback: (err: null | Error) => void,
  ) {
    if (this.pendingWrite) {
      throw new Error(
        'bug: did not expect node to call write until after we call the callback',
      );
    }
    if (this.pendingRead) {
      this.pendingRead = false;
      this.push(chunk);
      callback(null);
    } else {
      this.pendingWrite = { chunk, callback };
    }
  }
}
