import type Koa from 'koa';
import { resolve, join } from 'path';
import { ensureDirSync, writeJSONSync } from 'fs-extra';
import * as Sentry from '@sentry/node';
import type {
  DBAdapter,
  Realm,
  RealmInfo,
  VirtualNetwork,
} from '@cardstack/runtime-common';
import {
  createResponse,
  DEFAULT_PERMISSIONS,
  insertPermissions,
  logger,
  param,
  query,
  SupportedMimeType,
  userInitiatedPriority,
} from '@cardstack/runtime-common';
import { getMatrixUsername } from '@cardstack/runtime-common/matrix-client';
import { insertSourceRealmInRegistry } from '../lib/realm-registry-writes';
import type { RealmRegistryReconciler } from '../lib/realm-registry-reconciler';
import {
  fetchRequestFromContext,
  sendResponseForBadRequest,
  sendResponseForSystemError,
  setContextResponse,
} from '../middleware';
import type { RealmServerTokenClaim } from '../utils/jwt';

const log = logger('realm-server');

export type CreateRealmDeps = {
  serverURL: URL;
  realms: Realm[];
  dbAdapter: DBAdapter;
  virtualNetwork: VirtualNetwork;
  realmsRootPath: string;
  reconciler: RealmRegistryReconciler;
};

export type CreateRealmInput = {
  // matrix userIDs look like "@mango:boxel.ai"
  ownerUserId: string;
  endpoint: string;
  name: string;
  backgroundURL?: string;
  iconURL?: string;
};

export type CreateRealmResult = {
  url: string;
  realm: Realm;
  info: Partial<RealmInfo>;
};

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

export async function createRealm(
  deps: CreateRealmDeps,
  { ownerUserId, endpoint, name, backgroundURL, iconURL }: CreateRealmInput,
): Promise<CreateRealmResult> {
  let {
    serverURL,
    realms,
    dbAdapter,
    virtualNetwork,
    realmsRootPath,
    reconciler,
  } = deps;

  // Server-root collision check. Read realms[] AND realm_registry —
  // every production realm has a registry row, but test fixtures
  // construct CLI-style realms via runTestRealmServer that don't
  // mirror to the registry. Either source matching the origin is a
  // collision.
  let serverRootUrl = serverURL.origin + '/';
  let realmAtServerRoot = realms.find((r) => {
    let realmUrl = new URL(r.url);
    return (
      realmUrl.href.replace(/\/$/, '') === realmUrl.origin &&
      realmUrl.hostname === serverURL.hostname
    );
  });
  if (realmAtServerRoot) {
    throw errorWithStatus(
      400,
      `Cannot create a realm: a realm is already mounted at the origin of this server: ${realmAtServerRoot.url}`,
    );
  }
  let serverRootRows = (await query(dbAdapter, [
    `SELECT url FROM realm_registry WHERE url =`,
    param(serverRootUrl),
  ])) as { url: string }[];
  if (serverRootRows.length > 0) {
    throw errorWithStatus(
      400,
      `Cannot create a realm: a realm is already mounted at the origin of this server: ${serverRootRows[0].url}`,
    );
  }
  if (!endpoint.match(/^[a-z0-9-]+$/)) {
    throw errorWithStatus(
      400,
      `realm endpoint '${endpoint}' contains invalid characters`,
    );
  }

  let ownerUsername = getMatrixUsername(ownerUserId);
  let url = new URL(
    `${serverURL.pathname.replace(/\/$/, '')}/${ownerUsername}/${endpoint}/`,
    serverURL,
  ).href;

  let existingRows = (await query(dbAdapter, [
    `SELECT url FROM realm_registry WHERE url =`,
    param(url),
  ])) as { url: string }[];
  if (existingRows.length > 0) {
    throw errorWithStatus(400, `realm '${url}' already exists on this server`);
  }

  let realmPath = resolve(join(realmsRootPath, ownerUsername, endpoint));
  ensureDirSync(realmPath);

  let info: Partial<RealmInfo> = {
    name,
    ...(iconURL ? { iconURL } : {}),
    ...(backgroundURL ? { backgroundURL } : {}),
    publishable: true,
  };

  // Serialize against any other caller of withWriteLock for this
  // same URL (concurrent createRealm for the same endpoint, or a
  // concurrent publish/unpublish/delete). This is almost never a real
  // concurrency concern — the endpoint was already checked above for
  // collision.
  await dbAdapter.withWriteLock(url, async () => {
    await insertPermissions(dbAdapter, new URL(url), {
      [ownerUserId]: DEFAULT_PERMISSIONS,
    });

    // CS-10053: publishable lives in realm_metadata now, not the
    // sidecar. The legacy .realm.json is no longer written here, and
    // a fresh realm has no hostRoutingRules / hostHome to seed (host
    // mode picks them up from the realm.json card once an operator
    // sets one via /_config). Reset all mutable metadata columns on
    // conflict so a stale row (e.g. left over from a previous realm
    // at the same URL whose delete didn't clean up) doesn't bleed
    // into the new realm.
    await query(dbAdapter, [
      `INSERT INTO realm_metadata (url, publishable, show_as_catalog) VALUES (`,
      param(url),
      `,`,
      param(true),
      `,`,
      param(null),
      `) ON CONFLICT (url) DO UPDATE SET publishable = true, show_as_catalog = NULL, updated_at = now()`,
    ]);
    writeJSONSync(join(realmPath, 'realm.json'), {
      data: {
        type: 'card',
        attributes: {
          cardInfo: { name },
          ...(iconURL ? { iconURL } : {}),
          ...(backgroundURL ? { backgroundURL } : {}),
        },
        meta: {
          adoptsFrom: {
            module: 'https://cardstack.com/base/realm-config',
            name: 'RealmConfig',
          },
        },
      },
    });
    writeJSONSync(join(realmPath, 'index.json'), {
      data: {
        type: 'card',
        meta: {
          adoptsFrom: {
            module: 'https://cardstack.com/base/cards-grid',
            name: 'CardsGrid',
          },
        },
      },
    });

    // Register the source realm in realm_registry. The INSERT emits
    // NOTIFY realm_registry; the reconciler on every instance picks
    // up the row, and the realm is lazy-mounted on first request.
    await insertSourceRealmInRegistry(dbAdapter, {
      url,
      diskId: `${ownerUsername}/${endpoint}`,
      ownerUsername,
    });
  });

  // virtualNetwork URL mapping was historically bridged here so a
  // virtual realm URL (e.g. cardstack.com/base/) routed to the
  // physical localhost URL. For dynamically-created realms via
  // /_create-realm, the URL is already a physical
  // serverURL-rooted URL (no remap needed), but preserve the
  // detection-and-add for any environment that maps it.
  let actualRealmURL = virtualNetwork.mapURL(url, 'virtual-to-real');
  if (actualRealmURL && actualRealmURL.href !== url) {
    virtualNetwork.addURLMapping(new URL(url), actualRealmURL);
  }

  // Mount the realm on the *handling* instance and let the mount
  // pipeline itself drive the one-and-only from-scratch-index, at
  // userInitiatedPriority so a backed-up queue of system-priority
  // jobs (e.g. a deploy-triggered reindex storm) does not stall realm
  // creation. lookupOrMount → ensureMounted → realm.start → #startup
  // sees `isNewIndex = true` for a freshly-registered realm and
  // enqueues exactly one job via publishFullIndex, which also updates
  // the realm's in-memory #stats / #ignoreData / #ignoreDataVersion
  // when the job completes.
  //
  // The 202 response with status:'pending' is for sibling instances —
  // they pick up the realm via NOTIFY realm_registry and lazy-mount
  // on first request. Mounting eagerly here also drains the queue
  // locally so the test framework's teardown (close server → drain
  // runner → close DB) doesn't race a worker mid-fetch on the now-
  // closed HTTP listener.
  let realm = await reconciler.lookupOrMount(url, {
    fromScratchIndexPriority: userInitiatedPriority,
  });
  if (!realm) {
    throw new Error(
      `expected realm ${url} to be mounted after createRealm — registry row missing or mount failed`,
    );
  }

  return { url, realm, info };
}

export default function handleCreateRealmRequest(
  deps: CreateRealmDeps,
): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
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

    let url: string | undefined;
    let realm: Realm | undefined;
    let info: Partial<RealmInfo> | undefined;
    let start = Date.now();
    try {
      let result = await createRealm(deps, {
        ownerUserId,
        ...json.data.attributes,
      });
      url = result.url;
      realm = result.realm;
      info = result.info;
      log.debug(`created new realm ${url} in ${Date.now() - start} ms`);
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
      let creationTimeMs = Date.now() - start;
      if (creationTimeMs > 30_000) {
        let msg = `it took a long time, ${creationTimeMs} ms, to create realm for ${ownerUserId}, ${JSON.stringify(
          json.data.attributes,
        )}`;
        console.error(msg);
        Sentry.captureMessage(msg);
      }
    }

    // Phase 3 PR 2: createRealm wrote the realm directory + the
    // realm_registry row, then mounted + started the realm via the
    // reconciler so it's fully indexed on this instance. The 202 +
    // status:'pending' is for sibling instances — they pick up the
    // realm via NOTIFY realm_registry and lazy-mount on first
    // request. Clients should poll /<url>/_readiness-check before
    // treating the realm as ready globally.
    let response = createResponse({
      body: JSON.stringify(
        {
          data: {
            type: 'realm',
            id: url,
            attributes: {
              ...json.data.attributes,
              ...info,
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

function errorWithStatus(
  status: number,
  message: string,
): Error & { status: number } {
  let error = new Error(message);
  (error as Error & { status: number }).status = status;
  return error as Error & { status: number };
}
