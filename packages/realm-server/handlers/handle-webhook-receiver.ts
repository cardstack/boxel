import type Koa from 'koa';
import { createHmac, timingSafeEqual } from 'crypto';
import { param, query } from '@cardstack/runtime-common';
import {
  fetchRequestFromContext,
  sendResponseForNotFound,
  sendResponseForSystemError,
  setContextResponse,
} from '../middleware';
import type { CreateRoutesArgs } from '../routes';

export default function handleWebhookReceiverRequest({
  dbAdapter,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    let webhookPath = ctxt.params.webhookPath as string | undefined;
    if (!webhookPath) {
      await sendResponseForNotFound(ctxt, 'webhook not found');
      return;
    }

    let rows;
    try {
      rows = await query(dbAdapter, [
        `SELECT id, username, webhook_path, verification_type, verification_config, signing_secret`,
        `FROM incoming_webhooks WHERE webhook_path = `,
        param(webhookPath),
        ` LIMIT 1`,
      ]);
    } catch (_error) {
      await sendResponseForSystemError(ctxt, 'failed to lookup webhook');
      return;
    }

    if (rows.length === 0) {
      await sendResponseForNotFound(ctxt, 'webhook not found');
      return;
    }

    let webhook = rows[0];

    let request = await fetchRequestFromContext(ctxt);
    let rawBody = await request.text();

    let verified = false;
    try {
      verified = verifyWebhookSignature(
        webhook.verification_type as string,
        webhook.verification_config as Record<string, string>,
        webhook.signing_secret as string,
        rawBody,
        ctxt.req.headers,
      );
    } catch (_error) {
      await sendResponseForSystemError(ctxt, 'signature verification failed');
      return;
    }

    if (!verified) {
      await setContextResponse(
        ctxt,
        new Response(
          JSON.stringify({ errors: [{ detail: 'Invalid webhook signature' }] }),
          {
            status: 401,
            headers: { 'content-type': 'application/vnd.api+json' },
          },
        ),
      );
      return;
    }

    // Signature verified. Command execution will be added in a future ticket.
    await setContextResponse(
      ctxt,
      new Response(JSON.stringify({ status: 'received' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  };
}

function verifyWebhookSignature(
  verificationType: string,
  verificationConfig: Record<string, string>,
  signingSecret: string,
  body: string,
  headers: Record<string, string | string[] | undefined>,
): boolean {
  switch (verificationType) {
    case 'HMAC_SHA256_HEADER':
      return verifyHmacSha256Header(
        verificationConfig,
        signingSecret,
        body,
        headers,
      );
    default:
      throw new Error(`Unsupported verification type: ${verificationType}`);
  }
}

function verifyHmacSha256Header(
  config: Record<string, string>,
  signingSecret: string,
  body: string,
  headers: Record<string, string | string[] | undefined>,
): boolean {
  let headerName = config.header.toLowerCase();
  let providedSignature = headers[headerName];
  if (typeof providedSignature !== 'string') {
    return false;
  }

  // GitHub sends "sha256=<hex>", so strip prefix if present
  let signatureValue = providedSignature;
  if (signatureValue.startsWith('sha256=')) {
    signatureValue = signatureValue.slice('sha256='.length);
  }

  let encoding = config.encoding as 'hex' | 'base64';
  let computedHmac = createHmac('sha256', signingSecret)
    .update(body, 'utf8')
    .digest(encoding);

  // Use timing-safe comparison to prevent timing attacks
  try {
    let providedBuffer = Buffer.from(signatureValue, encoding);
    let computedBuffer = Buffer.from(computedHmac, encoding);
    if (providedBuffer.length !== computedBuffer.length) {
      return false;
    }
    return timingSafeEqual(providedBuffer, computedBuffer);
  } catch {
    return false;
  }
}
