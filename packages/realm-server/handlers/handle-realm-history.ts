import type Koa from 'koa';
import type { DBAdapter, Realm } from '@cardstack/runtime-common';
import {
  fetchRealmPermissions,
  logger,
  SupportedMimeType,
} from '@cardstack/runtime-common';
import { AuthenticationError } from '@cardstack/runtime-common/router';
import {
  fetchRequestFromContext,
  sendResponseForBadRequest,
  sendResponseForForbiddenRequest,
  sendResponseForNotFound,
  sendResponseForUnauthorizedRequest,
  setContextResponse,
} from '../middleware/index.ts';
import { findOrMountRealm } from '../lib/realm-routing.ts';
import type { RealmRegistryReconciler } from '../lib/realm-registry-reconciler.ts';
import { retrieveTokenClaim } from '../utils/jwt.ts';
import {
  getRealmHistoryManager,
  isRealmHistoryEnabled,
  isValidHistoryPath,
  isValidRevisionId,
} from '../lib/realm-history.ts';

const log = logger('realm-server:history');

// BPM Phase 0R spike: realm-scoped history endpoints backed by the jj
// sidecar. Mounted as plain middleware between the server routes and the
// serve-from-realm fallthrough, so `<realm>/_history` is intercepted here
// while every other realm path flows through untouched. When the
// ENABLE_REALM_HISTORY flag is off this middleware defers immediately and
// the realm's own router produces its normal 404.
//
//   GET  <realm>/_history                      → sealed changes, newest first
//   GET  <realm>/_history/<changeId>/<path>    → file content at that change
//   POST <realm>/_history/restore              → { changeId, paths? }
//
// Restore never mutates disk directly: the plan is replayed through
// realm.writeMany/deleteAll so invalidation, incremental indexing, and live
// events fire exactly as user writes do, and the replay seals as a NEW
// change (see the restore-through-write-path decision). The response carries
// the fresh changeId.

const HISTORY_PATH = /^(?<prefix>.*)\/_history(?:\/(?<rest>.+))?$/;

const CONTENT_TYPES: { [extension: string]: string } = {
  '.json': 'application/json',
  '.gts': 'text/plain; charset=utf-8',
  '.ts': 'text/plain; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

export type HandleRealmHistoryDeps = {
  realms: Realm[];
  reconciler: RealmRegistryReconciler;
  dbAdapter: DBAdapter;
  realmSecretSeed: string;
  enabled?: boolean;
};

export default function handleRealmHistory(
  deps: HandleRealmHistoryDeps,
): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, next: Koa.Next) {
    let enabled = deps.enabled ?? isRealmHistoryEnabled();
    if (!enabled) {
      return next();
    }
    let match = ctxt.path.match(HISTORY_PATH);
    if (!match?.groups) {
      return next();
    }
    let { prefix, rest } = match.groups as { prefix: string; rest?: string };

    let requestURL = new URL(
      `${ctxt.protocol}://${ctxt.host}${ctxt.originalUrl}`,
    );
    let realm: Realm | undefined;
    try {
      realm = await findOrMountRealm(requestURL, deps);
    } catch (err: any) {
      log.warn(
        `failed to mount realm for history request ${requestURL.href}: ${err?.message ?? err}`,
      );
      ctxt.status = 503;
      ctxt.body = `Realm mount failed: ${err?.message ?? err}`;
      return;
    }
    // _history must sit directly under the realm root — a deeper path is a
    // realm file request that happens to contain the segment, not ours.
    if (!realm || new URL(realm.url).pathname !== `${prefix}/`) {
      return next();
    }
    let dir = realm.dir;
    if (!dir) {
      await sendResponseForNotFound(
        ctxt,
        `realm ${realm.url} has no local directory; history is unavailable`,
      );
      return;
    }

    let neededPermission: 'read' | 'write' =
      ctxt.method === 'GET' ? 'read' : 'write';
    try {
      if (!(await isAuthorized(ctxt, realm, deps, neededPermission))) {
        await sendResponseForForbiddenRequest(
          ctxt,
          `${neededPermission} permission on ${realm.url} is required`,
        );
        return;
      }
    } catch (e) {
      if (e instanceof AuthenticationError) {
        await sendResponseForUnauthorizedRequest(ctxt, e.message);
        return;
      }
      throw e;
    }

    let manager = getRealmHistoryManager();
    if (ctxt.method === 'GET' && !rest) {
      let history = await manager.list(dir);
      await respondJSON(ctxt, {
        data: {
          type: 'realm-history',
          id: realm.url,
          attributes: { history },
        },
      });
      return;
    }

    if (ctxt.method === 'GET' && rest) {
      let [changeId, ...pathSegments] = rest.split('/');
      let filePath = decodeURIComponent(pathSegments.join('/'));
      if (!isValidRevisionId(changeId) || !isValidHistoryPath(filePath)) {
        await sendResponseForBadRequest(
          ctxt,
          `expected _history/<changeId>/<file path>`,
        );
        return;
      }
      let content = await manager.fileAt(dir, changeId, filePath);
      if (content === undefined) {
        await sendResponseForNotFound(
          ctxt,
          `${filePath} does not exist at change ${changeId}`,
        );
        return;
      }
      let extension = filePath.slice(filePath.lastIndexOf('.'));
      await setContextResponse(
        ctxt,
        new Response(new Uint8Array(content), {
          headers: {
            'content-type':
              CONTENT_TYPES[extension] ?? 'application/octet-stream',
            'x-boxel-realm-history-change': changeId,
          },
        }),
      );
      return;
    }

    // A save operation that tags its own audit-log entry: optionally write
    // (and/or delete) files through the realm's own write path — same
    // invalidation/indexing/SSE guarantee `_history/restore` leans on — then
    // seal with a caller-supplied message and actor instead of the debounced
    // write-sealer's generic "save: <paths>". Message-only calls (no writes/
    // deletes) just re-describe whatever the normal card-write endpoints
    // left dirty, for a "save now, tag after" workflow.
    if (ctxt.method === 'POST' && rest === 'commit') {
      let request = await fetchRequestFromContext(ctxt);
      let body: {
        message?: string;
        actor?: { name?: string; email?: string };
        writes?: Record<string, string>;
        deletes?: string[];
      };
      try {
        body = await request.json();
      } catch {
        await sendResponseForBadRequest(ctxt, `request body must be JSON`);
        return;
      }
      let { message, actor, writes, deletes } = body;
      if (!message || typeof message !== 'string') {
        await sendResponseForBadRequest(
          ctxt,
          `body must include a non-empty "message"`,
        );
        return;
      }
      if (actor !== undefined && !actor.name) {
        await sendResponseForBadRequest(
          ctxt,
          `"actor", when present, must include a "name"`,
        );
        return;
      }
      let writePaths = writes ? Object.keys(writes) : [];
      let deletePaths = deletes ?? [];
      if (
        !writePaths.every(isValidHistoryPath) ||
        (deletes !== undefined &&
          (!Array.isArray(deletes) || !deletes.every(isValidHistoryPath)))
      ) {
        await sendResponseForBadRequest(
          ctxt,
          `"writes" keys and "deletes" entries must be realm-local file paths`,
        );
        return;
      }

      let actorForSeal = actor?.name
        ? { name: actor.name, email: actor.email }
        : undefined;
      // jj fixes a commit's author at creation time, not at describe time —
      // so the actor has to land BEFORE these writes are snapshotted, not
      // just on the seal call that describes them afterward. Backends
      // without this primitive (jj-lib today) silently keep default
      // attribution; that gap is documented on the interface.
      if (actorForSeal && manager.prepareActorCommit) {
        await manager.prepareActorCommit(dir, actorForSeal);
      }
      if (writePaths.length > 0) {
        await realm.writeMany(new Map(writePaths.map((p) => [p, writes![p]])));
      }
      if (deletePaths.length > 0) {
        await realm.deleteAll(deletePaths);
      }

      let newChangeId = await manager.seal(dir, message, actorForSeal);
      if (newChangeId === undefined) {
        // Nothing was dirty (no writes/deletes given, and nothing pending
        // from an earlier normal-API write) — report the current head
        // rather than a confusing null.
        let history = await manager.list(dir);
        await respondJSON(ctxt, {
          data: {
            type: 'realm-history-commit',
            attributes: {
              message,
              changeId: history[0]?.changeId ?? null,
              sealed: false,
              wrote: [],
              removed: [],
            },
          },
        });
        return;
      }
      log.info(
        `committed ${realm.url} as ${newChangeId} (wrote ${writePaths.length}, removed ${deletePaths.length}): ${message}`,
      );
      await respondJSON(ctxt, {
        data: {
          type: 'realm-history-commit',
          attributes: {
            message,
            changeId: newChangeId,
            sealed: true,
            wrote: writePaths,
            removed: deletePaths,
          },
        },
      });
      return;
    }

    if (ctxt.method === 'POST' && rest === 'restore') {
      let request = await fetchRequestFromContext(ctxt);
      let body: { changeId?: string; paths?: string[] };
      try {
        body = await request.json();
      } catch {
        await sendResponseForBadRequest(ctxt, `request body must be JSON`);
        return;
      }
      let { changeId, paths } = body;
      if (!changeId || !isValidRevisionId(changeId)) {
        await sendResponseForBadRequest(
          ctxt,
          `body must include a valid changeId`,
        );
        return;
      }
      if (
        paths !== undefined &&
        (!Array.isArray(paths) || !paths.every(isValidHistoryPath))
      ) {
        await sendResponseForBadRequest(
          ctxt,
          `paths must be an array of realm-local file paths`,
        );
        return;
      }
      let plan;
      try {
        plan = await manager.restorePlan(dir, changeId);
      } catch (e: any) {
        if (/doesn't exist/i.test(e.stderr ?? e.message ?? '')) {
          await sendResponseForNotFound(ctxt, `unknown change ${changeId}`);
          return;
        }
        throw e;
      }
      let pathFilter = paths ? new Set(paths) : undefined;
      let writePaths = plan.writes.filter(
        (p) => !pathFilter || pathFilter.has(p),
      );
      let deletePaths = plan.deletes.filter(
        (p) => !pathFilter || pathFilter.has(p),
      );

      if (writePaths.length === 0 && deletePaths.length === 0) {
        let history = await manager.list(dir);
        await respondJSON(ctxt, {
          data: {
            type: 'realm-history-restore',
            attributes: {
              restoredFrom: changeId,
              changeId: history[0]?.changeId ?? null,
              wrote: [],
              removed: [],
            },
          },
        });
        return;
      }

      let files = new Map<string, Uint8Array>();
      for (let path of writePaths) {
        let content = await manager.fileAt(dir, changeId, path);
        if (content === undefined) {
          throw new Error(
            `bug: restore plan wants ${path} but it does not exist at ${changeId}`,
          );
        }
        files.set(path, new Uint8Array(content));
      }
      // Replay through the realm's public write path: advisory lock,
      // invalidation, incremental indexing, and SSE all behave as if a user
      // made these edits. Writes land before deletes so a rename never has a
      // window where both names are missing.
      if (files.size > 0) {
        await realm.writeMany(files);
      }
      if (deletePaths.length > 0) {
        await realm.deleteAll(deletePaths);
      }
      let newChangeId = await manager.seal(dir, `restore from ${changeId}`);
      log.info(
        `restored ${realm.url} from ${changeId} (wrote ${writePaths.length}, removed ${deletePaths.length}) as ${newChangeId}`,
      );
      await respondJSON(ctxt, {
        data: {
          type: 'realm-history-restore',
          attributes: {
            restoredFrom: changeId,
            changeId: newChangeId ?? null,
            wrote: writePaths,
            removed: deletePaths,
          },
        },
      });
      return;
    }

    await sendResponseForBadRequest(
      ctxt,
      `unsupported _history request: ${ctxt.method} ${ctxt.path}`,
    );
  };
}

async function isAuthorized(
  ctxt: Koa.Context,
  realm: Realm,
  deps: HandleRealmHistoryDeps,
  needed: 'read' | 'write',
): Promise<boolean> {
  let permissions = await fetchRealmPermissions(
    deps.dbAdapter,
    new URL(realm.url),
  );
  let users = ['*'];
  let authorization = ctxt.req.headers['authorization'];
  if (authorization) {
    // Both realm session tokens and realm-server session tokens are signed
    // from the same secret seed and carry `user`; the DB permission rows are
    // the source of truth either way.
    let claims = retrieveTokenClaim(authorization, deps.realmSecretSeed);
    users.push(claims.user);
  }
  return users.some((user) => {
    let userPermissions = permissions[user];
    return (
      userPermissions?.includes(needed) ||
      userPermissions?.includes('realm-owner')
    );
  });
}

async function respondJSON(ctxt: Koa.Context, body: unknown): Promise<void> {
  await setContextResponse(
    ctxt,
    new Response(JSON.stringify(body, null, 2), {
      headers: { 'content-type': SupportedMimeType.JSON },
    }),
  );
}
