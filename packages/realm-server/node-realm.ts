import type {
  RealmAdapter,
  RealmEventDelivery,
  RealmEventStream,
  Kind,
  FileRef,
  DBAdapter,
  SplicedSource,
} from '@cardstack/runtime-common';
import { streamSpliced } from '@cardstack/runtime-common';
import {
  createResponse,
  logger,
  unixTime,
  type ResponseWithNodeStream,
  type TokenClaims,
  clearRealmEventRoom,
  clearSessionRoom,
  fetchRealmEventRoom,
  fetchRealmSessionRooms,
  isRealmServerNotInRoomError,
} from '@cardstack/runtime-common';
import type { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import {
  partialWritePath,
  type LocalPath,
} from '@cardstack/runtime-common/paths';
import type { ServerResponse } from 'http';
import { PassThrough } from 'stream';
import sane, { type Watcher } from 'sane';

import type { Dirent, Stats } from 'fs-extra';
import fsExtra from 'fs-extra';
const {
  existsSync,
  writeFileSync,
  appendFileSync,
  statSync,
  ensureDirSync,
  ensureFileSync,
  createReadStream,
  createWriteStream,
  renameSync,
  removeSync,
  openSync,
  fstatSync,
  closeSync,
} = fsExtra;
import { isAbsolute, join, relative, sep } from 'path';
import { Duplex, Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type {
  RequestContext,
  AdapterAppendResult,
  AdapterWriteResult,
} from '@cardstack/runtime-common/realm';
import type {
  FileWatcherEventContent,
  RealmEventContent,
} from '@cardstack/base/matrix-event';
import { APP_BOXEL_REALM_EVENT_TYPE } from '@cardstack/runtime-common/matrix-constants';
import { createJWT, verifyJWT } from './jwt.ts';
import {
  isBackPressure,
  realmEventDispatcher,
  type RealmEventDispatcher,
  type RealmEventSend,
} from './realm-event-dispatcher.ts';
import {
  ensureRealmEventRoom,
  retireRealmEventRoom,
  syncRealmEventRoom,
} from './realm-event-rooms.ts';

const realmEventsLog = logger('realm:events');

// A concurrent delete can remove a file between an existence check and the
// stat call, so treat a vanished file as nonexistent rather than letting the
// raw ENOENT escape. ENOTDIR is the same story via a different route: probing
// a path nested under a regular file (e.g. `some.txt/nested`) throws it, and
// such a path likewise just doesn't exist.
function statIfExists(absolutePath: string): Stats | undefined {
  try {
    return statSync(absolutePath);
  } catch (err: any) {
    if (err?.code === 'ENOENT' || err?.code === 'ENOTDIR') {
      return undefined;
    }
    throw err;
  }
}

// A file's modification time in whole seconds, floored from `mtimeMs`.
// `Stats.mtime` is a `Date` that Node rounds to the nearest millisecond, so
// flooring it puts an mtime in the last half-millisecond of a second into the
// next second — a second later than the one `mtimeMs` names, which is what an
// open descriptor's stat reports and what a `Last-Modified` formatted from it
// says. Every whole-second time this adapter reports comes from here, so a
// write's reported time, `lastModified`, and a read of the file agree.
function lastModifiedSeconds(stat: Stats): number {
  return unixTime(stat.mtimeMs);
}

export class NodeAdapter implements RealmAdapter {
  private realmDir: string;
  private enableFileWatcher?: boolean;
  private dispatcher: RealmEventDispatcher;
  // Set when the realm's last room lookup found no session rooms. The lookup
  // waits and retries only when this is clear, so a realm nobody has open
  // pays the wait once rather than on every queued event.
  private lastLookupFoundNoRooms = false;

  constructor(
    realmDir: string,
    enableFileWatcher?: boolean,
    dispatcher: RealmEventDispatcher = realmEventDispatcher(),
  ) {
    this.realmDir = realmDir;
    this.enableFileWatcher = enableFileWatcher;
    this.dispatcher = dispatcher;
  }

  get dir(): string {
    return this.realmDir;
  }

  // The file-system path of a realm-relative path. Every file operation goes
  // through here, so a path that resolves outside the realm directory is
  // refused whatever produced it.
  private pathInRealm(path: string): string {
    let absolutePath = join(this.realmDir, path);
    let fromRealm = relative(this.realmDir, absolutePath);
    if (
      fromRealm === '..' ||
      fromRealm.startsWith(`..${sep}`) ||
      isAbsolute(fromRealm)
    ) {
      let error = new Error(`${path} is outside the realm`);
      (error as any).status = 404;
      throw error;
    }
    return absolutePath;
  }

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
    let absolutePath = this.pathInRealm(path);
    // Asynchronous on purpose: on a network filesystem a listing is a round
    // trip, and this generator runs on the request path and in the
    // cross-instance directory refresh, neither of which may block the event
    // loop. A missing directory lists as empty.
    let entries: Dirent[];
    try {
      entries = await fsExtra.readdir(absolutePath, { withFileTypes: true });
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        return;
      }
      throw err;
    }
    for (let entry of entries) {
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
    cb: (message: FileWatcherEventContent) => void,
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
    let absolutePath = this.pathInRealm(path);
    return existsSync(absolutePath);
  }

  async lastModified(path: string): Promise<number | undefined> {
    let absolutePath = this.pathInRealm(path);
    let stat = statIfExists(absolutePath);
    // The directory check covers case-insensitive file systems
    if (!stat || stat.isDirectory()) {
      return undefined;
    }

    return lastModifiedSeconds(stat);
  }

  async openFile(path: string): Promise<FileRef | undefined> {
    let absolutePath = this.pathInRealm(path);
    let stat = statIfExists(absolutePath);
    // The directory check covers case-insensitive file systems
    if (!stat || stat.isDirectory()) {
      return undefined;
    }
    // Opening is lazy because a consumer that only checks for the path, or
    // reads its metadata, must not be left holding an unconsumed stream.
    //
    // `size` above comes from a path stat, and on a network filesystem a path
    // stat can be answered from the client's attribute cache: when another
    // host has just rewritten the file, it reports the length the file had
    // before. Opening the file revalidates its attributes (close-to-open
    // consistency), so the length is taken from the open descriptor and the
    // stream reads from that same descriptor. That is the length a response
    // can declare for this body: it describes the bytes the stream delivers,
    // where the path stat's length may not. The stream stops at that length,
    // so content an append adds while it is being read is left for the next
    // read rather than sent past the length this one declared.
    let opened:
      | { content: Readable; size?: number; lastModifiedMs?: number }
      | undefined;
    let open = () => {
      if (!opened) {
        let fd: number | undefined;
        try {
          fd = openSync(absolutePath, 'r');
          let { size, mtimeMs: lastModifiedMs } = fstatSync(fd);
          if (size === 0) {
            closeSync(fd);
            opened = { content: Readable.from([]), size, lastModifiedMs };
          } else {
            opened = {
              content: createReadStream(absolutePath, {
                fd,
                start: 0,
                end: size - 1,
              }),
              size,
              lastModifiedMs,
            };
          }
        } catch (_err) {
          if (fd !== undefined) {
            closeSync(fd);
          }
          // A file deleted since the stat above surfaces as the stream's own
          // error when it is read, which is where consumers already handle a
          // vanished file. No length is claimed for it.
          opened = { content: createReadStream(absolutePath) };
        }
      }
      return opened;
    };
    return {
      path,
      get content() {
        return open().content;
      },
      openContent: open,
      lastModified: lastModifiedSeconds(stat),
      lastModifiedMs: stat.mtimeMs,
      size: stat.size,
      createRangeStream: (start: number, end: number) =>
        createReadStream(absolutePath, { start, end }),
    };
  }

  async write(
    path: string,
    contents: string | Uint8Array,
  ): Promise<AdapterWriteResult> {
    // Written beside the file and renamed onto it, which is atomic, so the
    // file never holds a half-written version: a read that saw part of a
    // rewrite would come up shorter than the length its response declared. A
    // reader on this host that already has the file open keeps reading the
    // version it opened. A reader on another host of a network filesystem may
    // instead see its read fail once the file is replaced; that read errors
    // rather than coming up short, and the response it was feeding is torn
    // down so the client can ask again. The staging name is one the realm
    // treats as no part of itself, and the per-file write locks the realm
    // takes keep two writers of one path from sharing it.
    let absolutePath = this.pathInRealm(path);
    let stagedPath = this.pathInRealm(partialWritePath(path as LocalPath));
    try {
      ensureFileSync(stagedPath);
      writeFileSync(stagedPath, contents);
      renameSync(stagedPath, absolutePath);
    } finally {
      removeSync(stagedPath);
    }
    return {
      path: absolutePath,
      lastModified: lastModifiedSeconds(statSync(absolutePath)),
    };
  }

  // Opened in append mode, so the file system positions the write at the end
  // of the file and nothing here reads or rewrites what is already stored
  // there — which is what keeps the cost the added content's rather than the
  // file's, and what makes the write safe to hand a path holding hundreds of
  // megabytes.
  //
  // The length comes from the stat the modification time already needs, so it
  // costs nothing beyond it and describes the same state.
  async append(
    path: LocalPath,
    contents: string | Uint8Array,
  ): Promise<AdapterAppendResult> {
    let absolutePath = this.pathInRealm(path);
    ensureFileSync(absolutePath);
    appendFileSync(absolutePath, contents);
    let stat = statSync(absolutePath);
    return {
      path: absolutePath,
      lastModified: lastModifiedSeconds(stat),
      size: stat.size,
    };
  }

  // The described content's ranges name the very file being replaced, so it
  // cannot be written straight over: the read would be reading what the write
  // had already truncated. It is assembled beside the file and renamed onto
  // it, which is atomic, so the file only ever holds the content it had or the
  // content it now has — and the staging name is one the realm treats as no
  // part of itself, so a half-written file is never indexed or served.
  async writeSpliced(
    path: LocalPath,
    content: SplicedSource,
  ): Promise<AdapterWriteResult> {
    let absolutePath = this.pathInRealm(path);
    let stagedPath = this.pathInRealm(partialWritePath(path));
    try {
      ensureFileSync(stagedPath);
      await pipeline(
        streamSpliced(content, (start, end) =>
          // `end` is exclusive here and inclusive for a read stream.
          createReadStream(absolutePath, { start, end: end - 1 }),
        ),
        createWriteStream(stagedPath),
      );
      renameSync(stagedPath, absolutePath);
    } finally {
      removeSync(stagedPath);
    }
    return {
      path: absolutePath,
      lastModified: lastModifiedSeconds(statSync(absolutePath)),
    };
  }

  async *readRange(
    path: LocalPath,
    start: number,
    end: number,
  ): AsyncIterable<Uint8Array> {
    if (end <= start) {
      return;
    }
    // `end` is exclusive here and inclusive for a read stream.
    for await (let chunk of createReadStream(this.pathInRealm(path), {
      start,
      end: end - 1,
    })) {
      yield chunk as Uint8Array;
    }
  }

  async remove(path: LocalPath): Promise<void> {
    let absolutePath = this.pathInRealm(path);
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

  // A long-lived response body for the realm's public change feed (ADR 020).
  // Koa pipes it to the client and destroys it when the client goes away,
  // which is when the realm stops writing to it.
  openEventStream(): RealmEventStream {
    let stream = new PassThrough();
    let closed = false;
    let callbacks: (() => void)[] = [];
    let close = () => {
      if (closed) {
        return;
      }
      closed = true;
      for (let callback of callbacks) {
        callback();
      }
    };
    stream.on('close', close);
    stream.on('error', close);
    return {
      stream,
      write(text: string) {
        if (!closed && !stream.writableEnded) {
          stream.write(text);
        }
      },
      onClose(callback: () => void) {
        if (closed) {
          callback();
        } else {
          callbacks.push(callback);
        }
      },
    };
  }

  // Resolves once the event has reached every room it goes to (see
  // `prepareRoomSends`), or has been merged or dropped by the process's realm
  // event line (see realm-event-dispatcher.ts). Never rejects: a failed send
  // is logged.
  async broadcastRealmEvent(
    event: RealmEventContent,
    realmUrl: string,
    matrixClient: MatrixClient,
    dbAdapter: DBAdapter,
    opts?: RealmEventDelivery,
  ): Promise<void> {
    realmEventsLog.debug('Broadcasting realm event', event);
    const eventWithRealmURL: RealmEventContent = {
      ...event,
      realmURL: realmUrl,
    };
    if (dbAdapter.isClosed) {
      realmEventsLog.warn(
        `Database adapter is closed, skipping sending realm event`,
      );
      return;
    }
    await this.dispatcher.broadcast({
      realmURL: realmUrl,
      event: eventWithRealmURL,
      newTxnId: () => matrixClient.nextTxnId(),
      prepare: (content) =>
        this.prepareRoomSends(content, realmUrl, matrixClient, dbAdapter, opts),
    });
  }

  async ensureRealmEventRoom(
    realmUrl: string,
    matrixClient: MatrixClient,
    dbAdapter: DBAdapter,
    member: string,
  ): Promise<string | undefined> {
    return await ensureRealmEventRoom(
      {
        realmURL: realmUrl,
        matrixClient,
        dbAdapter,
        dispatcher: this.dispatcher,
      },
      member,
    );
  }

  async syncRealmEventRoom(
    realmUrl: string,
    matrixClient: MatrixClient,
    dbAdapter: DBAdapter,
  ): Promise<void> {
    await syncRealmEventRoom({
      realmURL: realmUrl,
      matrixClient,
      dbAdapter,
      dispatcher: this.dispatcher,
    });
  }

  async retireRealmEventRoom(
    realmUrl: string,
    matrixClient: MatrixClient,
    dbAdapter: DBAdapter,
  ): Promise<void> {
    await retireRealmEventRoom({
      realmURL: realmUrl,
      matrixClient,
      dbAdapter,
      dispatcher: this.dispatcher,
    });
  }

  private async prepareRoomSends(
    event: RealmEventContent,
    realmUrl: string,
    matrixClient: MatrixClient,
    dbAdapter: DBAdapter,
    delivery?: RealmEventDelivery,
  ): Promise<RealmEventSend[]> {
    if (dbAdapter.isClosed) {
      return [];
    }
    // A logged-in client reuses its session; this logs in only on the first
    // broadcast, or after the session was revoked.
    try {
      await matrixClient.login();
      if (!matrixClient.getUserId()) {
        realmEventsLog.error(
          'Matrix client has no user ID after login, unable to broadcast realm event',
          event,
        );
        return [];
      }
    } catch (e) {
      // An overloaded or unreachable homeserver is back-pressure: the
      // dispatcher pauses and prepares the event again rather than skip it.
      if (isBackPressure(e)) {
        throw e;
      }
      realmEventsLog.error('Error logging into matrix. Skipping broadcast', e);
      return [];
    }

    // A private realm's event goes once into the realm's own room, whose
    // members are the users its grants name (see realm-event-rooms.ts). An
    // event meant only for some of them, a world-readable realm's event, and
    // a private realm's event before any host has asked for its room go to
    // session rooms instead.
    if (!delivery?.recipients) {
      let realmEventRoom;
      try {
        realmEventRoom = await fetchRealmEventRoom(dbAdapter, realmUrl);
      } catch (e) {
        realmEventsLog.error('Error looking up the realm event room', e);
        return [];
      }
      if (realmEventRoom.isPrivate && realmEventRoom.roomId) {
        return [
          this.realmEventRoomSend(
            event,
            realmUrl,
            realmEventRoom.roomId,
            matrixClient,
            dbAdapter,
          ),
        ];
      }
    }

    let dmRooms = await this.waitForSessionRooms(
      dbAdapter,
      realmUrl,
      this.lastLookupFoundNoRooms ? 0 : undefined,
    );
    this.lastLookupFoundNoRooms = Object.keys(dmRooms).length === 0;
    if (delivery?.recipients) {
      let recipients = new Set(delivery.recipients);
      dmRooms = Object.fromEntries(
        Object.entries(dmRooms).filter(([userId]) => recipients.has(userId)),
      );
    }

    realmEventsLog.debug('Sending to dm rooms', Object.values(dmRooms));

    return Object.entries(dmRooms).map(([userId, roomId]) => ({
      roomId,
      send: async (txnId: string) => {
        // A send can start while a revoked session is being replaced, when
        // the client holds no token; wait for the new one rather than fail.
        if (!matrixClient.isLoggedIn()) {
          await matrixClient.login();
        }
        await matrixClient.sendEvent(
          roomId,
          APP_BOXEL_REALM_EVENT_TYPE,
          event,
          txnId,
        );
      },
      onFailure: async (e: unknown) => {
        if (isRealmServerNotInRoomError(e, roomId)) {
          try {
            let cleared = await clearSessionRoom(dbAdapter, userId, roomId);
            realmEventsLog.warn(
              `Skipping stale session room ${roomId} for user ${userId}; realm server is no longer in the room`,
              { cleared, realmUrl },
            );
          } catch (cleanupError) {
            realmEventsLog.error(
              `Failed to clear stale session room ${roomId} for user ${userId}`,
              cleanupError,
            );
            realmEventsLog.error(
              `Unable to send event in room ${roomId} for user ${userId}`,
              event,
              e,
            );
          }
          return;
        }
        // The error's message carries the status and the homeserver's answer,
        // which is all a failed send has to say; its stack is the same for
        // every room.
        realmEventsLog.error(
          `Unable to send event in room ${roomId} for user ${userId}: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      },
    }));
  }

  private realmEventRoomSend(
    event: RealmEventContent,
    realmUrl: string,
    roomId: string,
    matrixClient: MatrixClient,
    dbAdapter: DBAdapter,
  ): RealmEventSend {
    return {
      roomId,
      send: async (txnId: string) => {
        if (!matrixClient.isLoggedIn()) {
          await matrixClient.login();
        }
        await matrixClient.sendEvent(
          roomId,
          APP_BOXEL_REALM_EVENT_TYPE,
          event,
          txnId,
        );
      },
      onFailure: async (e: unknown) => {
        // A stored room the server user is no longer in, as after a
        // homeserver reset, is forgotten: the realm's events go to session
        // rooms until a host asks for the realm's room and gets a new one.
        if (isRealmServerNotInRoomError(e, roomId)) {
          try {
            let cleared = await clearRealmEventRoom(
              dbAdapter,
              realmUrl,
              roomId,
            );
            realmEventsLog.warn(
              `Forgetting realm event room ${roomId} of ${realmUrl}; realm server is no longer in the room`,
              { cleared },
            );
            return;
          } catch (cleanupError) {
            realmEventsLog.error(
              `Failed to forget realm event room ${roomId} of ${realmUrl}`,
              cleanupError,
            );
          }
        }
        realmEventsLog.error(
          `Unable to send event in realm event room ${roomId} for ${realmUrl}: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      },
    };
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
      dmRooms = await fetchRealmSessionRooms(dbAdapter, realmUrl);
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
