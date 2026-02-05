import type {
  RealmAdapter,
  Kind,
  FileRef,
  DBAdapter,
} from '@cardstack/runtime-common';
import {
  createResponse,
  logger,
  unixTime,
  type ResponseWithNodeStream,
  type TokenClaims,
  fetchAllSessionRooms,
} from '@cardstack/runtime-common';
import type { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import type { LocalPath } from '@cardstack/runtime-common/paths';
import type { ServerResponse } from 'http';
import sane, { type Watcher } from 'sane';

import type { ReadStream } from 'fs-extra';
import {
  readdirSync,
  existsSync,
  writeFileSync,
  statSync,
  ensureDirSync,
  ensureFileSync,
  createReadStream,
  removeSync,
} from 'fs-extra';
import { join } from 'path';
import { Duplex } from 'node:stream';
import type {
  RequestContext,
  AdapterWriteResult,
} from '@cardstack/runtime-common/realm';
import type {
  RealmEventContent,
  UpdateRealmEventContent,
} from 'https://cardstack.com/base/matrix-event';
import { APP_BOXEL_REALM_EVENT_TYPE } from '@cardstack/runtime-common/matrix-constants';
import { createJWT, verifyJWT } from './jwt';

const realmEventsLog = logger('realm:events');

export class NodeAdapter implements RealmAdapter {
  constructor(
    private realmDir: string,
    private enableFileWatcher?: boolean,
  ) {}

  get fileWatcherEnabled(): boolean {
    return this.enableFileWatcher ?? false;
  }

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

  async subscribe(
    cb: (message: UpdateRealmEventContent) => void,
  ): Promise<void> {
    if (this.watcher) {
      throw new Error(`tried to subscribe to watcher twice`);
    }

    if (this.enableFileWatcher) {
      realmEventsLog.debug(`Starting file watcher at ${this.realmDir}`);

      let watcherPath = join(this.realmDir, '/');

      this.watcher = sane(watcherPath);

      this.watcher.on('change', (path, _root, stat) => {
        if (stat.isFile()) {
          cb({
            eventName: 'update',
            updated: path,
          });
        }
      });
      this.watcher.on('add', (path, _root, stat) => {
        if (stat.isFile()) {
          cb({
            eventName: 'update',
            added: path,
          });
        }
      });
      this.watcher.on('delete', (path) =>
        cb({
          eventName: 'update',
          removed: path,
        }),
      );
      this.watcher.on('error', (err) => {
        throw new Error(`watcher error: ${err}`);
      });
      await new Promise<void>((resolve) => {
        this.watcher!.on('ready', () => {
          resolve();
        });
      });
    } else {
      realmEventsLog.debug(`Not starting file watcher at ${this.realmDir}`);
      return Promise.resolve();
    }
  }

  unsubscribe(): void {
    this.watcher?.close();
    this.watcher = undefined;
  }

  async exists(path: string): Promise<boolean> {
    let absolutePath = join(this.realmDir, path);
    return existsSync(absolutePath);
  }

  async lastModified(path: string): Promise<number | undefined> {
    let absolutePath = join(this.realmDir, path);
    if (!existsSync(absolutePath)) {
      return undefined;
    }
    let stat = statSync(absolutePath);
    // Case-insensitive file systems need this check
    if (stat.isDirectory()) {
      return undefined;
    }

    return unixTime(stat.mtime.getTime());
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
      lastModified: unixTime(stat.mtime.getTime()),
    };
  }

  async write(
    path: string,
    contents: string | Uint8Array,
  ): Promise<AdapterWriteResult> {
    let absolutePath = join(this.realmDir, path);
    ensureFileSync(absolutePath);
    writeFileSync(absolutePath, contents);
    let { mtime } = statSync(absolutePath);
    return {
      path: absolutePath,
      lastModified: unixTime(mtime.getTime()),
    };
  }

  async remove(path: LocalPath): Promise<void> {
    let absolutePath = join(this.realmDir, path);
    removeSync(absolutePath);
  }

  createStreamingResponse(
    request: Request,
    requestContext: RequestContext,
    responseInit: ResponseInit,
    cleanup: () => void,
  ) {
    let s = new MessageStream();
    let response = createResponse({
      body: null,
      init: responseInit,
      requestContext,
    }) as ResponseWithNodeStream;
    response.nodeStream = s;
    onClose(request, cleanup);
    return { response, writable: s as unknown as WritableStream };
  }

  createJWT(
    claims: TokenClaims,
    expiration: Parameters<typeof createJWT>[1],
    secret: string,
  ): string {
    return createJWT(claims, expiration, secret);
  }

  verifyJWT(
    token: string,
    secret: string,
  ): TokenClaims & { iat: number; exp: number } {
    // throws TokenExpiredError and JsonWebTokenError
    return verifyJWT(token, secret) as TokenClaims & {
      iat: number;
      exp: number;
    };
  }

  async broadcastRealmEvent(
    event: RealmEventContent,
    realmUrl: string,
    matrixClient: MatrixClient,
    dbAdapter: DBAdapter,
  ): Promise<void> {
    realmEventsLog.debug('Broadcasting realm event', event);

    if (dbAdapter.isClosed) {
      realmEventsLog.warn(
        `Database adapter is closed, skipping sending realm event`,
      );
      return;
    }
    try {
      await matrixClient.login();
    } catch (e) {
      realmEventsLog.error('Error logging into matrix. Skipping broadcast', e);
      return;
    }

    let dmRooms = await this.waitForSessionRooms(dbAdapter, realmUrl);

    realmEventsLog.debug('Sending to dm rooms', Object.values(dmRooms));

    for (let userId of Object.keys(dmRooms)) {
      let roomId = dmRooms[userId];
      try {
        await matrixClient.sendEvent(roomId, APP_BOXEL_REALM_EVENT_TYPE, event);
      } catch (e) {
        realmEventsLog.error(
          `Unable to send event in room ${roomId} for user ${userId}`,
          event,
          e,
        );
      }
    }
  }

  private async waitForSessionRooms(
    dbAdapter: DBAdapter,
    realmUrl: string,
    attempts = 3,
    delayMs = 50,
  ): Promise<Record<string, string>> {
    if (dbAdapter.isClosed) {
      return {};
    }

    let dmRooms: Record<string, string> = {};
    try {
      dmRooms = await fetchAllSessionRooms(dbAdapter, realmUrl);
    } catch (e) {
      realmEventsLog.error('Error getting account data', e);
      return {}; // bail immediately on errors instead of retrying
    }

    if (Object.keys(dmRooms).length) {
      return dmRooms;
    }

    if (attempts === 0) {
      return dmRooms;
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return await this.waitForSessionRooms(
      dbAdapter,
      realmUrl,
      attempts - 1,
      delayMs,
    );
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
