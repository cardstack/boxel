import type Koa from 'koa';
import {
  asExpressions,
  ensureTrailingSlash,
  fetchRealmPermissions,
  getMatrixUsername,
  param,
  PUBLISHED_DIRECTORY_NAME,
  query,
  removeRealmPermissions,
  SupportedMimeType,
  type PublishedRealmTable,
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
  deleteFromRegistryByUrl,
  deletePublishedFromRegistryBySource,
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

      let publishedRealmMatch = (await query(dbAdapter, [
        `SELECT id FROM published_realms WHERE published_realm_url =`,
        param(realmURL),
      ])) as Pick<PublishedRealmTable, 'id'>[];
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

      // Serialize concurrent writers for this source realm. Lock is on the
      // source URL — a concurrent unpublish of one of the associated
      // published realms uses a different lock key (its own published URL),
      // so in the rare case of overlap, the handlers interleave at the
      // per-URL granularity rather than globally. Pragmatic for this PR;
      // multi-instance hardening could tighten this later.
      await withRealmWriteLock(dbAdapter, realmURL, async () => {
        let publishedRealms = (await query(dbAdapter, [
          `SELECT id, published_realm_url FROM published_realms WHERE source_realm_url =`,
          param(realmURL),
        ])) as Pick<PublishedRealmTable, 'id' | 'published_realm_url'>[];

        for (let publishedRealm of publishedRealms) {
          let publishedRealmPath = join(
            realmsRootPath,
            PUBLISHED_DIRECTORY_NAME,
            publishedRealm.id,
          );
          try {
            removeRealmFiles(publishedRealmPath);
          } catch (error) {
            Sentry.captureException(error);
          }
          await removeRealmPermissions(
            dbAdapter,
            new URL(publishedRealm.published_realm_url),
          );
          await removeRealmDatabaseArtifacts({
            dbAdapter,
            realmURL: publishedRealm.published_realm_url,
          });
        }

        await query(dbAdapter, [
          `DELETE FROM published_realms WHERE source_realm_url =`,
          param(realmURL),
        ]);

        // Removes the source realm's registry row plus every published
        // row sourced from it; both DELETEs emit NOTIFY realm_registry
        // so the reconciler unmounts the affected realms on every
        // instance.
        await deletePublishedFromRegistryBySource(dbAdapter, realmURL);
        await deleteFromRegistryByUrl(dbAdapter, realmURL);

        let { nameExpressions, valueExpressions } = asExpressions({
          removed_at: Math.floor(Date.now() / 1000),
        });
        await query(dbAdapter, [
          ...update(
            'claimed_domains_for_sites',
            nameExpressions,
            valueExpressions,
          ),
          ` WHERE source_realm_url = `,
          param(realmURL),
          ` AND removed_at IS NULL`,
        ]);

        removeRealmFiles(sourceRealmPath);
        await removeRealmPermissions(dbAdapter, parsedRealmURL);
        await removeRealmDatabaseArtifacts({
          dbAdapter,
          realmURL,
        });
      });

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
