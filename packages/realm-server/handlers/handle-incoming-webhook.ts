import type Koa from 'koa';
import { randomBytes } from 'crypto';
import {
  dbExpression,
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

const SUPPORTED_VERIFICATION_TYPES = ['HMAC_SHA256_HEADER'] as const;

interface IncomingWebhookJSON {
  data: {
    type: 'incoming-webhook';
    attributes: {
      verificationType: string;
      verificationConfig: Record<string, unknown>;
    };
  };
}

function generateWebhookPath(): string {
  return `whk_${randomBytes(16).toString('hex')}`;
}

function generateSigningSecret(): string {
  return randomBytes(32).toString('hex');
}

export function handleCreateIncomingWebhookRequest({
  dbAdapter,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    let token = ctxt.state.token as RealmServerTokenClaim;
    if (!token) {
      await sendResponseForSystemError(
        ctxt,
        'token is required to create incoming webhook',
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
      assertIsIncomingWebhookJSON(json);
    } catch (e: any) {
      await sendResponseForBadRequest(
        ctxt,
        `Request body is not valid JSON-API - ${e.message}`,
      );
      return;
    }

    let verificationType = json.data.attributes.verificationType.trim();
    if (
      !SUPPORTED_VERIFICATION_TYPES.includes(
        verificationType as (typeof SUPPORTED_VERIFICATION_TYPES)[number],
      )
    ) {
      await sendResponseForBadRequest(
        ctxt,
        `unsupported verificationType: ${verificationType}. Supported types: ${SUPPORTED_VERIFICATION_TYPES.join(', ')}`,
      );
      return;
    }

    let verificationConfig = json.data.attributes.verificationConfig;
    if (verificationType === 'HMAC_SHA256_HEADER') {
      if (
        typeof verificationConfig.header !== 'string' ||
        !verificationConfig.header.trim()
      ) {
        await sendResponseForBadRequest(
          ctxt,
          'verificationConfig.header is required for HMAC_SHA256_HEADER',
        );
        return;
      }
      if (
        typeof verificationConfig.encoding !== 'string' ||
        !['hex', 'base64'].includes(verificationConfig.encoding)
      ) {
        await sendResponseForBadRequest(
          ctxt,
          'verificationConfig.encoding must be "hex" or "base64" for HMAC_SHA256_HEADER',
        );
        return;
      }
    }

    let webhookPath = generateWebhookPath();
    let signingSecret = generateSigningSecret();

    let rows;
    try {
      rows = await query(dbAdapter, [
        `INSERT INTO incoming_webhooks`,
        `(id, username, webhook_path, verification_type, verification_config, signing_secret, created_at, updated_at) VALUES (`,
        param(uuidv4()),
        `,`,
        param(createdBy),
        `,`,
        param(webhookPath),
        `,`,
        param(verificationType),
        `,`,
        param(verificationConfig as unknown as PgPrimitive),
        `,`,
        param(signingSecret),
        `,`,
        dbExpression({ pg: 'NOW()', sqlite: 'CURRENT_TIMESTAMP' }),
        `,`,
        dbExpression({ pg: 'NOW()', sqlite: 'CURRENT_TIMESTAMP' }),
        `) `,
        `RETURNING id, username, webhook_path, verification_type, verification_config, signing_secret, created_at, updated_at`,
      ]);
    } catch (error) {
      await sendResponseForSystemError(
        ctxt,
        'failed to create incoming webhook',
      );
      return;
    }

    let row = rows[0];
    if (!row) {
      await sendResponseForSystemError(
        ctxt,
        'failed to create incoming webhook',
      );
      return;
    }

    await setContextResponse(
      ctxt,
      new Response(
        JSON.stringify(
          {
            data: {
              type: 'incoming-webhook',
              id: row.id,
              attributes: {
                username: row.username,
                webhookPath: row.webhook_path,
                verificationType: row.verification_type,
                verificationConfig: row.verification_config,
                signingSecret: row.signing_secret,
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

export function handleListIncomingWebhooksRequest({
  dbAdapter,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    let token = ctxt.state.token as RealmServerTokenClaim;
    if (!token) {
      await sendResponseForSystemError(
        ctxt,
        'token is required to list incoming webhooks',
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
        `SELECT iw.id, iw.username, iw.webhook_path, iw.verification_type, iw.verification_config, iw.signing_secret, iw.created_at, iw.updated_at`,
        `FROM incoming_webhooks iw`,
        `WHERE iw.username = `,
        param(username),
        `ORDER BY iw.created_at ASC`,
      ]);
    } catch (error) {
      await sendResponseForSystemError(
        ctxt,
        'failed to fetch incoming webhooks',
      );
      return;
    }

    await setContextResponse(
      ctxt,
      new Response(
        JSON.stringify(
          {
            data: rows.map((row: any) => ({
              type: 'incoming-webhook',
              id: row.id,
              attributes: {
                username: row.username,
                webhookPath: row.webhook_path,
                verificationType: row.verification_type,
                verificationConfig: row.verification_config,
                signingSecret: row.signing_secret,
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

export function handleDeleteIncomingWebhookRequest({
  dbAdapter,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    let token = ctxt.state.token as RealmServerTokenClaim;
    if (!token) {
      await sendResponseForSystemError(
        ctxt,
        'token is required to delete incoming webhook',
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

    let incomingWebhookId = json?.data?.id;
    if (typeof incomingWebhookId !== 'string' || !incomingWebhookId.trim()) {
      await sendResponseForBadRequest(ctxt, 'incomingWebhookId is required');
      return;
    }

    let webhookRows;
    try {
      webhookRows = await query(dbAdapter, [
        `SELECT username FROM incoming_webhooks WHERE id = `,
        param(incomingWebhookId),
        ` LIMIT 1`,
      ]);
    } catch (error) {
      await sendResponseForSystemError(
        ctxt,
        'failed to lookup incoming webhook',
      );
      return;
    }

    let webhookUsername = webhookRows[0]?.username;
    if (webhookUsername && webhookUsername !== requestingUserId) {
      await sendResponseForForbiddenRequest(
        ctxt,
        'incoming webhook belongs to a different user',
      );
      return;
    }

    try {
      await query(dbAdapter, [
        `DELETE FROM incoming_webhooks WHERE id = `,
        param(incomingWebhookId),
      ]);
    } catch (error) {
      await sendResponseForSystemError(
        ctxt,
        'failed to delete incoming webhook',
      );
      return;
    }

    await setContextResponse(ctxt, new Response(null, { status: 204 }));
  };
}

function assertIsIncomingWebhookJSON(
  json: any,
): asserts json is IncomingWebhookJSON {
  if (typeof json !== 'object' || json === null) {
    throw new Error(`json must be an object`);
  }
  if (typeof json.data !== 'object' || json.data === null) {
    throw new Error(`data must be an object`);
  }
  if (json.data.type !== 'incoming-webhook') {
    throw new Error(`data.type must be 'incoming-webhook'`);
  }
  if (
    typeof json.data.attributes !== 'object' ||
    json.data.attributes === null
  ) {
    throw new Error(`data.attributes must be an object`);
  }
  if (typeof json.data.attributes.verificationType !== 'string') {
    throw new Error(`data.attributes.verificationType must be a string`);
  }
  if (
    typeof json.data.attributes.verificationConfig !== 'object' ||
    json.data.attributes.verificationConfig === null
  ) {
    throw new Error(`data.attributes.verificationConfig must be an object`);
  }
}
