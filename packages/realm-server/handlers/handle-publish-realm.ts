import Koa from 'koa';
import {
  query,
  SupportedMimeType,
  logger,
  createResponse,
  DEFAULT_PERMISSIONS,
  getMatrixUsername,
  insertPermissions,
  insert,
  asExpressions,
  param,
  PUBLISHED_DIRECTORY_NAME,
  type PublishedRealmTable,
  fetchUserPermissions,
  uuidv4,
} from '@cardstack/runtime-common';
import { ensureDirSync, copySync } from 'fs-extra';
import { resolve, join } from 'path';
import {
  fetchRequestFromContext,
  sendResponseForBadRequest,
  sendResponseForForbiddenRequest,
  sendResponseForSystemError,
  setContextResponse,
} from '../middleware';
import { type CreateRoutesArgs } from '../routes';
import { RealmServerTokenClaim } from '../utils/jwt';
import { registerUser } from '../synapse';
import { passwordFromSeed } from '@cardstack/runtime-common/matrix-client';

const log = logger('handle-publish');

export default function handlePublishRealm({
  serverURL,
  dbAdapter,
  matrixClient,
  realmSecretSeed,
  virtualNetwork,
  realms,
  realmsRootPath,
  getMatrixRegistrationSecret,
  createAndMountRealm,
  defaultPublishedRealmDomain,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  async function publishRealm({
    ownerUserId,
    sourceRealmURL,
    publishedRealmURL,
  }: {
    ownerUserId: string;
    sourceRealmURL: string;
    publishedRealmURL: string;
  }) {
    let sourceRealm = realms.find((r) => r.url === sourceRealmURL);
    if (!sourceRealm) {
      throw new Error(`Source realm ${sourceRealmURL} not found`);
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

      let lastPublishedAt = new Date().toISOString();
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
        last_published_at: new Date(),
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
        [userId]: DEFAULT_PERMISSIONS,
        [ownerUserId]: DEFAULT_PERMISSIONS,
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

    if (existingPublishedRealm) {
      virtualNetwork.unmount(existingPublishedRealm.handle);
    }
    let realm = createAndMountRealm(
      publishedRealmPath,
      publishedRealmURL,
      realmUsername,
      new URL(sourceRealmURL),
    );
    return {
      realm,
      ...publishedRealmData,
    };
  }

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
      await sendResponseForBadRequest(ctxt, 'sourceRealmURL');
      return;
    }

    let sourceRealmURL = json.sourceRealmURL.endsWith('/')
      ? json.sourceRealmURL
      : `${json.sourceRealmURL}/`;
    let publishedRealmURL =
      json.publishedRealmURL && !json.publishedRealmURL.endsWith('/')
        ? `${json.publishedRealmURL}/`
        : json.publishedRealmURL;

    let { user: ownerUserId } = token;
    let permissions = await fetchUserPermissions(
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

    let ownerUsername = getMatrixUsername(ownerUserId);

    try {
      publishedRealmURL =
        publishedRealmURL ??
        createPublishedRealmURL(
          ownerUsername,
          new URL(serverURL),
          new URL(sourceRealmURL),
          defaultPublishedRealmDomain,
        );
    } catch (e: any) {
      await sendResponseForBadRequest(ctxt, e.message);
      return;
    }

    try {
      let result = await publishRealm({
        ownerUserId,
        sourceRealmURL,
        publishedRealmURL,
      });
      await result.realm.start();

      let response = createResponse({
        body: JSON.stringify(
          {
            data: {
              type: 'published_realm',
              id: result.id,
              attributes: {
                sourceRealmURL: result.source_realm_url,
                publishedRealmURL: result.published_realm_url,
                lastPublishedAt: result.last_published_at,
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
          realm: result.realm,
          permissions: {
            [ownerUserId]: DEFAULT_PERMISSIONS,
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

function createPublishedRealmURL(
  ownerUsername: string,
  _serverURL: URL,
  sourceRealmURL: URL,
  defaultPublishedRealmDomain?: string,
) {
  let sourceRealmName = sourceRealmURL.pathname
    .split('/')
    .filter((p) => p !== '')
    .pop();
  if (!sourceRealmName) {
    throw new Error('Could not determine source realm name');
  }

  let serverURL = new URL(_serverURL);
  let hostname = defaultPublishedRealmDomain || serverURL.hostname;
  let isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';
  return isLocalhost
    ? `${serverURL.protocol}//${ownerUsername}.${hostname}:${serverURL.port}/${sourceRealmName}/`
    : `${serverURL.protocol}//${ownerUsername}.${hostname}/${sourceRealmName}/`;
}
