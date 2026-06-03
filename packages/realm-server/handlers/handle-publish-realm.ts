import type Koa from 'koa';
import {
  createResponse,
  fetchUserPermissions,
  isResolvedCodeRef,
  query,
  SupportedMimeType,
  logger,
  insertPermissions,
  param,
  PUBLISHED_DIRECTORY_NAME,
  ensureTrailingSlash,
  type DBAdapter,
  fetchRealmPermissions,
  uuidv4,
  userInitiatedPriority,
} from '@cardstack/runtime-common';
import { getPublishedRealmDomainOverrides } from '@cardstack/runtime-common/constants';

import { join } from 'path';
import {
  copySync,
  readJsonSync,
  writeJsonSync,
  removeSync,
  existsSync,
  moveSync,
} from 'fs-extra';

import {
  fetchRequestFromContext,
  sendResponseForBadRequest,
  sendResponseForForbiddenRequest,
  sendResponseForSystemError,
  sendResponseForUnprocessableEntity,
  setContextResponse,
} from '../middleware';
import { createJWT } from '../jwt';
import type { CreateRoutesArgs } from '../routes';
import type { RealmServerTokenClaim } from '../utils/jwt';
import { registerUser } from '../synapse';
import { passwordFromSeed } from '@cardstack/runtime-common/matrix-client';
import { enqueueReindexRealmJob } from '@cardstack/runtime-common/jobs/reindex-realm';
import { upsertPublishedRealmInRegistry } from '../lib/realm-registry-writes';

const log = logger('handle-publish');

// The CardsGrid CardDef can be referenced two equivalent ways in a
// `meta.adoptsFrom.module` field — the absolute base-realm URL, or
// the registered `@cardstack/base/` prefix form. `@cardstack/base/`
// isn't currently wired as a virtual-network mapping in production
// (only test fixtures register it), so today the canonical form on
// disk is the absolute URL. Listing both forms keeps the detection
// future-proof: once `@cardstack/base/` becomes a live prefix
// mapping, `index.json` files that use it are still caught.
const CARDS_GRID_MODULE_FORMS = new Set<string>([
  'https://cardstack.com/base/cards-grid',
  '@cardstack/base/cards-grid',
]);
const CARDS_GRID_NAME = 'CardsGrid';

const PUBLISHED_REALM_DOMAIN_OVERRIDES = getPublishedRealmDomainOverrides(
  process.env.PUBLISHED_REALM_DOMAIN_OVERRIDES,
);

type OverrideHost = {
  host: string;
  hostname: string;
  port: string;
};

function parseOverrideHost(rawOverride: string): OverrideHost | null {
  try {
    let overrideURL = rawOverride.includes('://')
      ? new URL(rawOverride)
      : new URL(`https://${rawOverride}`);
    return {
      host: overrideURL.host.toLowerCase(),
      hostname: overrideURL.hostname.toLowerCase(),
      port: overrideURL.port,
    };
  } catch {
    return null;
  }
}

async function maybeApplyPublishedRealmOverride(
  dbAdapter: DBAdapter,
  ownerUserId: string,
  sourceRealmURL: string,
  publishedRealmURL: string,
): Promise<{ applied: boolean; publishedRealmURL: string }> {
  let overrideDomain = PUBLISHED_REALM_DOMAIN_OVERRIDES[sourceRealmURL];
  if (!overrideDomain) {
    return { applied: false, publishedRealmURL };
  }

  let overrideHost = parseOverrideHost(overrideDomain);
  if (!overrideHost) {
    return { applied: false, publishedRealmURL };
  }

  let publishedURL: URL;
  try {
    publishedURL = new URL(publishedRealmURL);
  } catch {
    return { applied: false, publishedRealmURL };
  }

  let publishedHost = publishedURL.host.toLowerCase();
  let publishedHostname = publishedURL.hostname.toLowerCase();
  let matchesOverride = overrideHost.port
    ? publishedHost === overrideHost.host
    : publishedHostname === overrideHost.hostname;
  if (!matchesOverride) {
    return { applied: false, publishedRealmURL };
  }

  let permissions = await fetchRealmPermissions(
    dbAdapter,
    new URL(sourceRealmURL),
  );
  let effectivePermissions = new Set([
    ...(permissions['*'] ?? []),
    ...(permissions['users'] ?? []),
    ...(permissions[ownerUserId] ?? []),
  ]);
  if (!effectivePermissions.has('write')) {
    return { applied: false, publishedRealmURL };
  }

  let overriddenURL = new URL(publishedRealmURL);
  overriddenURL.host = overrideHost.host;
  return {
    applied: true,
    publishedRealmURL: ensureTrailingSlash(overriddenURL.toString()),
  };
}

// If the published realm's index card is the default CardsGrid, write
// `includePrerenderedDefaultRealmIndex: true` into the realm's
// RealmConfig card on disk so the indexer (which the publish handler
// kicks off below) produces a real isolated HTML for the index card
// instead of the boilerplate placeholder. Anonymous visitors of a
// published realm's homepage hit the SSR injection path, which
// expects real prerendered content; without this opt-in they'd see
// the placeholder until JS boots. The check is a structural read of
// the index.json's adoptsFrom — a published realm that has customised
// its index to a different CardDef is left alone (its isolated render
// is presumably the bespoke landing page the publisher wanted).
function ensureRealmIndexBoilerplateOptIn(publishedRealmPath: string): void {
  let indexJsonPath = join(publishedRealmPath, 'index.json');
  let realmJsonPath = join(publishedRealmPath, 'realm.json');
  if (!existsSync(indexJsonPath) || !existsSync(realmJsonPath)) {
    return;
  }
  let indexDoc: unknown;
  try {
    indexDoc = readJsonSync(indexJsonPath);
  } catch (e) {
    log.warn(
      `could not parse published index.json at ${indexJsonPath}: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
    return;
  }
  let adoptsFrom = (indexDoc as { data?: { meta?: { adoptsFrom?: unknown } } })
    ?.data?.meta?.adoptsFrom as
    | Parameters<typeof isResolvedCodeRef>[0]
    | undefined;
  if (!isResolvedCodeRef(adoptsFrom)) {
    return;
  }
  if (
    !CARDS_GRID_MODULE_FORMS.has(adoptsFrom.module) ||
    adoptsFrom.name !== CARDS_GRID_NAME
  ) {
    return;
  }
  let realmConfigDoc: Record<string, unknown>;
  try {
    realmConfigDoc = readJsonSync(realmJsonPath) as Record<string, unknown>;
  } catch (e) {
    log.warn(
      `could not parse published realm.json at ${realmJsonPath}: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
    return;
  }
  let data = (realmConfigDoc.data ?? {}) as Record<string, unknown>;
  let attributes = (data.attributes ?? {}) as Record<string, unknown>;
  if (attributes.includePrerenderedDefaultRealmIndex === true) {
    return;
  }
  attributes.includePrerenderedDefaultRealmIndex = true;
  data.attributes = attributes;
  realmConfigDoc.data = data;
  try {
    writeJsonSync(realmJsonPath, realmConfigDoc, { spaces: 2 });
  } catch (e) {
    log.warn(
      `could not write includePrerenderedDefaultRealmIndex into ${realmJsonPath}: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }
}

export default function handlePublishRealm({
  dbAdapter,
  definitionLookup,
  matrixClient,
  queue,
  realmSecretSeed,
  serverURL,
  virtualNetwork,
  reconciler,
  realmsRootPath,
  getMatrixRegistrationSecret,
  domainsForPublishedRealms,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    let token = ctxt.state.token as RealmServerTokenClaim;
    if (!token) {
      await sendResponseForSystemError(
        ctxt,
        'token is required to create realm',
      );
      return;
    }

    let request = await fetchRequestFromContext(ctxt);
    let body = await request.text();
    let json: Record<string, any>;
    try {
      json = JSON.parse(body);
    } catch (e) {
      await sendResponseForBadRequest(
        ctxt,
        'Request body is not valid JSON-API - invalid JSON',
      );
      return;
    }

    if (!json.sourceRealmURL) {
      await sendResponseForBadRequest(ctxt, 'sourceRealmURL is required');
      return;
    }

    if (!json.publishedRealmURL) {
      await sendResponseForBadRequest(ctxt, 'publishedRealmURL is required');
      return;
    }

    let sourceRealmURL = ensureTrailingSlash(json.sourceRealmURL);
    let publishedRealmURL = ensureTrailingSlash(json.publishedRealmURL);

    let { user: ownerUserId, sessionRoom: tokenSessionRoom } = token;

    let overrideResult = await maybeApplyPublishedRealmOverride(
      dbAdapter,
      ownerUserId,
      sourceRealmURL,
      publishedRealmURL,
    );

    if (overrideResult.applied) {
      log.info(
        `Overriding publishedRealmURL for ${ownerUserId} from ${publishedRealmURL} to ${overrideResult.publishedRealmURL}`,
      );
      publishedRealmURL = overrideResult.publishedRealmURL;
    }

    if (!overrideResult.applied) {
      let validPublishedRealmDomains = Object.values(
        domainsForPublishedRealms || {},
      );
      try {
        let publishedURL = new URL(publishedRealmURL);
        if (
          validPublishedRealmDomains &&
          validPublishedRealmDomains.length > 0
        ) {
          let isValidDomain = validPublishedRealmDomains.some(
            (domain) =>
              publishedURL.host.endsWith(domain) ||
              publishedURL.hostname.endsWith(domain),
          );
          if (!isValidDomain) {
            await sendResponseForBadRequest(
              ctxt,
              `publishedRealmURL must use a valid domain ending with one of: ${validPublishedRealmDomains.join(', ')}`,
            );
            return;
          }
        }
      } catch (e) {
        await sendResponseForBadRequest(
          ctxt,
          'publishedRealmURL is not a valid URL',
        );
        return;
      }

      let permissions = await fetchRealmPermissions(
        dbAdapter,
        new URL(sourceRealmURL),
      );
      if (!permissions[ownerUserId]?.includes('realm-owner')) {
        await sendResponseForForbiddenRequest(
          ctxt,
          `${ownerUserId} does not have enough permission to publish this realm`,
        );
        return;
      }
    }

    try {
      let permissionsForAllRealms = await fetchUserPermissions(dbAdapter, {
        userId: ownerUserId,
      });

      // Phase 3: /_publish-realm is a server-level endpoint and bypasses
      // serveFromRealm, so the source realm isn't lazy-mounted by request
      // routing. Mount it here on this instance — every downstream call
      // (the _info fetch below, sourceRealm.indexing()/flushUpdateEvents()/.dir
      // inside the write lock) needs it published into virtualNetwork.
      let sourceRealm = await reconciler.lookupOrMount(sourceRealmURL);
      if (!sourceRealm) {
        return sendResponseForBadRequest(
          ctxt,
          `Source realm ${sourceRealmURL} does not exist`,
        );
      }

      let sourceRealmSession = createJWT(
        {
          user: ownerUserId,
          realm: sourceRealmURL,
          permissions: permissionsForAllRealms[sourceRealmURL],
          sessionRoom: tokenSessionRoom,
          realmServerURL: serverURL,
        },
        '1h',
        realmSecretSeed,
      );

      let realmInfoResponse = await virtualNetwork.handle(
        new Request(`${sourceRealmURL}_info`, {
          method: 'QUERY',
          headers: {
            Accept: SupportedMimeType.RealmInfo,
            Authorization: sourceRealmSession,
          },
        }),
      );

      if (!realmInfoResponse || realmInfoResponse.status !== 200) {
        log.warn(
          `Failed to fetch realm info for realm ${sourceRealmURL}: ${realmInfoResponse?.status}`,
        );
        throw new Error(`Could not fetch info for realm ${sourceRealmURL}`);
      }

      let realmInfoJson = await realmInfoResponse.json();

      if (realmInfoJson.data.attributes.publishable !== true) {
        return sendResponseForUnprocessableEntity(
          ctxt,
          `Realm ${sourceRealmURL} is not publishable`,
        );
      }

      // Acquire the per-realm write lock early — before the existing-realm
      // check, Matrix user registration, and permissions insert — so that
      // two concurrent publishes for the same publishedRealmURL cannot
      // race through those pre-lock steps (which would otherwise orphan a
      // Matrix user / permissions row when one of them fails on the
      // realm_registry upsert).
      //
      // Phase 3 PR 2: handler is stateless. After the FS swap + DB write +
      // NOTIFY realm_registry, the reconciler on every instance lazily
      // mounts the (re-)published realm on its first request. The
      // response is 202 Accepted with status:'pending'; the client polls
      // /<publishedRealmURL>/_readiness-check to learn when it's ready.
      let { lastPublishedAt, publishedRealmId } = await dbAdapter.withWriteLock(
        publishedRealmURL,
        async () => {
          let existingRows = (await query(dbAdapter, [
            `SELECT disk_id, owner_username FROM realm_registry WHERE kind = 'published' AND url =`,
            param(publishedRealmURL),
          ])) as { disk_id: string; owner_username: string }[];
          let isNewRealm = existingRows.length === 0;

          let publishedRealmId: string;
          let realmUsername: string;

          if (isNewRealm) {
            publishedRealmId = uuidv4();
            realmUsername = `realm/${PUBLISHED_DIRECTORY_NAME}_${publishedRealmId}`;

            let { userId: newUserId } = await registerUser({
              matrixURL: matrixClient.matrixURL,
              displayname: realmUsername,
              username: realmUsername,
              password: await passwordFromSeed(realmUsername, realmSecretSeed),
              registrationSecret: await getMatrixRegistrationSecret(),
            });

            await insertPermissions(dbAdapter, new URL(publishedRealmURL), {
              [newUserId]: ['read', 'realm-owner'],
              [ownerUserId]: ['read', 'realm-owner'],
              '*': ['read'],
            });
          } else {
            publishedRealmId = existingRows[0].disk_id;
            realmUsername = `realm/${PUBLISHED_DIRECTORY_NAME}_${publishedRealmId}`;
          }

          // The source realm was lookupOrMounted at the top of the
          // handler. Use it for `.indexing()` / `.flushUpdateEvents()` /
          // `.dir`. Reading the Realm instance is allowed — the
          // stateless rule prohibits *mutating* realms[] / virtualNetwork.
          if (!sourceRealm?.dir) {
            throw new Error(
              `Could not determine filesystem path for source realm ${sourceRealmURL}`,
            );
          }
          // Publishing copies index state from the source realm, so we need to
          // wait for any in-flight indexing/update propagation to settle first.
          await sourceRealm.indexing();
          await sourceRealm.flushUpdateEvents();
          let sourceRealmPath = sourceRealm.dir;
          let publishedDir = join(realmsRootPath, PUBLISHED_DIRECTORY_NAME);
          let publishedRealmPath = join(publishedDir, publishedRealmId);

          // Copy source to a temporary directory first, then swap it into
          // place so that a failed copy doesn't destroy the existing
          // published realm (e.g. due to disk-full or permission errors).
          //
          // Phase 3 PR 2: no unmount-before-swap here. The currently-mounted
          // realm (if this is a republish) keeps serving from its existing
          // mount during the swap window; its NodeAdapter file watcher
          // picks up the post-swap files. We follow up with an
          // enqueueReindexRealmJob below to refresh the index.
          let tempCopyPath = `${publishedRealmPath}.tmp`;
          let backupPath = `${publishedRealmPath}.backup`;
          removeSync(tempCopyPath);
          removeSync(backupPath);
          copySync(sourceRealmPath, tempCopyPath);
          try {
            if (existsSync(publishedRealmPath)) {
              moveSync(publishedRealmPath, backupPath);
            }
            moveSync(tempCopyPath, publishedRealmPath);
            removeSync(backupPath);
          } catch (swapError) {
            // Restore the old published realm if the swap failed
            if (!existsSync(publishedRealmPath) && existsSync(backupPath)) {
              moveSync(backupPath, publishedRealmPath);
            }
            removeSync(tempCopyPath);
            throw swapError;
          }

          // CS-10053: publishable lives in realm_metadata now. Mark the
          // published realm not-publishable via UPSERT after the swap
          // succeeds so a failed swap doesn't leave a metadata row
          // pointing at a rolled-back URL.
          await query(dbAdapter, [
            `INSERT INTO realm_metadata (url, publishable) VALUES (`,
            param(publishedRealmURL),
            `,`,
            param(false),
            `) ON CONFLICT (url) DO UPDATE SET publishable = false, updated_at = now()`,
          ]);

          // For published realms whose homepage is the default
          // CardsGrid, opt them in to keeping the full prerendered
          // isolated HTML on the realm index card. Anonymous visitors
          // of the published homepage hit the SSR injection path
          // (server.ts → retrieveIsolatedHTML → injectIsolatedHTML);
          // without the opt-in the host returns a boilerplate
          // placeholder for that card and the SSR shell would inject
          // an empty grid. Unpublished realms with the same CardsGrid
          // index never need this; only the published snapshot does.
          // The flag is written to the published realm's RealmConfig
          // card (/realm.json) on disk before the reindex below picks
          // it up.
          ensureRealmIndexBoilerplateOptIn(publishedRealmPath);

          // Clear stale modules cache for the published realm (including
          // error entries from a previous publish) before the reindex's
          // prerender fan-out, so its HTTP module fetches don't hit
          // cached pre-swap state on this replica or its peers.
          // `clearRealmDefinitions` bundles the DB DELETE + in-flight prerender
          // drop + per-realm generation bump + cross-instance NOTIFY on
          // `module_cache_invalidated` — the modules-cache analog of
          // `clearLocalSourceCachesAndBroadcast()` below. Without those extra
          // steps (which a raw `DELETE FROM modules` would miss), an
          // in-flight prerender that started before the DELETE could
          // re-insert a stale row at persist time, and peer replicas
          // would keep their cached rows + generation counters until
          // their own next invalidation arrived.
          await definitionLookup.clearRealmDefinitions(publishedRealmURL);

          let lastPublishedAt = Date.now().toString();
          try {
            await upsertPublishedRealmInRegistry(dbAdapter, {
              publishedRealmURL,
              publishedRealmId,
              ownerUsername: realmUsername,
              sourceRealmURL,
              lastPublishedAt: Number(lastPublishedAt),
            });
          } catch (dbError: any) {
            // Phase 3 PR 2 rollback simplification: no in-memory
            // realms[]/virtualNetwork state to unwind. Just remove the
            // FS swap that we just put in place.
            removeSync(publishedRealmPath);
            throw dbError;
          }

          // CS-11043. For a republish, the realm is already mounted on
          // this realm-server with its #sourceCache holding the
          // pre-swap bytes. The reindex enqueued just below fans out
          // module fetches through HTTP to this same realm-server, and
          // without an explicit invalidation those fetches would hit
          // the cached old bytes — producing a fresh reindex against
          // STALE source, which then gets written to
          // boxel_index.isolated_html and served forever. Neither the
          // Cache-Control: no-store header nor the DB modules DELETE
          // above reach into the realm-server's per-Realm byte cache.
          // The Phase-3-PR-2 comment above relies on the NodeAdapter
          // file watcher to invalidate via change events, but that's
          // an async race against the immediately-enqueued reindex.
          // Force the invalidation synchronously here.
          //
          // For a new publish, lookupOrMount mounts the realm fresh
          // (registry row was just upserted above); the cache is
          // empty so clearLocalSourceCaches is a no-op. Either way the
          // reindex below sees correct source.
          let mountedRealmForCacheClear =
            await reconciler.lookupOrMount(publishedRealmURL);
          if (mountedRealmForCacheClear) {
            // Sync local clear + cross-replica NOTIFY in one call. The
            // local clear is what this replica's reindex fan-out needs;
            // the broadcast (CS-11156) covers peers that still have the
            // realm mounted with pre-swap bytes.
            await mountedRealmForCacheClear.clearLocalSourceCachesAndBroadcast();
          }

          // Refresh the index. For a new publish this is redundant
          // (lazy-mount's first start() does its own fullIndex on a
          // fresh DB), but the from-scratch-index coalesce handler
          // (CS-10893) collapses both into a single canonical job. For
          // a republish where the realm is already mounted with a
          // resolved #startedUp, this is the only mechanism that
          // re-indexes against the swapped files. clearLastModified
          // forces every row to re-render even if mtimes appear
          // unchanged (file copies preserve mtimes).
          await enqueueReindexRealmJob(
            publishedRealmURL,
            realmUsername,
            queue,
            dbAdapter,
            userInitiatedPriority,
            { clearLastModified: true },
          );

          return { lastPublishedAt, publishedRealmId };
        },
      );

      // Mount + start the published realm on this instance now. The
      // reconciler's prepareRealmFromRow constructs a Realm and adds
      // it to realms[] / virtualNetwork; ensureMounted then awaits
      // realm.start() which awaits the from-scratch-index job we
      // enqueued above (the chooseFromScratch coalesce JOINs the
      // start()-enqueued job with ours). By the time we return 202,
      // indexing is complete on this instance — sibling instances
      // pick the published realm up via NOTIFY and lazy-mount on
      // first request. This preserves the test-suite's synchronous-
      // publish semantics while keeping the handler purely registry-
      // driven.
      let publishedRealm = await reconciler.lookupOrMount(publishedRealmURL);
      if (!publishedRealm) {
        throw new Error(
          `expected published realm ${publishedRealmURL} to be mounted after publish — registry row missing or mount failed`,
        );
      }
      // Re-run a full index after start()'s pass so the RealmConfig card
      // at /realm.json is queryable by parseRealmInfo before /index is
      // re-rendered. start()'s from-scratch pass walks files in order and
      // typically renders /index before /realm.json — at which point
      // attachRealmInfo → getRealmInfo → parseRealmInfo finds /realm.json
      // not yet indexed, falls back to "Unnamed Workspace", and caches
      // that. The prerendered head HTML for /index is baked with the
      // stale value, surfacing as og:title="Unnamed Workspace" on the
      // published page.
      //
      // clearLastModified: true forces every row to re-render on this
      // pass even though copySync preserves mtimes — without it, the
      // indexer's mtime-cache check would skip the already-rendered
      // /index and the stale prerendered HTML would persist.
      // Realm.fullIndex clears #cachedRealmInfo before this pass so the
      // first attachRealmInfo call re-reads parseRealmInfo against the
      // now-populated index and bakes the correct realm name into the
      // re-rendered prerendered HTML.
      await publishedRealm.fullIndex(userInitiatedPriority, {
        clearLastModified: true,
      });

      // The source realm's `RealmInfo.lastPublishedAt` map is built
      // from `realm_registry` rows joined on `source_url = sourceRealmURL`,
      // so publishing this derivative just changed it. Without
      // invalidating the cache, the source's `getRealmInfo()` keeps
      // returning the pre-publish snapshot — and the card+json ETag,
      // which folds a hash of that snapshot in, would still match a
      // stale `If-None-Match` and serve a 304 with the old
      // `meta.realmInfo.lastPublishedAt`. (CS-11010)
      sourceRealm.invalidateCachedRealmInfo();

      let publishedPermissions = await fetchRealmPermissions(
        dbAdapter,
        new URL(publishedRealmURL),
      );

      let response = createResponse({
        body: JSON.stringify(
          {
            data: {
              type: 'published_realm',
              id: publishedRealmId,
              attributes: {
                sourceRealmURL,
                publishedRealmURL,
                lastPublishedAt,
                status: 'pending',
              },
            },
          },
          null,
          2,
        ),
        init: {
          status: 202,
          headers: {
            'content-type': SupportedMimeType.JSONAPI,
          },
        },
        requestContext: {
          realm: publishedRealm,
          permissions: publishedPermissions,
        },
      });
      await setContextResponse(ctxt, response);
      return;
    } catch (error: any) {
      log.error('Error publishing realm:', error);
      await sendResponseForSystemError(ctxt, error.message);
    }
  };
}
