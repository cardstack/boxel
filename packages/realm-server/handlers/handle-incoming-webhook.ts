import type Koa from 'koa';
import { randomBytes } from 'crypto';
import {
  param,
  query,
  SupportedMimeType,
  uuidv4,
} from '@cardstack/runtime-common';
import { validate as uuidValidate } from 'uuid';
import { getUserByMatrixUserId } from '@cardstack/billing/billing-queries';
import {
  fetchRequestFromContext,
  sendResponseForBadRequest,
  sendResponseForForbiddenRequest,
  sendResponseForNotFound,
  sendResponseForSystemError,
  setContextResponse,
} from '../middleware/index.ts';
import type { RealmServerTokenClaim } from '../utils/jwt.ts';
import type { CreateRoutesArgs } from '../routes.ts';
import {
  INCOMING_WEBHOOK_ATTRIBUTE_COLUMNS,
  insertIncomingWebhook,
  rotateIncomingWebhookSecret,
} from '../lib/incoming-webhook-secrets.ts';

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

// A webhook as the API reports it. The signing secret appears only in the
// response that issues it, when the webhook is created or its secret rotated;
// every other read reports only when the current secret was issued.
function incomingWebhookResource(
  row: Record<string, any>,
  signingSecret?: string,
) {
  return {
    type: 'incoming-webhook',
    id: row.id,
    attributes: {
      username: row.username,
      webhookPath: row.webhook_path,
      verificationType: row.verification_type,
      verificationConfig: row.verification_config,
      ...(signingSecret === undefined ? {} : { signingSecret }),
      signingSecretCreatedAt: row.signing_secret_created_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
  };
}

function incomingWebhookResponse(data: unknown, status: number): Response {
  return new Response(JSON.stringify({ data }, null, 2), {
    status,
    headers: {
      'content-type': SupportedMimeType.JSONAPI,
    },
  });
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

    let created;
    try {
      created = await insertIncomingWebhook(
        dbAdapter,
        {
          username: createdBy,
          webhookPath: generateWebhookPath(),
          verificationType,
          verificationConfig,
        },
        { id: uuidv4() },
      );
    } catch (error) {
      await sendResponseForSystemError(
        ctxt,
        'failed to create incoming webhook',
      );
      return;
    }

    await setContextResponse(
      ctxt,
      incomingWebhookResponse(
        incomingWebhookResource(created.row, created.signingSecret),
        201,
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
        `SELECT ${INCOMING_WEBHOOK_ATTRIBUTE_COLUMNS}`,
        `FROM incoming_webhooks`,
        `WHERE username = `,
        param(username),
        `ORDER BY created_at ASC`,
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
      incomingWebhookResponse(
        rows.map((row) => incomingWebhookResource(row)),
        200,
      ),
    );
  };
}

// The checks a request naming one of the user's webhooks passes before its
// handler acts on it: an authenticated, known user, a JSON body whose
// `data.id` is a UUID, and a webhook that, if it exists, belongs to that user.
// Answers the request and returns undefined when a check fails. `exists` is
// false when no webhook has that id, which each caller answers in its own way.
async function checkIncomingWebhookRequest(
  ctxt: Koa.Context,
  dbAdapter: CreateRoutesArgs['dbAdapter'],
  action: string,
): Promise<
  | { requestingUserId: string; incomingWebhookId: string; exists: boolean }
  | undefined
> {
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

  let incomingWebhookId = json?.data?.id;
  if (typeof incomingWebhookId !== 'string' || !incomingWebhookId.trim()) {
    await sendResponseForBadRequest(ctxt, 'incomingWebhookId is required');
    return undefined;
  }
  // The id column is a Postgres uuid, so an id of any other shape would fail
  // the lookup's cast rather than match no row.
  if (!uuidValidate(incomingWebhookId)) {
    await sendResponseForBadRequest(ctxt, 'incomingWebhookId must be a UUID');
    return undefined;
  }

  let webhookRows;
  try {
    webhookRows = await query(dbAdapter, [
      `SELECT username FROM incoming_webhooks WHERE id = `,
      param(incomingWebhookId),
      ` LIMIT 1`,
    ]);
  } catch (error) {
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

  return {
    requestingUserId,
    incomingWebhookId,
    exists: Boolean(webhookUsername),
  };
}

// Deleting a webhook that does not exist succeeds, so a retried delete
// answers the same as the first.
export function handleDeleteIncomingWebhookRequest({
  dbAdapter,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    let checked = await checkIncomingWebhookRequest(
      ctxt,
      dbAdapter,
      'delete incoming webhook',
    );
    if (!checked) {
      return;
    }

    try {
      await query(dbAdapter, [
        `DELETE FROM incoming_webhooks WHERE id = `,
        param(checked.incomingWebhookId),
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

// Issues a new signing secret for one of the user's webhooks and returns it
// in the response, the one time it is shown. A signature made with the old
// secret stops verifying as soon as this responds.
export function handleRotateIncomingWebhookSecretRequest({
  dbAdapter,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    let checked = await checkIncomingWebhookRequest(
      ctxt,
      dbAdapter,
      'rotate an incoming webhook signing secret',
    );
    if (!checked) {
      return;
    }
    if (!checked.exists) {
      await sendResponseForNotFound(ctxt, 'incoming webhook not found');
      return;
    }

    let rotated;
    try {
      rotated = await rotateIncomingWebhookSecret(dbAdapter, {
        id: checked.incomingWebhookId,
        username: checked.requestingUserId,
      });
    } catch (error) {
      await sendResponseForSystemError(
        ctxt,
        'failed to rotate incoming webhook signing secret',
      );
      return;
    }
    if (!rotated) {
      // Deleted between the lookup and the update.
      await sendResponseForNotFound(ctxt, 'incoming webhook not found');
      return;
    }

    await setContextResponse(
      ctxt,
      incomingWebhookResponse(
        incomingWebhookResource(rotated.row, rotated.signingSecret),
        200,
      ),
    );
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
