import type Koa from 'koa';
import {
  asExpressions,
  dbAdapterQuerier,
  fetchRealmPermissions,
  getMatrixUsername,
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
  sendResponseForForbiddenRequest,
  sendResponseForNotFound,
  sendResponseForSystemError,
  sendResponseForUnprocessableEntity,
  setContextResponse,
} from '../middleware/index.ts';
import type { CreateRoutesArgs } from '../routes.ts';
import type { RealmServerTokenClaim } from '../utils/jwt.ts';
import {
  removeRealmDatabaseArtifacts,
  removeRealmFiles,
} from './realm-destruction-utils.ts';
import {
  deletePublishedRowsBySourceUrl,
  deleteRegistryRowByUrl,
} from '../lib/realm-registry-writes.ts';
import { normalizeRealmURL } from '../utils/realm-url.ts';

interface DeleteRealmJSON {
  data: {
    type: 'realm';
    id: string;
  };
}

export default function handleDeleteRealm({
  dbAdapter,
  realmsRootPath,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    let token = ctxt.state.token as RealmServerTokenClaim;
    if (!token) {
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
        `SELECT disk_id FROM realm_registry WHERE url =`,
        param(realmURL),
      ])) as { disk_id: string }[];
      if (sourceRow.length === 0) {
        await sendResponseForNotFound(ctxt, `Realm not found: ${realmURL}`);
        return;
      }
      let sourceRealmPath = join(realmsRootPath, sourceRow[0].disk_id);

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
      let { user: ownerUserId } = token;
      if (!permissions[ownerUserId]?.includes('realm-owner')) {
        await sendResponseForForbiddenRequest(
          ctxt,
          `${ownerUserId} does not have enough permission to delete this realm`,
        );
        return;
      }

      let ownerNamespace = getRealmNamespace(parsedRealmURL);
      if (
        !ownerNamespace ||
        ownerNamespace !== getMatrixUsername(ownerUserId)
      ) {
        await sendResponseForForbiddenRequest(
          ctxt,
          'You can only delete realms that you created',
        );
        return;
      }

      // Captured inside the lock from `deletePublishedRowsBySourceUrl`'s
      // RETURNING so the post-commit FS sweep matches the rows the tx
      // actually deleted (no TOCTOU window between a pre-lock SELECT and
      // the in-tx DELETE).
      let publishedRealms: { url: string; disk_id: string }[] = [];

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

        // Source realm's registry row.
        await deleteRegistryRowByUrl(dbAdapter, realmURL, txQuerier);

        let { nameExpressions, valueExpressions } = asExpressions({
          removed_at: Math.floor(Date.now() / 1000),
        });
        let q = txQuerier ?? dbAdapterQuerier(dbAdapter);
        await q([
          ...update(
            'claimed_domains_for_sites',
            nameExpressions,
            valueExpressions,
          ),
          ` WHERE source_realm_url = `,
          param(realmURL),
          ` AND removed_at IS NULL`,
        ]);

        // Server-issued unlisted-link slug for this realm. Hard-delete it so a
        // realm later recreated at the same endpoint can't reuse the old
        // unguessable slug — which would expose the new realm to anyone holding
        // the previous unlisted URL.
        await q([
          `DELETE FROM unlisted_realm_paths WHERE source_realm_url = `,
          param(realmURL),
        ]);

        await removeRealmPermissions(dbAdapter, parsedRealmURL, txQuerier);
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

      // CS-11156. Broadcast a bulk cache-invalidation for the source realm
      // and each removed published realm so any peer replicas that still
      // have these realms mounted drop their #sourceCache / #transpiledModuleCache
      // before the reconciler unmount lands via NOTIFY realm_registry.
      // Best-effort, fire-and-forget; missed NOTIFY is a bounded
      // staleness window resolved by the unmount itself.
      for (let publishedRealm of publishedRealms) {
        await notifyAllFileChanges(dbAdapter, publishedRealm.url);
      }
      await notifyAllFileChanges(dbAdapter, realmURL);

      await setContextResponse(
        ctxt,
        new Response(null, {
          status: 204,
          headers: {
            'content-type': SupportedMimeType.JSONAPI,
          },
        }),
      );
    } catch (error: any) {
      Sentry.captureException(error);
      await sendResponseForSystemError(ctxt, error.message);
    }
  };
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

function getRealmNamespace(realmURL: URL): string | null {
  let segments = realmURL.pathname.split('/').filter(Boolean);
  if (segments.length < 2) {
    return null;
  }
  return segments[segments.length - 2] ?? null;
}
