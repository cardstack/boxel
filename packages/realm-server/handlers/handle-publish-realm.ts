import type Koa from 'koa';
import {
  createResponse,
  fetchUserPermissions,
  query,
  SupportedMimeType,
  logger,
  insertPermissions,
  insert,
  asExpressions,
  param,
  PUBLISHED_DIRECTORY_NAME,
  ensureTrailingSlash,
  type DBAdapter,
  type PublishedRealmTable,
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
import { mirrorPublishedRealmToRegistry } from '../lib/realm-registry-writes';
import { withRealmWriteLock } from '../lib/realm-advisory-locks';

const log = logger('handle-publish');

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

function rewriteHostHomeForPublishedRealm(
  hostHome: string | undefined | null | unknown,
  sourceRealmURL: string,
  publishedRealmURL: string,
): string | undefined {
  if (typeof hostHome !== 'string') {
    return undefined;
  }
  return hostHome.startsWith(sourceRealmURL)
    ? `${publishedRealmURL}${hostHome.slice(sourceRealmURL.length)}`
    : undefined;
}

export default function handlePublishRealm({
  dbAdapter,
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
      // published_realms insert).
      //
      // Phase 3 PR 2: handler is stateless. After the FS swap + DB write +
      // NOTIFY realm_registry, the reconciler on every instance lazily
      // mounts the (re-)published realm on its first request. The
      // response is 202 Accepted with status:'pending'; the client polls
      // /<publishedRealmURL>/_readiness-check to learn when it's ready.
      let { lastPublishedAt, publishedRealmId } = await withRealmWriteLock(
        dbAdapter,
        publishedRealmURL,
        async () => {
          let existingRows = (await query(dbAdapter, [
            `SELECT id, owner_username FROM published_realms WHERE published_realm_url =`,
            param(publishedRealmURL),
          ])) as Pick<PublishedRealmTable, 'id' | 'owner_username'>[];
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
            publishedRealmId = existingRows[0].id;
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

          let newlyPublishedRealmConfig = readJsonSync(
            join(publishedRealmPath, '.realm.json'),
          );
          newlyPublishedRealmConfig.publishable = false;
          let rewrittenHostHome = rewriteHostHomeForPublishedRealm(
            newlyPublishedRealmConfig.hostHome,
            sourceRealmURL,
            publishedRealmURL,
          );
          if (rewrittenHostHome) {
            newlyPublishedRealmConfig.hostHome = rewrittenHostHome;
          }
          writeJsonSync(
            join(publishedRealmPath, '.realm.json'),
            newlyPublishedRealmConfig,
          );

          // Clear stale modules cache for the published realm so that
          // error entries from a previous publish don't persist
          await query(dbAdapter, [
            `DELETE FROM modules WHERE resolved_realm_url =`,
            param(publishedRealmURL),
          ]);

          let lastPublishedAt = Date.now().toString();
          try {
            if (isNewRealm) {
              let { valueExpressions, nameExpressions } = asExpressions({
                id: publishedRealmId,
                owner_username: realmUsername,
                source_realm_url: sourceRealmURL,
                published_realm_url: publishedRealmURL,
                last_published_at: lastPublishedAt,
              });
              await query(
                dbAdapter,
                insert('published_realms', nameExpressions, valueExpressions),
              );
            } else {
              await query(dbAdapter, [
                `UPDATE published_realms SET last_published_at =`,
                param(lastPublishedAt),
                `WHERE published_realm_url =`,
                param(publishedRealmURL),
              ]);
            }
          } catch (dbError: any) {
            // Phase 3 PR 2 rollback simplification: no in-memory
            // realms[]/virtualNetwork state to unwind. Just remove the
            // FS swap that we just put in place.
            removeSync(publishedRealmPath);
            throw dbError;
          }

          // Mirror the published realm into realm_registry. The DELETE +
          // INSERT inside this helper emits NOTIFY realm_registry; the
          // reconciler on every instance reacts by populating
          // knownByUrl. The realm itself is lazy-mounted on first request.
          await mirrorPublishedRealmToRegistry(dbAdapter, {
            publishedRealmURL,
            publishedRealmId,
            ownerUsername: realmUsername,
            sourceRealmURL,
            lastPublishedAt: Number(lastPublishedAt),
          });

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
