import type Koa from 'koa';
import { logger, SupportedMimeType } from '@cardstack/runtime-common';
import {
  sendResponseForError,
  setContextResponse,
} from '../middleware/index.ts';
import type { RealmServerTokenClaim } from '../utils/jwt.ts';
import type { CreateRoutesArgs } from '../routes.ts';
import { secretsKeyring } from '../lib/secrets-at-rest/index.ts';
import { isSecureSession } from '../lib/secure-session.ts';
import {
  addUserKey,
  deleteUserKey,
  getUserKey,
  listUserKeys,
  mintKeyWriteTicket,
  replaceUserKeyValue,
  UserKeyError,
  validateKeyWriteTarget,
  type UserKeyMetadata,
} from '../lib/user-keys.ts';
import {
  listKeyGrants,
  listOwnerGrants,
  type UserKeyGrant,
} from '../lib/user-key-grants.ts';

// The management API for the signed-in user's own keys. The shares API
// (`handle-key-shares.ts`) answers with the same helpers. Every route answers
// for the token's user alone, and no route returns a key's value. Adding,
// replacing and deleting a key each take a key write ticket minted for that
// change. A request body
// here can carry a value or a ticket, so nothing here logs a body, and the
// request log and telemetry keep only the method and path of these routes.

const log = logger('realm:user-keys');

// Large enough for any value a key may hold, with its JSON:API envelope.
const MAX_BODY_LENGTH = 64 * 1024;

type Handler = (ctxt: Koa.Context, next: Koa.Next) => Promise<void>;

interface KeyRequestBody {
  data?: {
    type?: unknown;
    attributes?: Record<string, unknown>;
  };
  meta?: Record<string, unknown>;
}

// The attributes a request may set.
const ADD_ATTRIBUTES = new Set(['name', 'kind', 'value']);
const REPLACE_ATTRIBUTES = new Set(['value']);

function serialize(key: UserKeyMetadata) {
  let { id, ...attributes } = key;
  return { type: 'user-key', id, attributes };
}

// A key's metadata as listed and shown, with the destinations it may be sent
// to: its grants.
function serializeWithGrants(key: UserKeyMetadata, grants: UserKeyGrant[]) {
  let serialized = serialize(key);
  return {
    ...serialized,
    attributes: {
      ...serialized.attributes,
      grants: grants.map(
        ({ id, destination, state, approvedAt, approvedVia }) => ({
          id,
          destination,
          state,
          approvedAt,
          approvedVia,
        }),
      ),
    },
  };
}

export async function sendJSON(
  ctxt: Koa.Context,
  status: number,
  body: unknown,
) {
  await setContextResponse(
    ctxt,
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': SupportedMimeType.JSONAPI },
    }),
  );
}

// The signed-in user. Keys are managed only in the user's own session. The
// session check ahead of these routes already refuses a delegated session; a
// realm-authority session is a realm acting on its own authority, not the
// user, so it is refused here.
export function ownerOf(ctxt: Koa.Context): string {
  let token = ctxt.state.token as RealmServerTokenClaim | undefined;
  if (!token?.user) {
    throw new UserKeyError(403, 'keys are managed by a signed-in user');
  }
  if (token.realmAuthority) {
    throw new UserKeyError(
      403,
      'keys are managed only in their owner’s own session',
    );
  }
  return token.user;
}

// Reads the body, refusing one larger than MAX_BODY_LENGTH as soon as its
// declared length or the bytes received so far exceed it, so an oversized
// body is never buffered whole.
async function readRawBody(ctxt: Koa.Context): Promise<string> {
  let declared = Number(ctxt.get('Content-Length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_LENGTH) {
    throw new UserKeyError(413, 'the request body is too large');
  }
  let chunks: Buffer[] = [];
  let received = 0;
  for await (let chunk of ctxt.req) {
    let buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    received += buffer.length;
    if (received > MAX_BODY_LENGTH) {
      throw new UserKeyError(413, 'the request body is too large');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function readJSON(
  ctxt: Koa.Context,
): Promise<Record<string, unknown>> {
  let raw = await readRawBody(ctxt);
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new UserKeyError(400, 'the request body is not valid JSON');
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    throw new UserKeyError(400, 'the request body is not a JSON object');
  }
  return json as Record<string, unknown>;
}

export function ticketOf(body: { meta?: unknown }): unknown {
  let meta = body.meta;
  return meta && typeof meta === 'object'
    ? (meta as Record<string, unknown>).ticket
    : undefined;
}

async function readBody(ctxt: Koa.Context): Promise<KeyRequestBody> {
  let json = await readJSON(ctxt);
  if (
    !json ||
    typeof json !== 'object' ||
    !('data' in json) ||
    !json.data ||
    typeof json.data !== 'object'
  ) {
    throw new UserKeyError(400, 'the request body is not a JSON:API document');
  }
  let body = json as KeyRequestBody;
  if (body.data!.type !== 'user-key') {
    throw new UserKeyError(400, `the resource type is 'user-key'`);
  }
  return body;
}

function attributesOf(
  body: KeyRequestBody,
  allowed: Set<string>,
): Record<string, unknown> {
  let attributes = body.data?.attributes ?? {};
  if (typeof attributes !== 'object' || Array.isArray(attributes)) {
    throw new UserKeyError(400, 'attributes must be an object');
  }
  for (let name of Object.keys(attributes)) {
    if (!allowed.has(name)) {
      throw new UserKeyError(400, `'${name}' can't be set here`);
    }
  }
  return attributes;
}

// Runs a handler, answering a `UserKeyError` with its status and message and
// anything else with a bare 500. Only an error's message is logged, never the
// request.
export function keysHandler(fn: (ctxt: Koa.Context) => Promise<void>): Handler {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    try {
      await fn(ctxt);
    } catch (e: any) {
      if (e instanceof UserKeyError) {
        await sendResponseForError(
          ctxt,
          e.status,
          statusText(e.status),
          e.message,
        );
        return;
      }
      log.error(
        `${ctxt.method} ${ctxt.path} failed: ${e?.name ?? 'Error'}: ${e?.message ?? e}`,
      );
      await sendResponseForError(
        ctxt,
        500,
        'System Error',
        'Internal server error',
      );
    }
  };
}

function statusText(status: UserKeyError['status']): string {
  return {
    400: 'Bad Request',
    403: 'Forbidden',
    404: 'Not Found',
    409: 'Conflict',
    413: 'Payload Too Large',
  }[status];
}

// Whether this request may mint a key write ticket by where it comes from:
// the secure origin, or no `Origin` at all, as the CLI sends. A browser always
// sends `Origin` on a POST and page script can't change it, so a request made
// from the app page, where card code runs, names the app's origin and is
// refused.
//
// A client outside a browser can send any `Origin` or none, so this alone
// doesn't keep a session card code carried out of the browser from minting a
// ticket. What does is that minting also requires a session signed in on the
// secure origin (`isSecureSession`), which card code can't obtain.
export function mayMintKeyWriteTicket(
  ctxt: Koa.Context,
  secureOriginURL: URL | undefined,
): boolean {
  let origin = ctxt.get('Origin');
  if (!origin) {
    return true;
  }
  return secureOriginURL !== undefined && origin === secureOriginURL.origin;
}

export function handleMintKeyWriteTicket({
  dbAdapter,
  secureOriginURL,
}: CreateRoutesArgs): Handler {
  return keysHandler(async (ctxt) => {
    let owner = ownerOf(ctxt);
    if (!mayMintKeyWriteTicket(ctxt, secureOriginURL)) {
      throw new UserKeyError(
        403,
        'key write tickets are issued only to the secure window and the CLI',
      );
    }
    if (
      !(await isSecureSession(
        dbAdapter,
        ctxt.state.token as RealmServerTokenClaim | undefined,
      ))
    ) {
      throw new UserKeyError(
        403,
        'key write tickets are issued only to a session signed in on the secure origin',
      );
    }
    let body = await readJSON(ctxt);
    let data = body.data as
      | { type?: unknown; attributes?: Record<string, unknown> }
      | undefined;
    if (!data || typeof data !== 'object' || data.type !== 'key-write-ticket') {
      throw new UserKeyError(400, `the resource type is 'key-write-ticket'`);
    }
    let target = validateKeyWriteTarget({
      action: data.attributes?.action,
      keyId: data.attributes?.keyId,
      realm: data.attributes?.realm,
      shareId: data.attributes?.shareId,
    });
    let { ticket, expiresAt } = await mintKeyWriteTicket(
      dbAdapter,
      owner,
      target,
    );
    await sendJSON(ctxt, 201, {
      data: {
        type: 'key-write-ticket',
        attributes: { ticket, expiresAt },
      },
    });
  });
}

export function handleListUserKeys({ dbAdapter }: CreateRoutesArgs): Handler {
  return keysHandler(async (ctxt) => {
    let owner = ownerOf(ctxt);
    let keys = await listUserKeys(dbAdapter, owner);
    let grants = await listOwnerGrants(dbAdapter, owner);
    await sendJSON(ctxt, 200, {
      data: keys.map((key) =>
        serializeWithGrants(key, grants.get(key.id) ?? []),
      ),
    });
  });
}

export function handleShowUserKey({ dbAdapter }: CreateRoutesArgs): Handler {
  return keysHandler(async (ctxt) => {
    let owner = ownerOf(ctxt);
    let key = await getUserKey(dbAdapter, owner, ctxt.params.keyId);
    let grants = await listKeyGrants(dbAdapter, owner, key.id);
    await sendJSON(ctxt, 200, { data: serializeWithGrants(key, grants) });
  });
}

export function handleAddUserKey({ dbAdapter }: CreateRoutesArgs): Handler {
  return keysHandler(async (ctxt) => {
    let owner = ownerOf(ctxt);
    let body = await readBody(ctxt);
    let attributes = attributesOf(body, ADD_ATTRIBUTES);
    let key = await addUserKey(dbAdapter, secretsKeyring(), {
      owner,
      name: attributes.name,
      kind: attributes.kind,
      value: attributes.value,
      ticket: ticketOf(body),
    });
    await sendJSON(ctxt, 201, { data: serialize(key) });
  });
}

export function handleReplaceUserKey({ dbAdapter }: CreateRoutesArgs): Handler {
  return keysHandler(async (ctxt) => {
    let owner = ownerOf(ctxt);
    let body = await readBody(ctxt);
    let attributes = attributesOf(body, REPLACE_ATTRIBUTES);
    let key = await replaceUserKeyValue(dbAdapter, secretsKeyring(), {
      owner,
      id: ctxt.params.keyId,
      value: attributes.value,
      ticket: ticketOf(body),
    });
    await sendJSON(ctxt, 200, { data: serialize(key) });
  });
}

export function handleDeleteUserKey({ dbAdapter }: CreateRoutesArgs): Handler {
  return keysHandler(async (ctxt) => {
    let owner = ownerOf(ctxt);
    let body = await readJSON(ctxt);
    await deleteUserKey(dbAdapter, {
      owner,
      id: ctxt.params.keyId,
      ticket: ticketOf(body),
    });
    await setContextResponse(ctxt, new Response(null, { status: 204 }));
  });
}
