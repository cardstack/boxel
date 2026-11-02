import type Koa from 'koa';
import { CLIENT_IP_HEADER, SupportedMimeType } from '@cardstack/runtime-common';
import { setContextResponse } from '../middleware/index.ts';
import {
  addSystemKey,
  deleteSystemKey,
  getSystemKey,
  listSystemKeys,
  replaceSystemKey,
  SystemKeyError,
  type SystemKeyCaller,
  type SystemKeyCreditStrategy,
} from '../lib/system-keys.ts';
import type { CreateRoutesArgs } from '../routes.ts';
import type { OperatorTokenClaim } from '../utils/operator-token.ts';

// The operator endpoints for system keys, reached with an operator token for
// `system-keys`. They report a key's destination, settings and history, never
// its value.

export const MAX_SYSTEM_KEY_BODY_BYTES = 64 * 1024;

async function respond(
  ctxt: Koa.Context,
  status: number,
  body: unknown,
): Promise<void> {
  await setContextResponse(
    ctxt,
    new Response(JSON.stringify(body, null, 2), {
      status,
      headers: { 'content-type': SupportedMimeType.JSON },
    }),
  );
}

class BodyTooLarge extends Error {}

// Reads the JSON body, refusing it as soon as its declared length or the bytes
// received so far exceed the limit, so an oversized body is never buffered
// whole.
async function readJSONBody(ctxt: Koa.Context): Promise<Record<string, any>> {
  let declared = Number(ctxt.req.headers['content-length']);
  if (Number.isFinite(declared) && declared > MAX_SYSTEM_KEY_BODY_BYTES) {
    throw new BodyTooLarge();
  }
  let chunks: Buffer[] = [];
  let received = 0;
  for await (let chunk of ctxt.req) {
    received += chunk.length;
    if (received > MAX_SYSTEM_KEY_BODY_BYTES) {
      throw new BodyTooLarge();
    }
    chunks.push(chunk);
  }
  let body: unknown;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new SystemKeyError(400, 'the body is not JSON');
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new SystemKeyError(400, 'the body must be a JSON object');
  }
  return body as Record<string, any>;
}

// What the server observed about the caller: the address the client-address
// middleware worked out, and when the operator token that
// `operatorAuthorization` verified was signed. The platform OAuth client
// routes record the same.
export function operatorCaller(ctxt: Koa.Context): SystemKeyCaller {
  let address = ctxt.req.headers[CLIENT_IP_HEADER];
  let token = ctxt.state.operatorToken as OperatorTokenClaim | undefined;
  return {
    clientAddress: typeof address === 'string' && address ? address : null,
    tokenIssuedAt: token?.iat ?? null,
  };
}

function handle(
  fn: (ctxt: Koa.Context) => Promise<{ status: number; body: unknown }>,
): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context) {
    try {
      let { status, body } = await fn(ctxt);
      await respond(ctxt, status, body);
    } catch (e) {
      if (e instanceof SystemKeyError) {
        await respond(ctxt, e.status, { errors: [e.message] });
        return;
      }
      if (e instanceof BodyTooLarge) {
        await respond(ctxt, 413, {
          errors: [
            `the body is larger than ${MAX_SYSTEM_KEY_BODY_BYTES} bytes`,
          ],
        });
        return;
      }
      throw e;
    }
  };
}

export function handleListSystemKeys({ dbAdapter }: CreateRoutesArgs) {
  return handle(async () => ({
    status: 200,
    body: { keys: await listSystemKeys(dbAdapter) },
  }));
}

export function handleShowSystemKey({ dbAdapter }: CreateRoutesArgs) {
  return handle(async (ctxt) => ({
    status: 200,
    body: await getSystemKey(dbAdapter, ctxt.params.id),
  }));
}

// Body: `destination`, `authMethod` (`header` or `url-parameter`, default
// `header`), `paramName`, `creditStrategy` (`openrouter` or `none`),
// `supportsStreaming`, `value` and `note`.
export function handleAddSystemKey({ dbAdapter }: CreateRoutesArgs) {
  return handle(async (ctxt) => {
    let body = await readJSONBody(ctxt);
    if (typeof body.destination !== 'string') {
      throw new SystemKeyError(400, 'a destination is required');
    }
    if (typeof body.creditStrategy !== 'string') {
      throw new SystemKeyError(400, 'a credit strategy is required');
    }
    if (body.paramName != null && typeof body.paramName !== 'string') {
      throw new SystemKeyError(400, 'the parameter name must be a string');
    }
    if (
      body.supportsStreaming != null &&
      typeof body.supportsStreaming !== 'boolean'
    ) {
      throw new SystemKeyError(400, 'supportsStreaming must be a boolean');
    }
    let key = await addSystemKey(dbAdapter, {
      destination: body.destination,
      authMethod: body.authMethod ?? 'header',
      paramName: body.paramName ?? null,
      // `addSystemKey` refuses a strategy it doesn't know.
      creditStrategy: body.creditStrategy as SystemKeyCreditStrategy,
      supportsStreaming: body.supportsStreaming ?? false,
      value: body.value,
      note: body.note,
      caller: operatorCaller(ctxt),
    });
    return { status: 201, body: { key } };
  });
}

// Body: `value` and `note`.
export function handleReplaceSystemKey({ dbAdapter }: CreateRoutesArgs) {
  return handle(async (ctxt) => {
    let body = await readJSONBody(ctxt);
    let key = await replaceSystemKey(dbAdapter, ctxt.params.id, {
      value: body.value,
      note: body.note,
      caller: operatorCaller(ctxt),
    });
    return { status: 200, body: { key } };
  });
}

// Body: `note`.
export function handleDeleteSystemKey({ dbAdapter }: CreateRoutesArgs) {
  return handle(async (ctxt) => {
    let body = await readJSONBody(ctxt);
    let key = await deleteSystemKey(dbAdapter, ctxt.params.id, {
      note: body.note,
      caller: operatorCaller(ctxt),
    });
    return { status: 200, body: { deleted: key } };
  });
}
