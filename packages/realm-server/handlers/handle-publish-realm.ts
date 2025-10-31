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
  type PublishedRealmTable,
  fetchRealmPermissions,
  uuidv4,
} from '@cardstack/runtime-common';
import { ensureDirSync, copySync, readJsonSync, writeJsonSync } from 'fs-extra';
import { resolve, join } from 'path';
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

export default function handlePublishRealm({
  dbAdapter,
  matrixClient,
  realmSecretSeed,
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

    let sourceRealmURL: string = json.sourceRealmURL.endsWith('/')
      ? json.sourceRealmURL
      : `${json.sourceRealmURL}/`;
    let publishedRealmURL = json.publishedRealmURL.endsWith('/')
      ? json.publishedRealmURL
      : `${json.publishedRealmURL}/`;

    let validPublishedRealmDomains = Object.values(
      domainsForPublishedRealms || {},
    );
    try {
      let publishedURL = new URL(publishedRealmURL);
      if (validPublishedRealmDomains && validPublishedRealmDomains.length > 0) {
        let isValidDomain = validPublishedRealmDomains.some((domain) =>
          publishedURL.host.endsWith(domain),
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

    let { user: ownerUserId, sessionRoom: tokenSessionRoom } = token;
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
        },
        '1h',
        realmSecretSeed,
      );

      let realmInfoResponse = await virtualNetwork.handle(
        new Request(`${sourceRealmURL}_info`, {
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

      let pathNameParts = new URL(sourceRealmURL).pathname
        .split('/')
        .filter((p) => p);
      if (pathNameParts.length < 1) {
        throw new Error('Could not determine source realm folder');
      }
      let sourceRealmPath = resolve(join(realmsRootPath, ...pathNameParts));
      let publishedDir = join(realmsRootPath, PUBLISHED_DIRECTORY_NAME);
      let publishedRealmPath = join(publishedDir, publishedRealmData.id);
      copySync(sourceRealmPath, publishedRealmPath);
      ensureDirSync(publishedRealmPath);

      let newlyPublishedRealmConfig = readJsonSync(
        join(publishedRealmPath, '.realm.json'),
      );
      newlyPublishedRealmConfig.publishable = false;
      writeJsonSync(
        join(publishedRealmPath, '.realm.json'),
        newlyPublishedRealmConfig,
      );

      if (existingPublishedRealm) {
        realms.splice(realms.indexOf(existingPublishedRealm), 1);
        virtualNetwork.unmount(existingPublishedRealm.handle);
      }
      let realm = createAndMountRealm(
        publishedRealmPath,
        publishedRealmURL,
        realmUsername,
        new URL(sourceRealmURL),
        false,
      );
      await realm.start();

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
