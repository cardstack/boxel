import type Koa from 'koa';
import {
  asExpressions,
  dbAdapterQuerier,
  ensureTrailingSlash,
  fetchRealmPermissions,
  getMatrixUsername,
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
} from '../middleware';
import type { CreateRoutesArgs } from '../routes';
import type { RealmServerTokenClaim } from '../utils/jwt';
import {
  removeRealmDatabaseArtifacts,
  removeRealmFiles,
} from './realm-destruction-utils';
import {
  deletePublishedRowsBySourceUrl,
  deleteRegistryRowByUrl,
} from '../lib/realm-registry-writes';
import { withRealmWriteLock } from '../lib/realm-advisory-locks';

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

      // Look up the published children up-front so the FS removals can
      // happen before the lock is acquired. The list is only used to drive
      // FS rms here — the DB cleanup inside the tx re-locates the rows by
      // source_url, so a concurrent publish that arrives between this
      // SELECT and the lock acquisition still gets cleaned up.
      let publishedRealms = (await query(dbAdapter, [
        `SELECT disk_id, url FROM realm_registry WHERE kind = 'published' AND source_url =`,
        param(realmURL),
      ])) as { disk_id: string; url: string }[];

      // Serialize concurrent writers for this source realm. Lock is on the
      // source URL — a concurrent unpublish of one of the associated
      // published realms uses a different lock key (its own published URL),
      // so in the rare case of overlap, the handlers interleave at the
      // per-URL granularity rather than globally. Pragmatic for this PR;
      // multi-instance hardening could tighten this later.
      //
      // CS-10898: every DB write inside the callback runs on the lock-
      // holder's pinned querier, so the entire cleanup (per-published
      // permissions + DB artifacts, registry-row deletes, claimed-domains
      // soft-delete, source permissions + DB artifacts) commits atomically
      // or rolls back atomically. A failure halfway through no longer
      // leaves the realm half-deleted.
      await withRealmWriteLock(dbAdapter, realmURL, async (txQuerier) => {
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

        // Removes the source realm's registry row plus every published
        // row sourced from it; both DELETEs emit NOTIFY realm_registry
        // so the reconciler unmounts the affected realms on every
        // instance.
        await deletePublishedRowsBySourceUrl(dbAdapter, realmURL, txQuerier);
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

function normalizeRealmURL(realmURL: string): URL | null {
  try {
    let parsedRealmURL = new URL(realmURL);
    parsedRealmURL.pathname = ensureTrailingSlash(parsedRealmURL.pathname);
    parsedRealmURL.search = '';
    parsedRealmURL.hash = '';
    return parsedRealmURL;
  } catch {
    return null;
  }
}

function getRealmNamespace(realmURL: URL): string | null {
  let segments = realmURL.pathname.split('/').filter(Boolean);
  if (segments.length < 2) {
    return null;
  }
  return segments[segments.length - 2] ?? null;
}
