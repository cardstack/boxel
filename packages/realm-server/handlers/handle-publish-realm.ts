import type Koa from 'koa';
import {
  fetchUserPermissions,
  query,
  SupportedMimeType,
  logger,
  createResponse,
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
} from '@cardstack/runtime-common';
import { getPublishedRealmDomainOverrides } from '@cardstack/runtime-common/constants';
import { ensureDirSync, copySync, readJsonSync, writeJsonSync } from 'fs-extra';
import { join } from 'path';
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
  realmSecretSeed,
  serverURL,
  virtualNetwork,
  realms,
  realmsRootPath,
  getMatrixRegistrationSecret,
  createAndMountRealm,
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

      let existingPublishedRealm = realms.find(
        (r) => r.url === publishedRealmURL,
      );

      let userId;
      let realmUsername;
      let publishedRealmData: PublishedRealmTable | undefined;
      if (existingPublishedRealm) {
        let results = (await query(dbAdapter, [
          `SELECT * FROM published_realms WHERE published_realm_url =`,
          param(publishedRealmURL),
        ])) as Pick<
          PublishedRealmTable,
          | 'id'
          | 'owner_username'
          | 'source_realm_url'
          | 'published_realm_url'
          | 'last_published_at'
        >[];
        publishedRealmData = results[0];
        realmUsername = `realm/${PUBLISHED_DIRECTORY_NAME}_${publishedRealmData.id}`;

        let lastPublishedAt = Date.now().toString();
        await query(dbAdapter, [
          `UPDATE published_realms SET last_published_at =`,
          param(lastPublishedAt),
          `WHERE published_realm_url =`,
          param(publishedRealmURL),
        ]);
        publishedRealmData.last_published_at = lastPublishedAt;
      } else {
        let publishedRealmId = uuidv4();
        realmUsername = `realm/${PUBLISHED_DIRECTORY_NAME}_${publishedRealmId}`;
        let { valueExpressions, nameExpressions } = asExpressions({
          id: publishedRealmId,
          owner_username: realmUsername,
          source_realm_url: sourceRealmURL,
          published_realm_url: publishedRealmURL,
          last_published_at: Date.now().toString(),
        });

        let results = (await query(
          dbAdapter,
          insert('published_realms', nameExpressions, valueExpressions),
        )) as Pick<
          PublishedRealmTable,
          | 'id'
          | 'owner_username'
          | 'source_realm_url'
          | 'published_realm_url'
          | 'last_published_at'
        >[];
        publishedRealmData = results[0];

        let { userId: newUserId } = await registerUser({
          matrixURL: matrixClient.matrixURL,
          displayname: realmUsername,
          username: realmUsername,
          password: await passwordFromSeed(realmUsername, realmSecretSeed),
          registrationSecret: await getMatrixRegistrationSecret(),
        });
        userId = newUserId;

        await insertPermissions(dbAdapter, new URL(publishedRealmURL), {
          [userId]: ['read', 'realm-owner'],
          [ownerUserId]: ['read', 'realm-owner'],
          '*': ['read'],
        });
      }
      log.debug(
        `created realm bot user '${userId}' for new realm ${publishedRealmURL}`,
      );

      let sourceRealm = realms.find((r) => r.url === sourceRealmURL);
      if (!sourceRealm?.dir) {
        throw new Error(
          `Could not determine filesystem path for source realm ${sourceRealmURL}`,
        );
      }
      let sourceRealmPath = sourceRealm.dir;
      let publishedDir = join(realmsRootPath, PUBLISHED_DIRECTORY_NAME);
      let publishedRealmPath = join(publishedDir, publishedRealmData.id);
      copySync(sourceRealmPath, publishedRealmPath);
      ensureDirSync(publishedRealmPath);

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

      if (existingPublishedRealm) {
        realms.splice(realms.indexOf(existingPublishedRealm), 1);
        virtualNetwork.unmount(existingPublishedRealm.handle);
      }

      // Clear stale modules cache for the published realm so that
      // error entries from a previous publish don't persist
      await query(dbAdapter, [
        `DELETE FROM modules WHERE resolved_realm_url =`,
        param(publishedRealmURL),
      ]);

      let realm = createAndMountRealm(
        publishedRealmPath,
        publishedRealmURL,
        realmUsername,
        new URL(sourceRealmURL),
        false,
      );
      await realm.start();

      // reindexing is to ensure that prerendered templates that get copied over
      // to the published realm get regenerated - we want this so that the
      // places in the templates that refer to model.id are updated to the new
      // published realm URL (for example in the og:url meta tag).
      await realm.fullIndex();

      let response = createResponse({
        body: JSON.stringify(
          {
            data: {
              type: 'published_realm',
              id: publishedRealmData.id,
              attributes: {
                sourceRealmURL: publishedRealmData.source_realm_url,
                publishedRealmURL: publishedRealmData.published_realm_url,
                lastPublishedAt: publishedRealmData.last_published_at,
              },
            },
          },
          null,
          2,
        ),
        init: {
          status: 201,
          headers: {
            'content-type': SupportedMimeType.JSONAPI,
          },
        },
        requestContext: {
          realm: realm,
          permissions: {
            [ownerUserId]: ['read'],
          },
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
