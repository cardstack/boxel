import type Koa from 'koa';
import { validate as uuidValidate } from 'uuid';
import {
  dbExpression,
  isUrlLike,
  param,
  query,
  SupportedMimeType,
  type PgPrimitive,
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
    let token = ctxt.state.token as RealmServerTokenClaim;
    if (!token) {
      await sendResponseForSystemError(
        ctxt,
        'token is required to add webhook command',
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
      assertIsWebhookCommandJSON(json);
    } catch (e: any) {
      await sendResponseForBadRequest(
        ctxt,
        `Request body is not valid JSON-API - ${e.message}`,
      );
      return;
    }

    let incomingWebhookId = json.data.attributes.incomingWebhookId.trim();
    if (!incomingWebhookId) {
      await sendResponseForBadRequest(ctxt, 'incomingWebhookId is required');
      return;
    }
    if (!uuidValidate(incomingWebhookId)) {
      await sendResponseForBadRequest(
        ctxt,
        'incomingWebhookId must be a UUID',
      );
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

    let webhookRows;
    try {
      webhookRows = await query(dbAdapter, [
        `SELECT username FROM incoming_webhooks WHERE id = `,
        param(incomingWebhookId),
        ` LIMIT 1`,
      ]);
    } catch (_error) {
      await sendResponseForSystemError(
        ctxt,
        'failed to lookup incoming webhook',
      );
      return;
    }

    let webhookUsername = webhookRows[0]?.username;
    if (!webhookUsername) {
      await sendResponseForNotFound(ctxt, 'incoming webhook is not found');
      return;
    }
    if (webhookUsername !== createdBy) {
      await sendResponseForForbiddenRequest(
        ctxt,
        'incoming webhook belongs to a different user',
      );
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
        filter !== null
          ? param(filter as unknown as PgPrimitive)
          : `NULL`,
        `,`,
        dbExpression({ pg: 'NOW()', sqlite: 'CURRENT_TIMESTAMP' }),
        `,`,
        dbExpression({ pg: 'NOW()', sqlite: 'CURRENT_TIMESTAMP' }),
        `) `,
        `RETURNING id, incoming_webhook_id, command, command_filter, created_at, updated_at`,
      ]);
    } catch (_error) {
      await sendResponseForSystemError(
        ctxt,
        'failed to add webhook command',
      );
      return;
    }

    let row = rows[0];
    if (!row) {
      await sendResponseForSystemError(
        ctxt,
        'failed to add webhook command',
      );
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
    let token = ctxt.state.token as RealmServerTokenClaim;
    if (!token) {
      await sendResponseForSystemError(
        ctxt,
        'token is required to list webhook commands',
      );
      return;
    }

    let { user: requestingUserId } = token;
    if (!(await getUserByMatrixUserId(dbAdapter, requestingUserId))) {
      await sendResponseForNotFound(ctxt, 'user is not found');
      return;
    }

    let webhookIdParam = ctxt.request.query.incomingWebhookId;
    let incomingWebhookId =
      typeof webhookIdParam === 'string' ? webhookIdParam.trim() : undefined;
    if (incomingWebhookId) {
      if (!uuidValidate(incomingWebhookId)) {
        await sendResponseForBadRequest(
          ctxt,
          'incomingWebhookId must be a UUID',
        );
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
    let token = ctxt.state.token as RealmServerTokenClaim;
    if (!token) {
      await sendResponseForSystemError(
        ctxt,
        'token is required to delete webhook command',
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

    let webhookCommandId = json?.data?.id;
    if (typeof webhookCommandId !== 'string' || !webhookCommandId.trim()) {
      await sendResponseForBadRequest(ctxt, 'webhookCommandId is required');
      return;
    }
    if (!uuidValidate(webhookCommandId)) {
      await sendResponseForBadRequest(
        ctxt,
        'webhookCommandId must be a UUID',
      );
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
    if (!commandUsername) {
      await sendResponseForNotFound(ctxt, 'webhook command is not found');
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
      await query(dbAdapter, [
        `DELETE FROM webhook_commands WHERE id = `,
        param(webhookCommandId),
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
