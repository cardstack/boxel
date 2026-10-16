import type Koa from 'koa';
import {
  dbExpression,
  isUrlLike,
  param,
  query,
  SupportedMimeType,
  type PgPrimitive,
  uuidv4,
} from '@cardstack/runtime-common';
import {
  sendResponseForBadRequest,
  sendResponseForForbiddenRequest,
  sendResponseForSystemError,
  setContextResponse,
} from '../middleware/index.ts';
import type { CreateRoutesArgs } from '../routes.ts';
import {
  checkIncomingWebhookOwner,
  checkRequestingUser,
  checkRequestingUserAndJSONBody,
  checkUUID,
  sendResponseForIncomingWebhookNotFound,
} from './webhook-request-checks.ts';

interface WebhookCommandJSON {
  data: {
    type: 'webhook-command';
    attributes: {
      incomingWebhookId: string;
      command: string;
      filter?: Record<string, unknown> | null;
    };
  };
}

export function handleCreateWebhookCommandRequest({
  dbAdapter,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    let checked = await checkRequestingUserAndJSONBody(
      ctxt,
      dbAdapter,
      'add webhook command',
    );
    if (!checked) {
      return;
    }
    let { requestingUserId: createdBy, json } = checked;

    try {
      assertIsWebhookCommandJSON(json);
    } catch (e: any) {
      await sendResponseForBadRequest(
        ctxt,
        `Request body is not valid JSON-API - ${e.message}`,
      );
      return;
    }

    let incomingWebhookId = await checkUUID(
      ctxt,
      json.data.attributes.incomingWebhookId,
      'incomingWebhookId',
    );
    if (!incomingWebhookId) {
      return;
    }

    let command = json.data.attributes.command.trim();
    if (!command) {
      await sendResponseForBadRequest(ctxt, 'command is required');
      return;
    }
    if (!isUrlLike(command)) {
      await sendResponseForBadRequest(ctxt, 'command must be a URL');
      return;
    }

    let filter = json.data.attributes.filter ?? null;

    let owner = await checkIncomingWebhookOwner(ctxt, dbAdapter, {
      incomingWebhookId,
      requestingUserId: createdBy,
    });
    if (!owner) {
      return;
    }
    if (!owner.exists) {
      await sendResponseForIncomingWebhookNotFound(ctxt);
      return;
    }

    let rows;
    try {
      rows = await query(dbAdapter, [
        `INSERT INTO webhook_commands`,
        `(id, incoming_webhook_id, command, command_filter, created_at, updated_at) VALUES (`,
        param(uuidv4()),
        `,`,
        param(incomingWebhookId),
        `,`,
        param(command),
        `,`,
        filter !== null ? param(filter as unknown as PgPrimitive) : `NULL`,
        `,`,
        dbExpression({ pg: 'NOW()', sqlite: 'CURRENT_TIMESTAMP' }),
        `,`,
        dbExpression({ pg: 'NOW()', sqlite: 'CURRENT_TIMESTAMP' }),
        `) `,
        `RETURNING id, incoming_webhook_id, command, command_filter, created_at, updated_at`,
      ]);
    } catch (_error) {
      await sendResponseForSystemError(ctxt, 'failed to add webhook command');
      return;
    }

    let row = rows[0];
    if (!row) {
      await sendResponseForSystemError(ctxt, 'failed to add webhook command');
      return;
    }

    await setContextResponse(
      ctxt,
      new Response(
        JSON.stringify(
          {
            data: {
              type: 'webhook-command',
              id: row.id,
              attributes: {
                incomingWebhookId: row.incoming_webhook_id,
                command: row.command,
                filter: row.command_filter,
                createdAt: row.created_at,
                updatedAt: row.updated_at,
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

export function handleListWebhookCommandsRequest({
  dbAdapter,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    let requestingUserId = await checkRequestingUser(
      ctxt,
      dbAdapter,
      'list webhook commands',
    );
    if (!requestingUserId) {
      return;
    }

    // An empty `incomingWebhookId` lists every command, the same as leaving
    // it out. Any other value is an id, checked as every endpoint checks one.
    let webhookIdParam = ctxt.request.query.incomingWebhookId;
    let incomingWebhookId: string | undefined;
    if (webhookIdParam !== undefined && webhookIdParam !== '') {
      incomingWebhookId = await checkUUID(
        ctxt,
        webhookIdParam,
        'incomingWebhookId',
      );
      if (!incomingWebhookId) {
        return;
      }
    }

    let rows;
    try {
      rows = await query(dbAdapter, [
        `SELECT wc.id, wc.incoming_webhook_id, wc.command, wc.command_filter, wc.created_at, wc.updated_at`,
        `FROM webhook_commands wc`,
        `JOIN incoming_webhooks iw ON iw.id = wc.incoming_webhook_id`,
        `WHERE iw.username = `,
        param(requestingUserId),
        incomingWebhookId ? ` AND wc.incoming_webhook_id = ` : ``,
        incomingWebhookId ? param(incomingWebhookId) : ``,
        ` ORDER BY wc.created_at ASC`,
      ]);
    } catch (_error) {
      await sendResponseForSystemError(
        ctxt,
        'failed to fetch webhook commands',
      );
      return;
    }

    await setContextResponse(
      ctxt,
      new Response(
        JSON.stringify(
          {
            data: rows.map((row: any) => ({
              type: 'webhook-command',
              id: row.id,
              attributes: {
                incomingWebhookId: row.incoming_webhook_id,
                command: row.command,
                filter: row.command_filter,
                createdAt: row.created_at,
                updatedAt: row.updated_at,
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

export function handleDeleteWebhookCommandRequest({
  dbAdapter,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    let checked = await checkRequestingUserAndJSONBody(
      ctxt,
      dbAdapter,
      'delete webhook command',
    );
    if (!checked) {
      return;
    }
    let { requestingUserId, json } = checked;

    let webhookCommandId = await checkUUID(
      ctxt,
      json?.data?.id,
      'webhookCommandId',
    );
    if (!webhookCommandId) {
      return;
    }

    let commandRows;
    try {
      commandRows = await query(dbAdapter, [
        `SELECT iw.username FROM webhook_commands wc`,
        `JOIN incoming_webhooks iw ON iw.id = wc.incoming_webhook_id`,
        `WHERE wc.id = `,
        param(webhookCommandId),
        ` LIMIT 1`,
      ]);
    } catch (_error) {
      await sendResponseForSystemError(
        ctxt,
        'failed to lookup webhook command',
      );
      return;
    }

    let commandUsername = commandRows[0]?.username;
    // Deleting a webhook command that does not exist succeeds, so a retried
    // delete answers the same as the first, as deleting an incoming webhook
    // does.
    if (!commandUsername) {
      await setContextResponse(ctxt, new Response(null, { status: 204 }));
      return;
    }
    if (commandUsername !== requestingUserId) {
      await sendResponseForForbiddenRequest(
        ctxt,
        'webhook command belongs to a different user',
      );
      return;
    }

    try {
      // The owner is part of the delete itself, so it removes only a command
      // whose webhook still belongs to the requesting user.
      await query(dbAdapter, [
        `DELETE FROM webhook_commands wc USING incoming_webhooks iw`,
        ` WHERE wc.id = `,
        param(webhookCommandId),
        ` AND iw.id = wc.incoming_webhook_id AND iw.username = `,
        param(requestingUserId),
      ]);
    } catch (_error) {
      await sendResponseForSystemError(
        ctxt,
        'failed to delete webhook command',
      );
      return;
    }

    await setContextResponse(ctxt, new Response(null, { status: 204 }));
  };
}

function assertIsWebhookCommandJSON(
  json: any,
): asserts json is WebhookCommandJSON {
  if (typeof json !== 'object' || json === null) {
    throw new Error(`json must be an object`);
  }
  if (typeof json.data !== 'object' || json.data === null) {
    throw new Error(`data must be an object`);
  }
  if (json.data.type !== 'webhook-command') {
    throw new Error(`data.type must be 'webhook-command'`);
  }
  if (
    typeof json.data.attributes !== 'object' ||
    json.data.attributes === null
  ) {
    throw new Error(`data.attributes must be an object`);
  }
  if (typeof json.data.attributes.incomingWebhookId !== 'string') {
    throw new Error(`data.attributes.incomingWebhookId must be a string`);
  }
  if (typeof json.data.attributes.command !== 'string') {
    throw new Error(`data.attributes.command must be a string`);
  }
  if (
    'filter' in json.data.attributes &&
    json.data.attributes.filter !== null &&
    typeof json.data.attributes.filter !== 'object'
  ) {
    throw new Error(`data.attributes.filter must be an object or null`);
  }
}
