import type Koa from 'koa';
import { fetchRealmPermissions, logger } from '@cardstack/runtime-common';
import RealmPermissionChecker from '@cardstack/runtime-common/realm-permission-checker';
import type { CreateRoutesArgs } from '../routes.ts';
import { normalizeRealmURL } from '../utils/realm-url.ts';
import { setContextResponse } from '../middleware/index.ts';
import { secretsKeyring } from '../lib/secrets-at-rest/index.ts';
import {
  addPlatformClient,
  cliHandoffFor,
  completeConnect,
  deletePlatformClient,
  getPlatformClient,
  listConnectableClients,
  listPlatformClients,
  replacePlatformClientSecret,
  startConnect,
  validateClientRef,
  validateCliHandoff,
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
import { operatorCaller } from './handle-system-keys.ts';

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
// mode offers the signed-in user — the realm's shared ones (when they read
// the realm), the platform's for services the realm shares none for, then
// their own — each with the permissions it asks for. With a destination,
// only those whose API hosts cover it. With
// `reconnect=<key id>`, only the client that connection signs in through.
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
    let reconnect = ctxt.query.reconnect;
    let clients = await listConnectableClients(args.dbAdapter, {
      owner,
      realmURL,
      ...(typeof reconnect === 'string' && reconnect.length > 0
        ? { reconnect }
        : {}),
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
// connection to reconnect, with a ticket to `replace` it. The CLI also names
// its loopback listener (`cli: {port, state}`), which the `connected` page
// hands the code to; only a CLI's session may name one. Answers with the
// vendor's authorization URL to send the user to.
export function handleStartConnect(args: CreateRoutesArgs): Handler {
  return keysHandler(async (ctxt) => {
    let owner = ownerOf(ctxt);
    let secureClient = await secureClientOf(ctxt, args, 'connections are made');
    let body = await readJSON(ctxt);
    let data = body.data as
      | { type?: unknown; attributes?: Record<string, unknown> }
      | undefined;
    if (!data || typeof data !== 'object' || data.type !== 'oauth-connect') {
      throw new UserKeyError(400, `the resource type is 'oauth-connect'`);
    }
    let attributes = data.attributes ?? {};
    for (let name of Object.keys(attributes)) {
      if (!['name', 'reconnect', 'client', 'cli'].includes(name)) {
        throw new UserKeyError(400, `'${name}' can't be set here`);
      }
    }
    if (attributes.cli !== undefined && secureClient !== 'cli') {
      throw new UserKeyError(
        400,
        `only the CLI's session names a listener to hand the sign-in to`,
      );
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
      ...(attributes.cli !== undefined
        ? { cli: validateCliHandoff(attributes.cli) }
        : {}),
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
// It finishes nothing itself: it hands the code and `state` on to the secure
// window's `connected` page in the URL fragment, which never reaches a
// server, and that page finishes the sign-in with its own secure session
// (`POST /_oauth/connections/complete`). So a sign-in completes only in a
// window signed in as the person who started it. Nothing the vendor issued
// beyond the one-use code reaches a browser; the code is useless without
// the PKCE verifier and client secret, which only the realm server holds.
//
// A sign-in the CLI started also names the CLI's loopback listener
// (`cli_port`, `cli_state`), read from the sign-in in progress: the page
// then hands the code, or why there is none, to the CLI, which finishes the
// sign-in with its own secure session, so the browser needs none.
export function handleOAuthCallback(args: CreateRoutesArgs): Handler {
  return async (ctxt) => {
    let { code, state, error } = ctxt.query;
    let fragment: Record<string, string> =
      error !== undefined ||
      typeof code !== 'string' ||
      typeof state !== 'string'
        ? { error: 'denied' }
        : { code, state };
    let cli =
      typeof state === 'string' && state.length > 0
        ? await cliHandoffFor(args.dbAdapter, state)
        : undefined;
    if (cli) {
      fragment.cli_port = String(cli.port);
      fragment.cli_state = cli.state;
    }
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

// `POST /_oauth/connections/complete`: the secure window's `connected` page
// finishes a sign-in with `{state, code}` from its fragment, under its own
// secure session. Only the person who started the sign-in can finish it.
// Answers the connection's id, or why it failed.
export function handleCompleteConnect(args: CreateRoutesArgs): Handler {
  return keysHandler(async (ctxt) => {
    let owner = ownerOf(ctxt);
    await secureClientOf(ctxt, args, 'connections are made');
    let body = await readJSON(ctxt);
    let data = body.data as
      | { type?: unknown; attributes?: Record<string, unknown> }
      | undefined;
    if (!data || typeof data !== 'object' || data.type !== 'oauth-callback') {
      throw new UserKeyError(400, `the resource type is 'oauth-callback'`);
    }
    let outcome;
    try {
      outcome = await completeConnect(args.dbAdapter, secretsKeyring(), {
        owner,
        state: data.attributes?.state,
        code: data.attributes?.code,
        serverURL: args.serverURL,
        serverSecret: args.realmSecretSeed,
      });
    } catch (e: any) {
      log.error(
        `completing an OAuth sign-in failed: ${e?.name ?? 'Error'}: ${e?.message ?? e}`,
      );
      outcome = { ok: false as const, error: 'failed' as const };
    }
    // A sign-in that didn't finish is an answer, not a refused request.
    await sendJSON(ctxt, outcome.ok ? 201 : 200, {
      data: {
        type: 'oauth-connection-result',
        attributes: outcome.ok
          ? { connected: outcome.keyId, reconnected: outcome.reconnected }
          : { error: outcome.error },
      },
    });
  });
}

// The operator routes for the platform's own clients, reached with an
// operator token for `system-keys`. None answers with a secret. Every change
// carries an operator note, recorded in the client's history with what the
// server observed of the caller.
export function handleListPlatformClients({ dbAdapter }: CreateRoutesArgs) {
  return keysHandler(async (ctxt) => {
    await sendJSON(ctxt, 200, {
      clients: await listPlatformClients(dbAdapter),
    });
  });
}

// The client and its recent history.
export function handleShowPlatformClient({ dbAdapter }: CreateRoutesArgs) {
  return keysHandler(async (ctxt) => {
    await sendJSON(
      ctxt,
      200,
      await getPlatformClient(dbAdapter, ctxt.params.name),
    );
  });
}

// Body: `name`, `label`, `secret`, `oauth` (the client's settings) and
// `note`.
export function handleAddPlatformClient({ dbAdapter }: CreateRoutesArgs) {
  return keysHandler(async (ctxt) => {
    let body = await readJSON(ctxt);
    let client = await addPlatformClient(dbAdapter, secretsKeyring(), {
      name: body.name,
      label: body.label,
      secret: body.secret,
      oauth: body.oauth,
      note: body.note,
      caller: operatorCaller(ctxt),
    });
    await sendJSON(ctxt, 201, { client });
  });
}

// Body: `secret` and `note`.
export function handleReplacePlatformClient({ dbAdapter }: CreateRoutesArgs) {
  return keysHandler(async (ctxt) => {
    let body = await readJSON(ctxt);
    let client = await replacePlatformClientSecret(
      dbAdapter,
      secretsKeyring(),
      {
        name: ctxt.params.name,
        secret: body.secret,
        note: body.note,
        caller: operatorCaller(ctxt),
      },
    );
    await sendJSON(ctxt, 200, { client });
  });
}

// Body: `note`. A DELETE sent with no body gets the missing-note refusal.
export function handleDeletePlatformClient({ dbAdapter }: CreateRoutesArgs) {
  return keysHandler(async (ctxt) => {
    let body = await readJSON(ctxt, { emptyIsObject: true });
    await deletePlatformClient(dbAdapter, secretsKeyring(), {
      name: ctxt.params.name,
      note: body.note,
      caller: operatorCaller(ctxt),
    });
    await sendJSON(ctxt, 200, { deleted: ctxt.params.name });
  });
}
