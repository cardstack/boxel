import type Koa from 'koa';
import { validate as uuidValidate } from 'uuid';
import { param, query } from '@cardstack/runtime-common';
import { getUserByMatrixUserId } from '@cardstack/billing/billing-queries';
import {
  fetchRequestFromContext,
  sendResponseForBadRequest,
  sendResponseForForbiddenRequest,
  sendResponseForNotFound,
  sendResponseForSystemError,
} from '../middleware/index.ts';
import type { RealmServerTokenClaim } from '../utils/jwt.ts';
import type { CreateRoutesArgs } from '../routes.ts';

// The checks the incoming-webhook and webhook-command endpoints share. Each
// one answers the request and returns undefined when it fails, so a handler
// returns as soon as a check gives it nothing back.

type DBAdapter = CreateRoutesArgs['dbAdapter'];

// The request carries a token for a user the realm server knows. `action`
// completes "token is required to …" in the answer to a request without one.
export async function checkRequestingUser(
  ctxt: Koa.Context,
  dbAdapter: DBAdapter,
  action: string,
): Promise<string | undefined> {
  let token = ctxt.state.token as RealmServerTokenClaim;
  if (!token) {
    await sendResponseForSystemError(ctxt, `token is required to ${action}`);
    return undefined;
  }

  let { user: requestingUserId } = token;
  if (!(await getUserByMatrixUserId(dbAdapter, requestingUserId))) {
    await sendResponseForNotFound(ctxt, 'user is not found');
    return undefined;
  }
  return requestingUserId;
}

// `checkRequestingUser`, then a request body that parses as JSON.
export async function checkRequestingUserAndJSONBody(
  ctxt: Koa.Context,
  dbAdapter: DBAdapter,
  action: string,
): Promise<
  { requestingUserId: string; json: Record<string, any> } | undefined
> {
  let requestingUserId = await checkRequestingUser(ctxt, dbAdapter, action);
  if (!requestingUserId) {
    return undefined;
  }

  let request = await fetchRequestFromContext(ctxt);
  let rawBody = await request.text();
  let json: Record<string, any>;
  try {
    json = JSON.parse(rawBody);
  } catch (_error) {
    await sendResponseForBadRequest(
      ctxt,
      'Request body is not valid JSON-API - invalid JSON',
    );
    return undefined;
  }
  return { requestingUserId, json };
}

// An id the request names is a UUID exactly as given. It is not trimmed:
// these ids are ones the server issued, so whitespace around one means the
// client sent something other than the id, and every endpoint answers 400
// for it. An id that is absent or empty is "required"; anything else that
// isn't a UUID, blank or not a string at all, "must be a UUID". `name` is
// how the answer refers to the id.
export async function checkUUID(
  ctxt: Koa.Context,
  id: unknown,
  name: string,
): Promise<string | undefined> {
  if (id === undefined || id === null || id === '') {
    await sendResponseForBadRequest(ctxt, `${name} is required`);
    return undefined;
  }
  // The id columns are Postgres uuids, so an id of any other shape would
  // fail the lookup's cast rather than match no row.
  if (typeof id !== 'string' || !uuidValidate(id)) {
    await sendResponseForBadRequest(ctxt, `${name} must be a UUID`);
    return undefined;
  }
  return id;
}

// Whether the incoming webhook exists and, if it does, that it belongs to the
// requesting user. Answers 403 for another user's webhook. A webhook that does
// not exist comes back as `{ exists: false }`, which each caller answers in
// its own way: a delete succeeds, anything else is
// `sendResponseForIncomingWebhookNotFound`.
export async function checkIncomingWebhookOwner(
  ctxt: Koa.Context,
  dbAdapter: DBAdapter,
  {
    incomingWebhookId,
    requestingUserId,
  }: { incomingWebhookId: string; requestingUserId: string },
): Promise<{ exists: boolean } | undefined> {
  let webhookRows;
  try {
    webhookRows = await query(dbAdapter, [
      `SELECT username FROM incoming_webhooks WHERE id = `,
      param(incomingWebhookId),
      ` LIMIT 1`,
    ]);
  } catch (_error) {
    await sendResponseForSystemError(ctxt, 'failed to lookup incoming webhook');
    return undefined;
  }

  let webhookUsername = webhookRows[0]?.username;
  if (webhookUsername && webhookUsername !== requestingUserId) {
    await sendResponseForForbiddenRequest(
      ctxt,
      'incoming webhook belongs to a different user',
    );
    return undefined;
  }
  return { exists: Boolean(webhookUsername) };
}

export async function sendResponseForIncomingWebhookNotFound(
  ctxt: Koa.Context,
) {
  await sendResponseForNotFound(ctxt, 'incoming webhook is not found');
}
