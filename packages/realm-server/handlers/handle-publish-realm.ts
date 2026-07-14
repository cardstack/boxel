import type Koa from 'koa';
import {
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
  deriveRealmName,
} from '@cardstack/runtime-common';
import { getUnlistedSlug } from '../lib/unlisted-realm-path.ts';
import { getPublishedRealmDomainOverrides } from '@cardstack/runtime-common/constants';

import { join } from 'path';
import fsExtra from 'fs-extra';
// Async fs ops only: the publish handler runs these inside the request, and a
// synchronous copy/move of a whole realm directory would freeze the Node event
// loop, stalling every other concurrent request until it finished.
const { copy, readJson, writeJson, remove, pathExists, move } = fsExtra;

import {
  fetchRequestFromContext,
  sendResponseForBadRequest,
  sendResponseForForbiddenRequest,
  sendResponseForSystemError,
  sendResponseForUnprocessableEntity,
  setContextResponse,
} from '../middleware/index.ts';
import { createJWT } from '../jwt.ts';
import type { CreateRoutesArgs } from '../routes.ts';
import type { RealmServerTokenClaim } from '../utils/jwt.ts';
import { registerUser } from '../synapse.ts';
import {
  getMatrixUsername,
  passwordFromSeed,
} from '@cardstack/runtime-common/matrix-client';
import { enqueueReindexRealmJob } from '@cardstack/runtime-common/jobs/reindex-realm';
import { upsertPublishedRealmInRegistry } from '../lib/realm-registry-writes.ts';

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
async function ensureRealmIndexBoilerplateOptIn(
  publishedRealmPath: string,
): Promise<void> {
  let indexJsonPath = join(publishedRealmPath, 'index.json');
  let realmJsonPath = join(publishedRealmPath, 'realm.json');
  if (
    !(await pathExists(indexJsonPath)) ||
    !(await pathExists(realmJsonPath))
  ) {
    return;
  }
  let indexDoc: unknown;
  try {
    indexDoc = await readJson(indexJsonPath);
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
    realmConfigDoc = (await readJson(realmJsonPath)) as Record<string, unknown>;
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
    await writeJson(realmJsonPath, realmConfigDoc, { spaces: 2 });
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

      // Within the owner's own published space (`<username>.<spaceDomain>`), a
      // subdirectory publish may target only the realm-name path (the "Your
      // Boxel Space" target) or the server-issued unlisted-link slug — never an
      // arbitrary, client-chosen path — so the unlisted link's unguessable
      // path can't be hand-picked through a direct API call. Publishes to any
      // other host (claimed custom domains, etc.) are left permissive.
      let spaceDomain = domainsForPublishedRealms?.boxelSpace;
      let matrixUsername = getMatrixUsername(ownerUserId);
      let publishedURLForPath = new URL(publishedRealmURL);
      let isOwnerSpaceHost =
        !!spaceDomain &&
        (publishedURLForPath.host === `${matrixUsername}.${spaceDomain}` ||
          publishedURLForPath.hostname === `${matrixUsername}.${spaceDomain}`);
      if (isOwnerSpaceHost) {
        let publishedPath = publishedURLForPath.pathname
          .split('/')
          .filter(Boolean)
          .join('/');
        let realmName = deriveRealmName(sourceRealmURL);
        let unlistedSlug = await getUnlistedSlug(dbAdapter, sourceRealmURL);
        if (publishedPath !== realmName && publishedPath !== unlistedSlug) {
          await sendResponseForBadRequest(
            ctxt,
            'publishedRealmURL path must be the realm name or the server-issued unlisted link',
          );
          return;
        }
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
      let { lastPublishedAt, publishedRealmId, isNewRealm } =
        await dbAdapter.withWriteLock(publishedRealmURL, async () => {
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
          await remove(tempCopyPath);
          await remove(backupPath);
          await copy(sourceRealmPath, tempCopyPath);
          try {
            if (await pathExists(publishedRealmPath)) {
              await move(publishedRealmPath, backupPath);
            }
            await move(tempCopyPath, publishedRealmPath);
            await remove(backupPath);
          } catch (swapError) {
            // Restore the old published realm if the swap failed
            if (
              !(await pathExists(publishedRealmPath)) &&
              (await pathExists(backupPath))
            ) {
              await move(backupPath, publishedRealmPath);
            }
            await remove(tempCopyPath);
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
          await ensureRealmIndexBoilerplateOptIn(publishedRealmPath);

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
            await remove(publishedRealmPath);
            throw dbError;
          }

          // CS-11043. For a republish, the realm is already mounted on
          // this realm-server with its #sourceCache holding the
          // pre-swap bytes. The reindex enqueued just below fans out
          // module fetches through HTTP to this same realm-server, and
          // without an explicit invalidation those fetches would hit
          // the cached old bytes — producing a fresh reindex against
          // STALE source, which then gets written to
          // prerendered_html.isolated_html and served forever. Neither the
          // Cache-Control: no-store header nor the DB modules DELETE
          // above reach into the realm-server's per-Realm byte cache.
          // The Phase-3-PR-2 comment above relies on the NodeAdapter
          // file watcher to invalidate via change events, but that's
          // an async race against the immediately-enqueued reindex.
          // Force the invalidation synchronously here.
          //
          // Use the non-mounting `mounted` map rather than lookupOrMount:
          // for a new publish the realm isn't mounted here yet and there's
          // nothing cached to clear — and mounting it would await a
          // from-scratch index inside the request, which this handler must
          // not block on. It lazy-mounts fresh on its first request instead.
          let mountedRealmForCacheClear =
            reconciler.mounted.get(publishedRealmURL);
          if (mountedRealmForCacheClear) {
            // Sync local clear + cross-replica NOTIFY in one call. The
            // local clear is what this replica's reindex fan-out needs;
            // the broadcast (CS-11156) covers peers that still have the
            // realm mounted with pre-swap bytes.
            await mountedRealmForCacheClear.clearLocalSourceCachesAndBroadcast();
          }

          // Durability enqueue: guarantees the swapped files get indexed
          // even if no client ever polls this published realm. The index is
          // not awaited here — the handler returns 202 (pending) and the
          // client polls _readiness-check. For a realm not mounted on this
          // instance, its first request (typically the readiness poll)
          // lazy-mounts it and start()'s from-scratch pass coalesces with
          // this job. For a republish already mounted here, the post-lock
          // fullIndex below tracks completion for readiness. clearLastModified
          // forces every row to re-render even though file copies preserve
          // mtimes.
          await enqueueReindexRealmJob(
            publishedRealmURL,
            realmUsername,
            queue,
            dbAdapter,
            userInitiatedPriority,
            { clearLastModified: true },
          );

          return { lastPublishedAt, publishedRealmId, isNewRealm };
        });

      // Mount the published realm on this instance so it is served as soon as
      // the 202 returns, but do NOT await its index/prerender — that runs in
      // the background and clients poll <publishedRealmURL>_readiness-check.
      // ensureMounted publishes the realm into virtualNetwork synchronously, so
      // a request arriving right after this 202 (the readiness poll, or a
      // visitor) resolves to the realm rather than 404ing; awaiting the full
      // index + prerender (pool-bound) instead would hold the HTTP request open
      // for the entire indexing duration. Sibling instances pick the realm up
      // via the realm_registry NOTIFY and lazy-mount on their first request.
      if (isNewRealm) {
        // Brand-new publish: no prior index. lookupOrMount's start() runs a
        // from-scratch index (isNewIndex), and #startedUp resolves only after
        // it completes — readinessCheck awaits #startedUp, so a single pass
        // gates readiness. Don't await it here (that would block the response
        // on the full index); the durability enqueue above coalesces with it.
        void reconciler
          .lookupOrMount(publishedRealmURL)
          .catch((err: unknown) => {
            log.error(
              `background mount failed for ${publishedRealmURL}: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          });
      } else {
        // Republish: the realm already has index rows, so start() does NOT
        // re-index them and #startedUp resolves without reflecting the swapped
        // files — readinessCheck must instead wait on indexing(). Register a
        // tracked clearLastModified reindex SYNCHRONOUSLY (before the 202) so
        // indexing() reflects it and readiness can't report ready before the
        // reindex lands. Get the mounted realm, or mount it first when this
        // instance is cold (e.g. after a restart, or the publish landed on an
        // instance that never mounted this realm) — that mount is fast because
        // start() skips indexing for an existing index. fullIndex invalidates
        // the cached RealmInfo before the pass, so og:title re-bakes from the
        // swapped realm.json (parseRealmInfo's disk overlay) in a single pass.
        // The reindex job coalesces with the durability enqueue above.
        let publishedRealm =
          reconciler.mounted.get(publishedRealmURL) ??
          (await reconciler.lookupOrMount(publishedRealmURL));
        if (publishedRealm) {
          void publishedRealm
            .fullIndex(userInitiatedPriority, { clearLastModified: true })
            .catch((err: unknown) => {
              log.error(
                `background publish reindex failed for ${publishedRealmURL}: ${
                  err instanceof Error ? err.message : String(err)
                }`,
              );
            });
        }
      }

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

      // Build the 202 directly rather than via createResponse: the published
      // realm may not be mounted on this instance (a new publish lazy-mounts
      // on first request), so there is no Realm object to read a url from.
      //
      // Point clients at the status monitor for this accepted-but-not-yet-
      // -complete request (RFC 9110 §15.3.3): `Location` is the published
      // realm's readiness check, which resolves once it is indexed and
      // viewable, and `Retry-After` hints the poll interval. This lets a
      // consumer discover where to wait for completion from the response
      // itself rather than hard-coding the readiness URL.
      let readinessCheckURL = `${publishedRealmURL}_readiness-check`;
      let response = new Response(
        JSON.stringify(
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
        {
          status: 202,
          headers: {
            'content-type': SupportedMimeType.JSONAPI,
            Location: readinessCheckURL,
            'Retry-After': '1',
            'X-Boxel-Realm-Url': publishedRealmURL,
            ...(publishedPermissions['*']?.includes('read') && {
              'X-Boxel-Realm-Public-Readable': 'true',
            }),
          },
        },
      );
      await setContextResponse(ctxt, response);
      return;
    } catch (error: any) {
      log.error('Error publishing realm:', error);
      await sendResponseForSystemError(ctxt, error.message);
    }
  };
}
