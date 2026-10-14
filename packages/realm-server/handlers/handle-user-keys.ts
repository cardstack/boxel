import type Koa from 'koa';
import { logger, SupportedMimeType } from '@cardstack/runtime-common';
import {
  fetchRequestFromContext,
  sendResponseForError,
  setContextResponse,
} from '../middleware/index.ts';
import type { RealmServerTokenClaim } from '../utils/jwt.ts';
import type { CreateRoutesArgs } from '../routes.ts';
import { secretsKeyring } from '../lib/secrets-at-rest/index.ts';
import {
  addUserKey,
  deleteUserKey,
  getUserKey,
  listUserKeys,
  mintKeyWriteTicket,
  replaceUserKeyValue,
  resolveKeyDestination,
  UserKeyError,
  type OperationReference,
  type UserKeyMetadata,
} from '../lib/user-keys.ts';

// The management API for the signed-in user's own keys. Every route answers
// for the token's user alone, and no route returns a key's value. A request
// body here can carry a value or a ticket, so nothing here logs a body, and
// the request telemetry keeps only the method and path of these routes.

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

// The keys a request may set. A destination is never among them: it comes
// from the operation a key is added for, or from the key's first approval.
const ADD_ATTRIBUTES = new Set(['name', 'kind', 'value']);
const REPLACE_ATTRIBUTES = new Set(['value']);

function serialize(key: UserKeyMetadata) {
  let { id, ...attributes } = key;
  return { type: 'user-key', id, attributes };
}

async function sendJSON(ctxt: Koa.Context, status: number, body: unknown) {
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
function ownerOf(ctxt: Koa.Context): string {
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

async function readBody(ctxt: Koa.Context): Promise<KeyRequestBody> {
  let request = await fetchRequestFromContext(ctxt);
  let raw = await request.text();
  if (raw.length > MAX_BODY_LENGTH) {
    throw new UserKeyError(400, 'the request body is too large');
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new UserKeyError(400, 'the request body is not valid JSON');
  }
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
      throw new UserKeyError(
        400,
        name === 'destination'
          ? `a key's destination is never given: it comes from the operation the key is added for`
          : `'${name}' can't be set here`,
      );
    }
  }
  return attributes;
}

function operationOf(body: KeyRequestBody): OperationReference | undefined {
  let operation = body.meta?.operation;
  if (operation === undefined) {
    return undefined;
  }
  let fields = ['realmURL', 'definitionURL', 'exportName', 'operationName'];
  if (
    !operation ||
    typeof operation !== 'object' ||
    fields.some(
      (field) =>
        typeof (operation as Record<string, unknown>)[field] !== 'string',
    )
  ) {
    throw new UserKeyError(
      400,
      `an operation reference names its ${fields.join(', ')}`,
    );
  }
  let { realmURL, definitionURL, exportName, operationName } =
    operation as Record<string, string>;
  return { realmURL, definitionURL, exportName, operationName };
}

// Runs a handler, answering a `UserKeyError` with its status and message and
// anything else with a bare 500. Only an error's message is logged, never the
// request.
function keysHandler(fn: (ctxt: Koa.Context) => Promise<void>): Handler {
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
    422: 'Unprocessable Entity',
  }[status];
}

// Whether this request may mint a key write ticket: only the secure origin
// and the CLI may. A browser always sends `Origin` on a POST, and page script
// can't change it, so a request from the app page, where card code runs,
// names the app's origin and is refused. The CLI is not a browser and sends
// none.
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
    let { ticket, expiresAt } = await mintKeyWriteTicket(dbAdapter, owner);
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
    await sendJSON(ctxt, 200, { data: keys.map(serialize) });
  });
}

export function handleShowUserKey({ dbAdapter }: CreateRoutesArgs): Handler {
  return keysHandler(async (ctxt) => {
    let owner = ownerOf(ctxt);
    let key = await getUserKey(dbAdapter, owner, ctxt.params.keyId);
    await sendJSON(ctxt, 200, { data: serialize(key) });
  });
}

export function handleAddUserKey({ dbAdapter }: CreateRoutesArgs): Handler {
  return keysHandler(async (ctxt) => {
    let owner = ownerOf(ctxt);
    let body = await readBody(ctxt);
    let attributes = attributesOf(body, ADD_ATTRIBUTES);
    let operation = operationOf(body);
    let resolved = operation
      ? await resolveKeyDestination(operation, { owner })
      : undefined;
    let key = await addUserKey(dbAdapter, secretsKeyring(), {
      owner,
      name: attributes.name,
      kind: attributes.kind,
      value: attributes.value,
      ticket: body.meta?.ticket,
      destination: resolved?.destination ?? null,
      placementHints: resolved?.placementHints ?? null,
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
      ticket: body.meta?.ticket,
    });
    await sendJSON(ctxt, 200, { data: serialize(key) });
  });
}

export function handleDeleteUserKey({ dbAdapter }: CreateRoutesArgs): Handler {
  return keysHandler(async (ctxt) => {
    let owner = ownerOf(ctxt);
    await deleteUserKey(dbAdapter, owner, ctxt.params.keyId);
    await setContextResponse(ctxt, new Response(null, { status: 204 }));
  });
}
