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
  sendResponseForError,
  setContextResponse,
} from '../middleware';
import type { RealmServerTokenClaim } from '../utils/jwt';
import type { CreateRoutesArgs } from '../routes';

interface BotRegistrationJSON {
  data: {
    type: 'bot-registration';
    attributes: {
      matrixUserId: string;
      name?: string;
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
    let user = await getUserByMatrixUserId(dbAdapter, createdBy);
    if (!user) {
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

    let matrixUserId = json.data.attributes.matrixUserId.trim();
    if (!matrixUserId) {
      await sendResponseForBadRequest(ctxt, 'matrixUserId is required');
      return;
    }
    if (matrixUserId !== createdBy) {
      await sendResponseForForbiddenRequest(
        ctxt,
        'matrixUserId must match authenticated user',
      );
      return;
    }

    let name =
      typeof json.data.attributes.name === 'string'
        ? json.data.attributes.name.trim()
        : undefined;
    if (name !== undefined && !name) {
      await sendResponseForBadRequest(ctxt, 'name must not be empty');
      return;
    }

    if (name !== undefined) {
      let existingByName = await query(dbAdapter, [
        `SELECT id FROM bot_registrations WHERE user_id = `,
        param(user.id),
        ` AND name = `,
        param(name),
        ` LIMIT 1`,
      ]);
      if (existingByName.length) {
        await sendResponseForError(
          ctxt,
          409,
          'Conflict',
          'bot registration name already exists for user',
        );
        return;
      }
    } else {
      let existingDefault = await query(dbAdapter, [
        `SELECT id, user_id, name, created_at FROM bot_registrations WHERE user_id = `,
        param(user.id),
        ` AND name IS NULL LIMIT 1`,
      ]);
      if (existingDefault.length) {
        await setContextResponse(
          ctxt,
          new Response(
            JSON.stringify(
              {
                data: {
                  type: 'bot-registration',
                  id: existingDefault[0].id,
                  attributes: {
                    userId: existingDefault[0].user_id,
                    matrixUserId,
                    name: existingDefault[0].name,
                    createdAt: existingDefault[0].created_at,
                  },
                },
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
        return;
      }
    }

    let rows = await query(dbAdapter, [
      `INSERT INTO bot_registrations`,
      `(id, user_id, name, created_at) VALUES (`,
      param(uuidv4()),
      `,`,
      param(user.id),
      `,`,
      param(name ?? null),
      `,`,
      dbExpression({ pg: 'NOW()', sqlite: 'CURRENT_TIMESTAMP' }),
      `) ON CONFLICT (user_id, name) DO NOTHING `,
      `RETURNING id, user_id, name, created_at`,
    ]);

    let row = rows[0];
    let status = row ? 201 : 200;
    if (!row) {
      let existing = await query(dbAdapter, [
        `SELECT id, user_id, name, created_at FROM bot_registrations WHERE user_id = `,
        param(user.id),
        name === undefined ? ` AND name IS NULL` : ` AND name = `,
        name === undefined ? `` : param(name),
        ` LIMIT 1`,
      ]);
      row = existing[0];
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
                userId: row.user_id,
                matrixUserId,
                name: row.name,
                createdAt: row.created_at,
              },
            },
          },
          null,
          2,
        ),
        {
          status,
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

    let { user: matrixUserId } = token;
    let user = await getUserByMatrixUserId(dbAdapter, matrixUserId);
    if (!user) {
      await sendResponseForNotFound(ctxt, 'user is not found');
      return;
    }

    let rows = await query(dbAdapter, [
      `SELECT br.id, br.user_id, br.name, br.created_at, u.matrix_user_id`,
      `FROM bot_registrations br`,
      `JOIN users u ON u.id = br.user_id`,
      `WHERE br.user_id = `,
      param(user.id),
      `ORDER BY br.created_at ASC`,
    ]);

    await setContextResponse(
      ctxt,
      new Response(
        JSON.stringify(
          {
            data: rows.map((row: any) => ({
              type: 'bot-registration',
              id: row.id,
              attributes: {
                userId: row.user_id,
                matrixUserId: row.matrix_user_id,
                name: row.name,
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
    let user = await getUserByMatrixUserId(dbAdapter, requestingUserId);
    if (!user) {
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

    let registrationRows = await query(dbAdapter, [
      `SELECT user_id FROM bot_registrations WHERE id = `,
      param(botRegistrationId),
      ` LIMIT 1`,
    ]);
    let registrationUserId = registrationRows[0]?.user_id;
    if (registrationUserId && registrationUserId !== user.id) {
      await sendResponseForForbiddenRequest(
        ctxt,
        'bot registration belongs to a different user',
      );
      return;
    }

    await query(dbAdapter, [
      `DELETE FROM bot_registrations WHERE id = `,
      param(botRegistrationId),
    ]);

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
  if (typeof json.data.attributes.matrixUserId !== 'string') {
    throw new Error(`data.attributes.matrixUserId must be a string`);
  }
  if (
    'name' in json.data.attributes &&
    typeof json.data.attributes.name !== 'string'
  ) {
    throw new Error(`data.attributes.name must be a string`);
  }
}
