import type Koa from 'koa';
import { fetchRealmPermissions, logger } from '@cardstack/runtime-common';
import RealmPermissionChecker from '@cardstack/runtime-common/realm-permission-checker';
import type { CreateRoutesArgs } from '../routes.ts';
import { normalizeRealmURL } from '../utils/realm-url.ts';
import { setContextResponse } from '../middleware/index.ts';
import { secretsKeyring } from '../lib/secrets-at-rest/index.ts';
import {
  addPlatformClient,
  completeConnect,
  deletePlatformClient,
  listConnectableClients,
  listPlatformClients,
  replacePlatformClientSecret,
  startConnect,
  validateClientRef,
} from '../lib/oauth.ts';
import { normalizeGrantDestination } from '../lib/user-key-grants.ts';
import { UserKeyError } from '../lib/user-keys.ts';
import {
  keysHandler,
  ownerOf,
  readJSON,
  sendJSON,
  ticketOf,
} from './handle-user-keys.ts';
import { secureClientOf } from './handle-user-key-grants.ts';

// The OAuth routes: which clients a person may connect through, starting a
// sign-in through one from the secure window, and the realm server's callback
// the vendor sends the person back to. What a client and a connection are,
// and how their tokens are minted, is set out in `lib/oauth.ts`. These routes
// are key routes: the request log and telemetry keep only their method and
// path, never the query string the callback's code arrives in.

const log = logger('realm:oauth');

type Handler = (ctxt: Koa.Context, next: Koa.Next) => Promise<void>;

async function readsRealm(
  { dbAdapter, matrixClient }: CreateRoutesArgs,
  user: string,
  realmURL: string,
): Promise<boolean> {
  let url = normalizeRealmURL(realmURL);
  if (!url) {
    return false;
  }
  return await new RealmPermissionChecker(
    await fetchRealmPermissions(dbAdapter, url),
    matrixClient,
  ).can(user, 'read');
}

// `GET /_oauth/clients?realm=<url>&destination=<url>`: the clients connect
// mode offers the signed-in user — the platform's, the realm's shared ones
// (when they read the realm) and their own — each with the permissions it
// asks for. With a destination, only those whose API hosts cover it.
export function handleListConnectableClients(args: CreateRoutesArgs): Handler {
  return keysHandler(async (ctxt) => {
    let owner = ownerOf(ctxt);
    let realm = ctxt.query.realm;
    let destination = ctxt.query.destination;
    let realmURL: string | undefined;
    if (typeof realm === 'string' && realm.length > 0) {
      let url = normalizeRealmURL(realm);
      if (!url || !(await readsRealm(args, owner, url.href))) {
        throw new UserKeyError(404, 'no such realm');
      }
      realmURL = url.href;
    }
    let clients = await listConnectableClients(args.dbAdapter, {
      owner,
      realmURL,
      destination:
        typeof destination === 'string' && destination.length > 0
          ? normalizeGrantDestination(destination)
          : undefined,
    });
    await sendJSON(ctxt, 200, {
      data: clients.map((client) => ({
        type: 'oauth-client',
        attributes: client,
      })),
    });
  });
}

// `POST /_oauth/connections`: starts a sign-in through a client, from the
// secure window or the CLI with a secure-origin session. The body names the
// client and either the new connection's name, with a ticket to `add`, or the
// connection to reconnect, with a ticket to `replace` it. Answers with the
// vendor's authorization URL to send the user to.
export function handleStartConnect(args: CreateRoutesArgs): Handler {
  return keysHandler(async (ctxt) => {
    let owner = ownerOf(ctxt);
    await secureClientOf(ctxt, args, 'connections are made');
    let body = await readJSON(ctxt);
    let data = body.data as
      | { type?: unknown; attributes?: Record<string, unknown> }
      | undefined;
    if (!data || typeof data !== 'object' || data.type !== 'oauth-connect') {
      throw new UserKeyError(400, `the resource type is 'oauth-connect'`);
    }
    let attributes = data.attributes ?? {};
    for (let name of Object.keys(attributes)) {
      if (!['name', 'reconnect', 'client'].includes(name)) {
        throw new UserKeyError(400, `'${name}' can't be set here`);
      }
    }
    let started = await startConnect(args.dbAdapter, secretsKeyring(), {
      owner,
      ...(attributes.reconnect !== undefined
        ? { reconnect: attributes.reconnect }
        : { name: attributes.name }),
      client: validateClientRef(attributes.client),
      ticket: ticketOf(body),
      serverURL: args.serverURL,
      serverSecret: args.realmSecretSeed,
      mayUseShare: (realmURL) => readsRealm(args, owner, realmURL),
    });
    await sendJSON(ctxt, 201, {
      data: {
        type: 'oauth-connect',
        attributes: {
          authorizeUrl: started.authorizeURL,
          expiresAt: started.expiresAt,
        },
      },
    });
  });
}

// `GET /_oauth/callback?code&state`: where the vendor sends the person back.
// The code is exchanged here, on the server, and the person is sent on to the
// secure window's `connected` page, told in the fragment only the new
// connection's id or why it failed. Nothing a vendor issued goes to a
// browser.
export function handleOAuthCallback(args: CreateRoutesArgs): Handler {
  return async (ctxt) => {
    let outcome;
    try {
      outcome = await completeConnect(args.dbAdapter, secretsKeyring(), {
        state: ctxt.query.state,
        code: ctxt.query.code,
        vendorError: ctxt.query.error,
        serverURL: args.serverURL,
        serverSecret: args.realmSecretSeed,
      });
    } catch (e: any) {
      log.error(
        `completing an OAuth sign-in failed: ${e?.name ?? 'Error'}: ${e?.message ?? e}`,
      );
      outcome = { ok: false as const, error: 'failed' as const };
    }
    let fragment: Record<string, string> = outcome.ok
      ? { connected: outcome.keyId }
      : { error: outcome.error };
    let page = args.secureOriginURL
      ? `${args.secureOriginURL.href.replace(/\/*$/, '/')}connected`
      : new URL('/', args.serverURL).href;
    let target = `${page}#${new URLSearchParams(fragment)}`;
    await setContextResponse(
      ctxt,
      new Response(null, {
        status: 302,
        headers: {
          Location: target,
          'Cache-Control': 'no-store',
          'Referrer-Policy': 'no-referrer',
        },
      }),
    );
  };
}

// The operator routes for the platform's own clients, reached with an
// operator token for `system-keys`. None answers with a secret.
export function handleListPlatformClients({ dbAdapter }: CreateRoutesArgs) {
  return keysHandler(async (ctxt) => {
    await sendJSON(ctxt, 200, {
      clients: await listPlatformClients(dbAdapter),
    });
  });
}

// Body: `name`, `label`, `secret` and `oauth` (the client's settings).
export function handleAddPlatformClient({ dbAdapter }: CreateRoutesArgs) {
  return keysHandler(async (ctxt) => {
    let body = await readJSON(ctxt);
    let client = await addPlatformClient(dbAdapter, secretsKeyring(), {
      name: body.name,
      label: body.label,
      secret: body.secret,
      oauth: body.oauth,
    });
    await sendJSON(ctxt, 201, { client });
  });
}

// Body: `secret`.
export function handleReplacePlatformClient({ dbAdapter }: CreateRoutesArgs) {
  return keysHandler(async (ctxt) => {
    let body = await readJSON(ctxt);
    let client = await replacePlatformClientSecret(
      dbAdapter,
      secretsKeyring(),
      { name: ctxt.params.name, secret: body.secret },
    );
    await sendJSON(ctxt, 200, { client });
  });
}

export function handleDeletePlatformClient({ dbAdapter }: CreateRoutesArgs) {
  return keysHandler(async (ctxt) => {
    await deletePlatformClient(dbAdapter, ctxt.params.name);
    await sendJSON(ctxt, 200, { deleted: ctxt.params.name });
  });
}
