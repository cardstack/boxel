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

interface BotCommandCreateJSON {
  data: {
    type: 'bot-command';
    attributes: {
      botId: string;
      command: string;
      filter?: unknown;
    };
  };
}

interface BotCommandDeleteJSON {
  data: {
    type: 'bot-command';
    id: string;
    attributes: {
      botId: string;
    };
  };
}

export function handleBotCommandsCreateRequest({
  dbAdapter,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    let token = ctxt.state.token as RealmServerTokenClaim;
    if (!token) {
      await sendResponseForSystemError(
        ctxt,
        'token is required to create bot commands',
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
      assertIsBotCommandCreateJSON(json);
    } catch (e: any) {
      await sendResponseForBadRequest(
        ctxt,
        `Request body is not valid JSON-API - ${e.message}`,
      );
      return;
    }

    let botId = json.data.attributes.botId.trim();
    let command = json.data.attributes.command.trim();
    let filter = json.data.attributes.filter;
    if (!botId) {
      await sendResponseForBadRequest(ctxt, 'botId is required');
      return;
    }
    if (!command) {
      await sendResponseForBadRequest(ctxt, 'command is required');
      return;
    }

    let registrationRows;
    try {
      registrationRows = await query(dbAdapter, [
        `SELECT username FROM bot_registrations WHERE id = `,
        param(botId),
        ` LIMIT 1`,
      ]);
    } catch (_error) {
      await sendResponseForSystemError(
        ctxt,
        'failed to lookup bot registration',
      );
      return;
    }

    let registrationUsername = registrationRows[0]?.username;
    if (!registrationUsername) {
      await sendResponseForNotFound(ctxt, 'bot registration is not found');
      return;
    }
    if (registrationUsername !== createdBy) {
      await sendResponseForForbiddenRequest(
        ctxt,
        'bot registration belongs to a different user',
      );
      return;
    }

    let rows;
    try {
      rows = await query(dbAdapter, [
        `INSERT INTO bot_commands`,
        `(id, bot_id, command, filter, created_at) VALUES (`,
        param(uuidv4()),
        `,`,
        param(botId),
        `,`,
        param(command),
        `,`,
        param(filter == null ? null : JSON.stringify(filter)),
        `,`,
        dbExpression({ pg: 'NOW()', sqlite: 'CURRENT_TIMESTAMP' }),
        `) `,
        `RETURNING id, bot_id, command, filter, created_at`,
      ]);
    } catch (_error) {
      await sendResponseForSystemError(ctxt, 'failed to create bot command');
      return;
    }

    let row = rows[0];
    if (!row) {
      await sendResponseForSystemError(ctxt, 'failed to create bot command');
      return;
    }

    await setContextResponse(
      ctxt,
      new Response(
        JSON.stringify(
          {
            data: {
              type: 'bot-command',
              id: row.id,
              attributes: {
                botId: row.bot_id,
                command: row.command,
                filter: normalizeFilter(row.filter),
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

export function handleBotCommandsListRequest({
  dbAdapter,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    let token = ctxt.state.token as RealmServerTokenClaim;
    if (!token) {
      await sendResponseForSystemError(
        ctxt,
        'token is required to list bot commands',
      );
      return;
    }

    let { user: requestingUserId } = token;
    if (!(await getUserByMatrixUserId(dbAdapter, requestingUserId))) {
      await sendResponseForNotFound(ctxt, 'user is not found');
      return;
    }

    let botId = ctxt.query?.botId;
    if (typeof botId !== 'string' || !botId.trim()) {
      await sendResponseForBadRequest(ctxt, 'botId is required');
      return;
    }

    let registrationRows;
    try {
      registrationRows = await query(dbAdapter, [
        `SELECT username FROM bot_registrations WHERE id = `,
        param(botId),
        ` LIMIT 1`,
      ]);
    } catch (_error) {
      await sendResponseForSystemError(
        ctxt,
        'failed to lookup bot registration',
      );
      return;
    }

    let registrationUsername = registrationRows[0]?.username;
    if (!registrationUsername) {
      await sendResponseForNotFound(ctxt, 'bot registration is not found');
      return;
    }
    if (registrationUsername !== requestingUserId) {
      await sendResponseForForbiddenRequest(
        ctxt,
        'bot registration belongs to a different user',
      );
      return;
    }

    let rows;
    try {
      rows = await query(dbAdapter, [
        `SELECT id, bot_id, command, filter, created_at`,
        `FROM bot_commands`,
        `WHERE bot_id = `,
        param(botId),
        `ORDER BY created_at ASC`,
      ]);
    } catch (_error) {
      await sendResponseForSystemError(ctxt, 'failed to fetch bot commands');
      return;
    }

    await setContextResponse(
      ctxt,
      new Response(
        JSON.stringify(
          {
            data: rows.map((row: any) => ({
              type: 'bot-command',
              id: row.id,
              attributes: {
                botId: row.bot_id,
                command: row.command,
                filter: normalizeFilter(row.filter),
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

export function handleBotCommandDeleteRequest({
  dbAdapter,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    let token = ctxt.state.token as RealmServerTokenClaim;
    if (!token) {
      await sendResponseForSystemError(
        ctxt,
        'token is required to delete bot commands',
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

    try {
      assertIsBotCommandDeleteJSON(json);
    } catch (e: any) {
      await sendResponseForBadRequest(
        ctxt,
        `Request body is not valid JSON-API - ${e.message}`,
      );
      return;
    }

    let botCommandId = json.data.id.trim();
    let botId = json.data.attributes.botId.trim();
    if (!botCommandId) {
      await sendResponseForBadRequest(ctxt, 'botCommandId is required');
      return;
    }
    if (!botId) {
      await sendResponseForBadRequest(ctxt, 'botId is required');
      return;
    }

    let registrationRows;
    try {
      registrationRows = await query(dbAdapter, [
        `SELECT username FROM bot_registrations WHERE id = `,
        param(botId),
        ` LIMIT 1`,
      ]);
    } catch (_error) {
      await sendResponseForSystemError(
        ctxt,
        'failed to lookup bot registration',
      );
      return;
    }

    let registrationUsername = registrationRows[0]?.username;
    if (!registrationUsername) {
      await sendResponseForNotFound(ctxt, 'bot registration is not found');
      return;
    }
    if (registrationUsername !== requestingUserId) {
      await sendResponseForForbiddenRequest(
        ctxt,
        'bot registration belongs to a different user',
      );
      return;
    }

    try {
      await query(dbAdapter, [
        `DELETE FROM bot_commands WHERE id = `,
        param(botCommandId),
        ` AND bot_id = `,
        param(botId),
      ]);
    } catch (_error) {
      await sendResponseForSystemError(ctxt, 'failed to delete bot command');
      return;
    }

    await setContextResponse(ctxt, new Response(null, { status: 204 }));
  };
}

function assertIsBotCommandCreateJSON(
  json: any,
): asserts json is BotCommandCreateJSON {
  if (typeof json !== 'object' || json === null) {
    throw new Error(`json must be an object`);
  }
  if (typeof json.data !== 'object' || json.data === null) {
    throw new Error(`data must be an object`);
  }
  if (json.data.type !== 'bot-command') {
    throw new Error(`data.type must be 'bot-command'`);
  }
  if (
    typeof json.data.attributes !== 'object' ||
    json.data.attributes === null
  ) {
    throw new Error(`data.attributes must be an object`);
  }
  if (typeof json.data.attributes.botId !== 'string') {
    throw new Error(`data.attributes.botId must be a string`);
  }
  if (typeof json.data.attributes.command !== 'string') {
    throw new Error(`data.attributes.command must be a string`);
  }
}

function assertIsBotCommandDeleteJSON(
  json: any,
): asserts json is BotCommandDeleteJSON {
  if (typeof json !== 'object' || json === null) {
    throw new Error(`json must be an object`);
  }
  if (typeof json.data !== 'object' || json.data === null) {
    throw new Error(`data must be an object`);
  }
  if (json.data.type !== 'bot-command') {
    throw new Error(`data.type must be 'bot-command'`);
  }
  if (typeof json.data.id !== 'string') {
    throw new Error(`data.id must be a string`);
  }
  if (
    typeof json.data.attributes !== 'object' ||
    json.data.attributes === null
  ) {
    throw new Error(`data.attributes must be an object`);
  }
  if (typeof json.data.attributes.botId !== 'string') {
    throw new Error(`data.attributes.botId must be a string`);
  }
}

function normalizeFilter(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
