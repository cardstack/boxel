import type Koa from 'koa';
import {
  dbExpression,
  param,
  query,
  SupportedMimeType,
  uuidv4,
} from '@cardstack/runtime-common';
import { getUserByMatrixUserId } from '@cardstack/billing/billing-queries';
import {
  fetchRequestFromContext,
  sendResponseForBadRequest,
  sendResponseForForbiddenRequest,
  sendResponseForNotFound,
  sendResponseForSystemError,
  setContextResponse,
} from '../middleware';
import type { RealmServerTokenClaim } from '../utils/jwt';
import type { CreateRoutesArgs } from '../routes';

interface BotRegistrationJSON {
  data: {
    type: 'bot-registration';
    attributes: {
      username: string;
    };
  };
}

export function handleBotRegistrationRequest({
  dbAdapter,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    let token = ctxt.state.token as RealmServerTokenClaim;
    if (!token) {
      await sendResponseForSystemError(
        ctxt,
        'token is required to register bot',
      );
      return;
    }

    let { user: createdBy } = token;
    if (!(await getUserByMatrixUserId(dbAdapter, createdBy))) {
      await sendResponseForNotFound(ctxt, 'user is not found');
      return;
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
      return;
    }

    try {
      assertIsBotRegistrationJSON(json);
    } catch (e: any) {
      await sendResponseForBadRequest(
        ctxt,
        `Request body is not valid JSON-API - ${e.message}`,
      );
      return;
    }

    let username = json.data.attributes.username.trim();
    if (!username) {
      await sendResponseForBadRequest(ctxt, 'username is required');
      return;
    }
    if (username !== createdBy) {
      await sendResponseForForbiddenRequest(
        ctxt,
        'username must match authenticated user',
      );
      return;
    }

    let rows;
    try {
      rows = await query(dbAdapter, [
        `INSERT INTO bot_registrations`,
        `(id, username, created_at) VALUES (`,
        param(uuidv4()),
        `,`,
        param(username),
        `,`,
        dbExpression({ pg: 'NOW()', sqlite: 'CURRENT_TIMESTAMP' }),
        `) `,
        `RETURNING id, username, created_at`,
      ]);
    } catch (error) {
      await sendResponseForSystemError(ctxt, 'failed to register bot');
      return;
    }

    let row = rows[0];
    if (!row) {
      await sendResponseForSystemError(ctxt, 'failed to register bot');
      return;
    }
    await setContextResponse(
      ctxt,
      new Response(
        JSON.stringify(
          {
            data: {
              type: 'bot-registration',
              id: row.id,
              attributes: {
                username: row.username,
                createdAt: row.created_at,
              },
            },
          },
          null,
          2,
        ),
        {
          status: 201,
          headers: {
            'content-type': SupportedMimeType.JSONAPI,
          },
        },
      ),
    );
  };
}

export function handleBotRegistrationsRequest({
  dbAdapter,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    let token = ctxt.state.token as RealmServerTokenClaim;
    if (!token) {
      await sendResponseForSystemError(
        ctxt,
        'token is required to list bot registrations',
      );
      return;
    }

    let { user: username } = token;
    if (!(await getUserByMatrixUserId(dbAdapter, username))) {
      await sendResponseForNotFound(ctxt, 'user is not found');
      return;
    }

    let rows;
    try {
      rows = await query(dbAdapter, [
        `SELECT br.id, br.username, br.created_at`,
        `FROM bot_registrations br`,
        `WHERE br.username = `,
        param(username),
        `ORDER BY br.created_at ASC`,
      ]);
    } catch (error) {
      await sendResponseForSystemError(
        ctxt,
        'failed to fetch bot registrations',
      );
      return;
    }

    await setContextResponse(
      ctxt,
      new Response(
        JSON.stringify(
          {
            data: rows.map((row: any) => ({
              type: 'bot-registration',
              id: row.id,
              attributes: {
                username: row.username,
                createdAt: row.created_at,
              },
            })),
          },
          null,
          2,
        ),
        {
          status: 200,
          headers: {
            'content-type': SupportedMimeType.JSONAPI,
          },
        },
      ),
    );
  };
}

export function handleBotUnregistrationRequest({
  dbAdapter,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    let token = ctxt.state.token as RealmServerTokenClaim;
    if (!token) {
      await sendResponseForSystemError(
        ctxt,
        'token is required to unregister bot',
      );
      return;
    }

    let { user: requestingUserId } = token;
    if (!(await getUserByMatrixUserId(dbAdapter, requestingUserId))) {
      await sendResponseForNotFound(ctxt, 'user is not found');
      return;
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
      return;
    }

    let botRegistrationId = json?.data?.id;
    if (typeof botRegistrationId !== 'string' || !botRegistrationId.trim()) {
      await sendResponseForBadRequest(ctxt, 'botRegistrationId is required');
      return;
    }

    let registrationRows;
    try {
      registrationRows = await query(dbAdapter, [
        `SELECT username FROM bot_registrations WHERE id = `,
        param(botRegistrationId),
        ` LIMIT 1`,
      ]);
    } catch (error) {
      await sendResponseForSystemError(ctxt, 'failed to lookup bot registration');
      return;
    }
    let registrationUsername = registrationRows[0]?.username;
    if (registrationUsername && registrationUsername !== requestingUserId) {
      await sendResponseForForbiddenRequest(
        ctxt,
        'bot registration belongs to a different user',
      );
      return;
    }

    try {
      await query(dbAdapter, [
        `DELETE FROM bot_registrations WHERE id = `,
        param(botRegistrationId),
      ]);
    } catch (error) {
      await sendResponseForSystemError(ctxt, 'failed to unregister bot');
      return;
    }

    await setContextResponse(ctxt, new Response(null, { status: 204 }));
  };
}

function assertIsBotRegistrationJSON(
  json: any,
): asserts json is BotRegistrationJSON {
  if (typeof json !== 'object' || json === null) {
    throw new Error(`json must be an object`);
  }
  if (typeof json.data !== 'object' || json.data === null) {
    throw new Error(`data must be an object`);
  }
  if (json.data.type !== 'bot-registration') {
    throw new Error(`data.type must be 'bot-registration'`);
  }
  if (
    typeof json.data.attributes !== 'object' ||
    json.data.attributes === null
  ) {
    throw new Error(`data.attributes must be an object`);
  }
  if (typeof json.data.attributes.username !== 'string') {
    throw new Error(`data.attributes.username must be a string`);
  }
}
