import type Koa from 'koa';
import { createHmac, timingSafeEqual } from 'crypto';
import { param, query } from '@cardstack/runtime-common';
import { enqueueRunCommandJob } from '@cardstack/runtime-common/jobs/run-command';
import { userInitiatedPriority } from '@cardstack/runtime-common/queue';
import {
  fetchRequestFromContext,
  sendResponseForNotFound,
  sendResponseForSystemError,
  setContextResponse,
} from '../middleware';
import { getFilterHandler } from './webhook-filter-handlers';
import type { CreateRoutesArgs } from '../routes';

export default function handleWebhookReceiverRequest({
  dbAdapter,
  queue,
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

    let webhookId = webhook.id as string;
    let commandRows;
    try {
      commandRows = await query(dbAdapter, [
        `SELECT id, incoming_webhook_id, command, command_filter`,
        `FROM webhook_commands WHERE incoming_webhook_id = `,
        param(webhookId),
      ]);
    } catch (_error) {
      await sendResponseForSystemError(
        ctxt,
        'failed to lookup webhook commands',
      );
      return;
    }

    // Parse the webhook payload to extract event information for filtering
    let payload: Record<string, any> = {};
    try {
      payload = JSON.parse(rawBody);
    } catch (_error) {
      console.warn('Failed to parse webhook payload for filtering');
    }

    let executedCommands = 0;
    let matchedCommands = 0;
    for (let commandRow of commandRows) {
      let commandFilter = commandRow.command_filter as Record<
        string,
        any
      > | null;

      let filterHandler = getFilterHandler(commandFilter);

      // Delegate filter matching to the handler
      if (
        commandFilter &&
        !(await filterHandler.matches(
          payload,
          ctxt.req.headers,
          commandFilter,
          dbAdapter,
        ))
      ) {
        continue;
      }

      matchedCommands++;
      let commandURL = commandRow.command as string;
      let realmURL: string;
      let commandInput: Record<string, any>;
      try {
        realmURL = await filterHandler.getRealmURL(
          commandFilter ?? {},
          commandURL,
          payload,
          ctxt.req.headers,
          dbAdapter,
        );
        commandInput = await filterHandler.buildCommandInput(
          payload,
          ctxt.req.headers,
          commandFilter ?? {},
          dbAdapter,
        );
      } catch (error) {
        console.error(
          `Failed to build command context for command ${commandURL}, skipping:`,
          error,
        );
        continue;
      }

      let runAs = webhook.username as string;

      try {
        await enqueueRunCommandJob(
          {
            realmURL,
            realmUsername: runAs,
            runAs,
            command: commandURL,
            commandInput,
          },
          queue,
          dbAdapter,
          userInitiatedPriority,
        );
        executedCommands++;
      } catch (error) {
        console.error(
          `Failed to enqueue webhook command ${commandURL}:`,
          error,
        );
      }
    }

    if (matchedCommands > 0 && executedCommands === 0) {
      await setContextResponse(
        ctxt,
        new Response(
          JSON.stringify({
            status: 'error',
            message: `All ${matchedCommands} matched commands failed to process`,
          }),
          {
            status: 500,
            headers: { 'content-type': 'application/json' },
          },
        ),
      );
      return;
    }

    await setContextResponse(
      ctxt,
      new Response(
        JSON.stringify({
          status: 'received',
          commandsExecuted: executedCommands,
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
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
  let headerName = config.header; // e.g. 'X-Hub-Signature-256'
  let providedSignature = headers[headerName.toLowerCase()]; // Node.js normalizes incoming header names to lowercase
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
