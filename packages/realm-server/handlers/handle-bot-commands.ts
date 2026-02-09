import type Koa from 'koa';
import { validate as uuidValidate } from 'uuid';
import {
  assertIsBotCommandFilter,
  dbExpression,
  isUrlLike,
  param,
  query,
  SupportedMimeType,
  type PgPrimitive,
  type BotCommandFilter,
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

interface BotCommandJSON {
  data: {
    type: 'bot-command';
    attributes: {
      botId: string;
      command: string;
      filter: BotCommandFilter;
    };
  };
}

export function handleBotCommandsRequest({
  dbAdapter,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    let token = ctxt.state.token as RealmServerTokenClaim;
    if (!token) {
      await sendResponseForSystemError(
        ctxt,
        'token is required to add bot command',
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
      assertIsBotCommandJSON(json);
    } catch (e: any) {
      await sendResponseForBadRequest(
        ctxt,
        `Request body is not valid JSON-API - ${e.message}`,
      );
      return;
    }

    let botId = json.data.attributes.botId.trim();
    if (!botId) {
      await sendResponseForBadRequest(ctxt, 'botId is required');
      return;
    }
    if (!uuidValidate(botId)) {
      await sendResponseForBadRequest(ctxt, 'botId must be a UUID');
      return;
    }

    let command = json.data.attributes.command.trim();

    let filter = json.data.attributes.filter;
    if (filter == null) {
      await sendResponseForBadRequest(ctxt, 'filter is required');
      return;
    }

    if (!command) {
      await sendResponseForBadRequest(ctxt, 'command is required');
      return;
    }

    if (!isUrlLike(command)) {
      await sendResponseForBadRequest(ctxt, 'command must be a URL');
      return;
    }

    try {
      assertIsBotCommandFilter(filter);
    } catch (e: any) {
      await sendResponseForBadRequest(ctxt, e.message);
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
        `(id, bot_id, command, command_filter, created_at) VALUES (`,
        param(uuidv4()),
        `,`,
        param(botId),
        `,`,
        param(command),
        `,`,
        param(filter as unknown as PgPrimitive),
        `,`,
        dbExpression({ pg: 'NOW()', sqlite: 'CURRENT_TIMESTAMP' }),
        `) `,
        `RETURNING id, bot_id, command, command_filter, created_at`,
      ]);
    } catch (_error) {
      await sendResponseForSystemError(ctxt, 'failed to add bot command');
      return;
    }

    let row = rows[0];
    if (!row) {
      await sendResponseForSystemError(ctxt, 'failed to add bot command');
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
                filter: row.command_filter,
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

    let botIdParam = ctxt.request.query.botId;
    let botId = typeof botIdParam === 'string' ? botIdParam.trim() : undefined;
    if (botId) {
      if (!uuidValidate(botId)) {
        await sendResponseForBadRequest(ctxt, 'botId must be a UUID');
        return;
      }
    }

    let rows;
    try {
      rows = await query(dbAdapter, [
        `SELECT bc.id, bc.bot_id, bc.command, bc.command_filter, bc.created_at`,
        `FROM bot_commands bc`,
        `JOIN bot_registrations br ON br.id = bc.bot_id`,
        `WHERE br.username = `,
        param(requestingUserId),
        botId ? ` AND bc.bot_id = ` : ``,
        botId ? param(botId) : ``,
        ` ORDER BY bc.created_at ASC`,
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
                filter: row.command_filter,
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
        'token is required to delete bot command',
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

    let botCommandId = json?.data?.id;
    if (typeof botCommandId !== 'string' || !botCommandId.trim()) {
      await sendResponseForBadRequest(ctxt, 'botCommandId is required');
      return;
    }
    if (!uuidValidate(botCommandId)) {
      await sendResponseForBadRequest(ctxt, 'botCommandId must be a UUID');
      return;
    }

    let commandRows;
    try {
      commandRows = await query(dbAdapter, [
        `SELECT br.username FROM bot_commands bc`,
        `JOIN bot_registrations br ON br.id = bc.bot_id`,
        `WHERE bc.id = `,
        param(botCommandId),
        ` LIMIT 1`,
      ]);
    } catch (_error) {
      await sendResponseForSystemError(ctxt, 'failed to lookup bot command');
      return;
    }

    let commandUsername = commandRows[0]?.username;
    if (!commandUsername) {
      await sendResponseForNotFound(ctxt, 'bot command is not found');
      return;
    }
    if (commandUsername !== requestingUserId) {
      await sendResponseForForbiddenRequest(
        ctxt,
        'bot command belongs to a different user',
      );
      return;
    }

    try {
      await query(dbAdapter, [
        `DELETE FROM bot_commands WHERE id = `,
        param(botCommandId),
      ]);
    } catch (_error) {
      await sendResponseForSystemError(ctxt, 'failed to delete bot command');
      return;
    }

    await setContextResponse(ctxt, new Response(null, { status: 204 }));
  };
}

function assertIsBotCommandJSON(json: any): asserts json is BotCommandJSON {
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
  if (
    'filter' in json.data.attributes &&
    json.data.attributes.filter !== null &&
    typeof json.data.attributes.filter !== 'object'
  ) {
    throw new Error(`data.attributes.filter must be an object`);
  }
  if (!('filter' in json.data.attributes)) {
    throw new Error(`data.attributes.filter is required`);
  }
}
