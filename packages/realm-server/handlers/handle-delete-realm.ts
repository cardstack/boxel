import type Koa from 'koa';
import type { DBAdapter } from '@cardstack/runtime-common';
import type { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import {
  asExpressions,
  logger,
  dbAdapterQuerier,
  fetchRealmPermissions,
  isRealmAdministrator,
  namedRealmUsers,
  notifyAllFileChanges,
  param,
  PUBLISHED_DIRECTORY_NAME,
  query,
  removeRealmPermissions,
  SupportedMimeType,
  update,
} from '@cardstack/runtime-common';
import { join } from 'path';
import * as Sentry from '@sentry/node';
import {
  fetchRequestFromContext,
  sendResponseForBadRequest,
  sendResponseForError,
  sendResponseForForbiddenRequest,
  sendResponseForNotFound,
  sendResponseForSystemError,
  sendResponseForUnprocessableEntity,
  setContextResponse,
  requestUser,
  isOAuthRequest,
} from '../middleware/index.ts';
import { notifyRealmsListUpdated } from './archive-realm-utils.ts';
import type { CreateRoutesArgs } from '../routes.ts';
import {
  removeRealmDatabaseArtifacts,
  removeRealmFiles,
} from './realm-destruction-utils.ts';
import {
  deletePublishedRowsBySourceUrl,
  deleteRegistryRowByUrl,
} from '../lib/realm-registry-writes.ts';
import { normalizeRealmURL } from '../utils/realm-url.ts';
import { realmEventDispatcher } from '../realm-event-dispatcher.ts';
import { retireRealmEventRoom } from '../realm-event-rooms.ts';
import {
  announceHostURLChanges,
  deleteRealmHostURLs,
  type HostURLResolver,
} from '../lib/realm-host-urls.ts';
import {
  addToWorkspaceList,
  removeFromWorkspaceList,
  WorkspaceListEditError,
} from '../lib/workspace-list.ts';

const log = logger('realm-server');

interface DeleteRealmJSON {
  data: {
    type: 'realm';
    id: string;
  };
}

export default function handleDeleteRealm(
  args: CreateRoutesArgs,
): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  let { dbAdapter, matrixClient, sendEvent, serverURL } = args;
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    let user = requestUser(ctxt);
    if (!user) {
      await sendResponseForSystemError(
        ctxt,
        'token is required to delete realm',
      );
      return;
    }

    let request = await fetchRequestFromContext(ctxt);
    let body = await request.text();
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(body);
    } catch (_error) {
      await sendResponseForBadRequest(
        ctxt,
        'Request body is not valid JSON-API - invalid JSON',
      );
      return;
    }

    try {
      assertIsDeleteRealmJSON(json);
    } catch (error: any) {
      await sendResponseForBadRequest(
        ctxt,
        `Request body is not valid JSON-API - ${error.message}`,
      );
      return;
    }

    let parsedRealmURL = normalizeRealmURL(json.data.id);
    if (!parsedRealmURL) {
      await sendResponseForBadRequest(
        ctxt,
        `Invalid realm URL supplied: ${json.data.id}`,
      );
      return;
    }
    let realmURL = parsedRealmURL.href;

    try {
      // Phase 3 PR 2: source-realm existence and disk location come from
      // realm_registry, not from realms[]. The handler is stateless — it
      // doesn't read or mutate realms[]/virtualNetwork. The reconciler
      // does the unmount on every instance after the registry DELETE +
      // NOTIFY.
      let sourceRow = (await query(dbAdapter, [
        `SELECT id, disk_id, kind FROM realm_registry WHERE url =`,
        param(realmURL),
      ])) as { id: string; disk_id: string; kind: string }[];
      if (sourceRow.length === 0) {
        await sendResponseForNotFound(ctxt, `Realm not found: ${realmURL}`);
        return;
      }
      // Only a source realm is deleted here. A published realm is removed by
      // unpublishing it, and a bootstrap realm (base, catalog, skills and the
      // like) is the platform's, whatever writes its permissions grant.
      if (sourceRow[0].kind === 'bootstrap') {
        await sendResponseForUnprocessableEntity(
          ctxt,
          `Realm ${realmURL} is a bootstrap realm and cannot be deleted`,
        );
        return;
      }

      // SELECT 1 is aliased to AS found rather than relying on Postgres's
      // default `?column?` unnamed-column label, which isn't portable
      // across SQL adapters.
      let publishedRealmMatch = (await query(dbAdapter, [
        `SELECT 1 AS found FROM realm_registry WHERE kind = 'published' AND url =`,
        param(realmURL),
      ])) as { found: number }[];
      if (publishedRealmMatch.length > 0) {
        await sendResponseForUnprocessableEntity(
          ctxt,
          'Published realms cannot be deleted directly',
        );
        return;
      }

      let permissions = await fetchRealmPermissions(dbAdapter, parsedRealmURL);
      let ownerUserId = user;
      if (
        !isRealmAdministrator(
          permissions,
          ownerUserId,
          matrixClient.serverName,
          parsedRealmURL,
          new URL(serverURL),
        )
      ) {
        await sendResponseForForbiddenRequest(
          ctxt,
          `${ownerUserId} does not have enough permission to delete this realm`,
        );
        return;
      }

      // For a caller with an OAuth token the realm leaves the workspace list
      // here, so that the delete and the list edit succeed or fail together.
      // The list edit comes first, since the delete can't be undone and the
      // list edit can: a list that can't be edited deletes nothing, and a
      // delete that fails puts the realm back on the list it was on. A caller
      // with a session token edits the list itself after the delete, as the
      // app and every boxel-cli signed in to Matrix do, and would report a
      // realm it found already gone as a failure.
      let putBack = async () => {
        try {
          await addToWorkspaceList(args, ownerUserId, realmURL);
        } catch (restoreError: any) {
          log.error(
            `${realmURL} was not deleted, and could not be put back on ${ownerUserId}'s workspace list: ${restoreError?.message ?? restoreError}`,
          );
          Sentry.captureException(restoreError);
        }
      };
      let listEdit = { changed: false };
      try {
        if (isOAuthRequest(ctxt)) {
          listEdit = await removeFromWorkspaceList(args, ownerUserId, realmURL);
        }
      } catch (error: any) {
        log.error(
          `could not remove ${realmURL} from ${ownerUserId}'s workspace list, so it was not deleted: ${error?.message ?? error}`,
        );
        Sentry.captureException(error);
        // The removal may have reached the list before Matrix stopped
        // answering, and the realm stays, so it goes back on the list.
        if (error instanceof WorkspaceListEditError && error.mayHaveChanged) {
          await putBack();
        }
        await sendResponseForError(
          ctxt,
          503,
          'Service Unavailable',
          'The workspace was not deleted, because your workspace list could not be updated. Try again.',
        );
        return;
      }

      try {
        await deleteSourceRealm(args, {
          realmURL,
          registryId: sourceRow[0].id,
          diskId: sourceRow[0].disk_id,
        });
      } catch (error) {
        if (listEdit.changed) {
          await putBack();
        }
        throw error;
      }

      await setContextResponse(
        ctxt,
        new Response(null, {
          status: 204,
          headers: {
            'content-type': SupportedMimeType.JSONAPI,
          },
        }),
      );

      // Tell everyone the realm named that their realm list changed, so a
      // session viewing the workspace chooser drops the deleted realm without a
      // reload. Best-effort: the realm is already gone, so a failed notify must
      // not turn a successful delete into an error.
      try {
        await notifyRealmsListUpdated(sendEvent, namedRealmUsers(permissions));
      } catch (error) {
        Sentry.captureException(error);
      }
    } catch (error: any) {
      Sentry.captureException(error);
      await sendResponseForSystemError(ctxt, error.message, error);
    }
  };
}

export interface SourceRealmDeletionDeps {
  dbAdapter: DBAdapter;
  matrixClient: MatrixClient;
  realmsRootPath: string;
  hostURLResolver: HostURLResolver;
}

// Deletes a source realm and its published realms: their registry rows,
// permissions, index rows and host URLs in one transaction, then their files
// and event room. It throws only when that transaction fails, and then
// nothing was deleted; every step after the commit reports its failure
// instead of throwing, so a realm this deleted is never answered as one that
// wasn't. It checks nothing: the caller decides who may delete the realm.
export async function deleteSourceRealm(
  {
    dbAdapter,
    matrixClient,
    realmsRootPath,
    hostURLResolver,
  }: SourceRealmDeletionDeps,
  {
    realmURL,
    registryId,
    diskId,
  }: { realmURL: string; registryId: string; diskId: string },
): Promise<void> {
  let sourceRealmPath = join(realmsRootPath, diskId);

  // Captured inside the lock from `deletePublishedRowsBySourceUrl`'s
  // RETURNING so the post-commit FS sweep matches the rows the tx
  // actually deleted (no TOCTOU window between a pre-lock SELECT and
  // the in-tx DELETE).
  let publishedRealms: { url: string; disk_id: string }[] = [];
  // The hosts of the realm's host URLs, announced once the delete is
  // stored, so every process stops serving them (ADR 033 §1.3).
  let hostURLHosts: string[] = [];

  // Serialize concurrent writers for this source realm. Lock is on the
  // source URL — a concurrent unpublish of one of the associated
  // published realms uses a different lock key (its own published URL),
  // so in the rare case of overlap, the handlers interleave at the
  // per-URL granularity rather than globally. Pragmatic for this PR;
  // multi-instance hardening could tighten this later.
  //
  // CS-10898: every DB write inside the callback runs on the lock-
  // holder's pinned querier, so the entire cleanup (registry-row
  // deletes, per-published permissions + DB artifacts, claimed-domains
  // soft-delete, source permissions + DB artifacts) commits atomically
  // or rolls back atomically. A failure halfway through no longer
  // leaves the realm half-deleted.
  await dbAdapter.withWriteLock(realmURL, async (txQuerier) => {
    // Delete the published rows first so the RETURNING set is the
    // authoritative list of rows the tx will commit. Driving the
    // per-published cleanup off this set (instead of a pre-lock
    // SELECT) closes a TOCTOU race where a publish completing
    // between SELECT and lock would have its registry row deleted
    // here while its permissions + DB artifacts were never cleaned.
    // Within the tx, ordering is invisible to other connections —
    // the NOTIFY queues until COMMIT — so deleting before the
    // per-row cleanup is safe.
    publishedRealms = await deletePublishedRowsBySourceUrl(
      dbAdapter,
      realmURL,
      txQuerier,
    );

    for (let publishedRealm of publishedRealms) {
      await removeRealmPermissions(
        dbAdapter,
        new URL(publishedRealm.url),
        txQuerier,
      );
      await removeRealmDatabaseArtifacts({
        dbAdapter,
        realmURL: publishedRealm.url,
        querier: txQuerier,
      });
    }

    // The realm's host URLs. Deleting the registry row would delete them
    // too, but this keeps their hosts to announce.
    hostURLHosts = await deleteRealmHostURLs(
      txQuerier ?? dbAdapterQuerier(dbAdapter),
      registryId,
    );

    // The realm's site-name claims, found by its registry id, so their
    // site names are free again. They are marked removed before the
    // registry row goes, because deleting the row clears their realm id.
    let { nameExpressions, valueExpressions } = asExpressions({
      removed_at: Math.floor(Date.now() / 1000),
    });
    let q = txQuerier ?? dbAdapterQuerier(dbAdapter);
    await q([
      ...update('claimed_domains_for_sites', nameExpressions, valueExpressions),
      ` WHERE realm_id = `,
      param(registryId),
      ` AND removed_at IS NULL`,
    ]);

    // Source realm's registry row.
    await deleteRegistryRowByUrl(dbAdapter, realmURL, txQuerier);

    // Server-issued unlisted-link slug for this realm. Hard-delete it so a
    // realm later recreated at the same endpoint can't reuse the old
    // unguessable slug — which would expose the new realm to anyone holding
    // the previous unlisted URL.
    await q([
      `DELETE FROM unlisted_realm_paths WHERE source_realm_url = `,
      param(realmURL),
    ]);

    await removeRealmPermissions(dbAdapter, new URL(realmURL), txQuerier);
    await removeRealmDatabaseArtifacts({
      dbAdapter,
      realmURL,
      querier: txQuerier,
    });
  });

  // FS removals run after the DB transaction commits. If a removeRealmFiles
  // throws here we capture it but don't re-throw — orphan disk files are
  // recoverable by an out-of-band sweep, while a re-thrown error after a
  // successful commit would surface as a 500 on a delete that has, in
  // fact, succeeded from the DB's point of view (residual gap documented
  // in CS-10898).
  for (let publishedRealm of publishedRealms) {
    let publishedRealmPath = join(
      realmsRootPath,
      PUBLISHED_DIRECTORY_NAME,
      publishedRealm.disk_id,
    );
    try {
      removeRealmFiles(publishedRealmPath);
    } catch (error) {
      Sentry.captureException(error);
    }
  }
  try {
    removeRealmFiles(sourceRealmPath);
  } catch (error) {
    Sentry.captureException(error);
  }

  // The realm's event room has no grants left to follow, so it is
  // retired: its members are removed and the realm server leaves it, in
  // the background, and a removal that fails is tried again when a
  // realm server next starts. Through the realm server's own matrix
  // client, the one every realm it serves sends its events with, and so
  // the room's creator. The realm has no grantees left to tell.
  try {
    await retireRealmEventRoom(
      {
        realmURL,
        matrixClient,
        dbAdapter,
        dispatcher: realmEventDispatcher(),
      },
      { notifyGrantees: false },
    );
  } catch (error) {
    Sentry.captureException(error);
  }

  // CS-11156. Broadcast a bulk cache-invalidation for the source realm
  // and each removed published realm so any peer replicas that still
  // have these realms mounted drop their #sourceCache / #transpiledModuleCache
  // before the reconciler unmount lands via NOTIFY realm_registry.
  // Best-effort, fire-and-forget; missed NOTIFY is a bounded
  // staleness window resolved by the unmount itself, so a failure is
  // reported, not thrown, like the steps above.
  try {
    for (let publishedRealm of publishedRealms) {
      await notifyAllFileChanges(dbAdapter, publishedRealm.url);
    }
    await notifyAllFileChanges(dbAdapter, realmURL);
    await announceHostURLChanges(dbAdapter, hostURLResolver, hostURLHosts);
  } catch (error) {
    Sentry.captureException(error);
  }
}

function assertIsDeleteRealmJSON(
  json: unknown,
): asserts json is DeleteRealmJSON {
  if (typeof json !== 'object' || json == null) {
    throw new Error('json must be an object');
  }
  if (!('data' in json) || typeof json.data !== 'object' || json.data == null) {
    throw new Error('json is missing "data" object');
  }
  let { data } = json;
  if (!('type' in data) || data.type !== 'realm') {
    throw new Error('json.data.type must be "realm"');
  }
  if (!('id' in data) || typeof data.id !== 'string') {
    throw new Error('json.data.id is required and must be a string');
  }
}
