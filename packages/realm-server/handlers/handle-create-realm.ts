import { RealmServerTokenClaim } from '../utils/jwt';
import {
  fetchRequestFromContext,
  sendResponseForBadRequest,
  sendResponseForSystemError,
  setContextResponse,
} from '../middleware';
import Koa from 'koa';
import {
  createResponse,
  logger,
  Realm,
  RealmPermissions,
  SupportedMimeType,
} from '@cardstack/runtime-common';
import * as Sentry from '@sentry/node';
import { CreateRoutesArgs } from '../routes';

interface RealmCreationJSON {
  data: {
    type: 'realm';
    attributes: {
      endpoint: string;
      name: string;
      backgroundURL?: string;
      iconURL?: string;
    };
  };
}

const log = logger('realm-server');
const DEFAULT_PERMISSIONS = Object.freeze([
  'read',
  'write',
  'realm-owner',
]) as RealmPermissions['user'];

export default function handleCreateRealmRequest({
  createRealm,
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

    let { user: ownerUserId } = token;
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
    try {
      assertIsRealmCreationJSON(json);
    } catch (e: any) {
      await sendResponseForBadRequest(
        ctxt,
        `Request body is not valid JSON-API - ${e.message}`,
      );
      return;
    }

    let realm: Realm | undefined;
    let start = Date.now();
    let indexStart: number | undefined;
    try {
      realm = await createRealm({
        ownerUserId,
        ...json.data.attributes,
      });
      log.debug(`created new realm ${realm.url} in ${Date.now() - start} ms`);
      log.debug(`indexing new realm ${realm.url}`);
      indexStart = Date.now();
      await realm.start();
    } catch (e: any) {
      if ('status' in e && e.status === 400) {
        await sendResponseForBadRequest(ctxt, e.message);
      } else {
        log.error(
          `Error creating realm '${json.data.attributes.name}' for user ${ownerUserId}`,
          e,
        );
        await sendResponseForSystemError(ctxt, `${e.message}: at ${e.stack}`);
      }
      return;
    } finally {
      if (realm != null && indexStart != null) {
        log.debug(
          `indexing of new realm ${realm.url} ended in ${
            Date.now() - indexStart
          } ms`,
        );
      }

      let creationTimeMs = Date.now() - start;
      if (creationTimeMs > 15_000) {
        let msg = `it took a long time, ${creationTimeMs} ms, to create realm for ${ownerUserId}, ${JSON.stringify(
          json.data.attributes,
        )}`;
        console.error(msg);
        Sentry.captureMessage(msg);
      }
    }

    let response = createResponse({
      body: JSON.stringify(
        {
          data: {
            type: 'realm',
            id: realm.url,
            attributes: { ...json.data.attributes },
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
        realm,
        permissions: {
          [ownerUserId]: DEFAULT_PERMISSIONS,
        },
      },
    });
    await setContextResponse(ctxt, response);
    return;
  };
}

function assertIsRealmCreationJSON(
  json: any,
): asserts json is RealmCreationJSON {
  if (typeof json !== 'object') {
    throw new Error(`json must be an object`);
  }
  if (!('data' in json) || typeof json.data !== 'object') {
    throw new Error(`json is missing "data" object`);
  }
  let { data } = json;
  if (!('type' in data) || data.type !== 'realm') {
    throw new Error('json.data.type must be "realm"');
  }
  if (!('attributes' in data || typeof data.attributes !== 'object')) {
    throw new Error(`json.data is missing "attributes" object`);
  }
  let { attributes } = data;
  if (!('name' in attributes) || typeof attributes.name !== 'string') {
    throw new Error(
      `json.data.attributes.name is required and must be a string`,
    );
  }
  if (!('endpoint' in attributes) || typeof attributes.endpoint !== 'string') {
    throw new Error(
      `json.data.attributes.endpoint is required and must be a string`,
    );
  }
  if (
    'backgroundURL' in attributes &&
    typeof attributes.backgroundURL !== 'string'
  ) {
    throw new Error(`json.data.attributes.backgroundURL must be a string`);
  }
  if ('iconURL' in attributes && typeof attributes.iconURL !== 'string') {
    throw new Error(`json.data.attributes.iconURL must be a string`);
  }
}
