import {
  RealmAdapter,
  Kind,
  FileRef,
  createResponse,
  logger,
  unixTime,
  type ResponseWithNodeStream,
  type TokenClaims,
} from '@cardstack/runtime-common';
import { type MatrixClient } from '@cardstack/runtime-common/matrix-client';
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
import type {
  RequestContext,
  UpdateEventData,
} from '@cardstack/runtime-common/realm';
import jwt from 'jsonwebtoken';
import type { RealmEventContent } from 'https://cardstack.com/base/matrix-event';
import { APP_BOXEL_REALM_EVENT_TYPE } from '@cardstack/runtime-common/matrix-constants';

const realmEventsLog = logger('realm:events');

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

  async subscribe(
    cb: (message: UpdateEventData) => void,
    options: { watcher?: string },
  ): Promise<void> {
    if (this.watcher) {
      throw new Error(`tried to subscribe to watcher twice`);
    }

    // TODO remove with CS-8014
    let watcherOptions = options.watcher ? { [options.watcher]: true } : {};

    this.watcher = sane(join(this.realmDir, '/'), watcherOptions);
    this.watcher.on('change', (path, _root, stat) => {
      if (stat.isFile()) {
        cb({ updated: path });
      }
    });
    this.watcher.on('add', (path, _root, stat) => {
      if (stat.isFile()) {
        cb({ added: path });
      }
    });
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
      created: unixTime(stat.birthtime.getTime()),
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
    return { lastModified: unixTime(mtime.getTime()) };
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

  createJWT(claims: TokenClaims, expiration: string, secret: string): string {
    let token = jwt.sign(claims, secret, { expiresIn: expiration });
    return token;
  }

  verifyJWT(
    token: string,
    secret: string,
  ): TokenClaims & { iat: number; exp: number } {
    // throws TokenExpiredError and JsonWebTokenError
    return jwt.verify(token, secret) as TokenClaims & {
      iat: number;
      exp: number;
    };
  }

  async broadcastRealmEvent(
    event: RealmEventContent,
    matrixClient: MatrixClient,
  ): Promise<void> {
    realmEventsLog.debug('Broadcasting realm event', event);

    if (!matrixClient.isLoggedIn()) {
      realmEventsLog.debug(
        `Not logged in (${matrixClient.username}, skipping server event`,
      );
      return;
    }

    let dmRooms;

    try {
      dmRooms =
        (await matrixClient.getAccountData<Record<string, string>>(
          'boxel.session-rooms',
        )) ?? {};
    } catch (e) {
      realmEventsLog.error('Error getting account data', e);
      return;
    }

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
