import type Koa from 'koa';
import { createHmac, timingSafeEqual } from 'crypto';
import { param, query } from '@cardstack/runtime-common';
import { readRunDeclaration } from '@cardstack/runtime-common/automation-run-limits';
import {
  startWebhookAutomationRuns,
  webhookDeliveryId,
  type WebhookDelivery,
  type WebhookRunOutcome,
} from '@cardstack/runtime-common/automation-webhook-runs';
import type { RealmResourceIdentifier } from '@cardstack/runtime-common/realm-identifiers';
import { enqueueRunCommandJob } from '@cardstack/runtime-common/jobs/run-command';
import { userInitiatedPriority } from '@cardstack/runtime-common/queue';
import {
  fetchRequestFromContext,
  sendResponseForNotFound,
  sendResponseForSystemError,
  setContextResponse,
} from '../middleware/index.ts';
import { getFilterHandler } from './webhook-filter-handlers.ts';
import type { CreateRoutesArgs } from '../routes.ts';
import {
  realmServerAutomationChangeReporter,
  realmServerRunChangeReporter,
} from '../lib/run-change-reporter.ts';
import {
  INCOMING_WEBHOOK_SECRET_COLUMNS,
  readIncomingWebhookSecret,
  type IncomingWebhookSecretRow,
} from '../lib/incoming-webhook-secrets.ts';

// Receives a delivery to an incoming webhook. Once its signature verifies,
// the delivery enqueues the `webhook_commands` registered for the webhook
// that its filters match, and starts a run of each switched-on automation
// whose card names the webhook in a webhook trigger
// (`startWebhookAutomationRuns`). The two are independent: an automation's
// run never depends on a command, nor a command on an automation.
//
// The answer is 500 when the sender should deliver again:
//
// - An automation failed to take the delivery, the sender gave the delivery
//   an id, and no command was enqueued. The redelivery carries the same id,
//   so it finds the runs the first delivery made and tries the automation
//   that failed again. Without a sender's id a redelivery would start every
//   automation's runs a second time, and once a command is enqueued a
//   redelivery would run it again (a command has no key to join on), so in
//   either case the answer is 200 and the failed automation is left to its
//   cron backstop.
// - Commands matched and none could be enqueued. A sender that gave no id
//   then starts the delivery's automation runs again on the redelivery.
export default function handleWebhookReceiverRequest(
  args: CreateRoutesArgs,
): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  let { dbAdapter, queue } = args;
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    let webhookPath = ctxt.params.webhookPath as string | undefined;
    if (!webhookPath) {
      await sendResponseForNotFound(ctxt, 'webhook not found');
      return;
    }

    let rows;
    try {
      rows = await query(dbAdapter, [
        `SELECT id, username, webhook_path, verification_type, verification_config, ${INCOMING_WEBHOOK_SECRET_COLUMNS}`,
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
        readIncomingWebhookSecret(
          webhook as unknown as IncomingWebhookSecretRow,
        ),
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
    // The body as an automation run's `webhookPayload`: its JSON, or its text
    // when it isn't JSON.
    let automationPayload: WebhookDelivery['payload'] = rawBody;
    try {
      automationPayload = JSON.parse(rawBody);
      payload = automationPayload as Record<string, any>;
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
            dedupeKey: null,
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

    let deliveryId = webhookDeliveryId(ctxt.req.headers, automationPayload);
    let automationRuns = await startAutomationRuns(args, {
      webhookPath: webhook.webhook_path as string,
      owner: webhook.username as string,
      deliveryId: deliveryId.id,
      payload: automationPayload,
    });
    let failedAutomations = automationRuns.filter(
      ({ kind }) => kind === 'failed',
    ).length;

    if (
      failedAutomations > 0 &&
      deliveryId.fromSender &&
      executedCommands === 0
    ) {
      await setContextResponse(
        ctxt,
        new Response(
          JSON.stringify({
            status: 'error',
            message: `${failedAutomations} automations failed to take the delivery`,
          }),
          {
            status: 500,
            headers: { 'content-type': 'application/json' },
          },
        ),
      );
      return;
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
          automationRunsStarted: automationRuns.reduce(
            (count, outcome) =>
              outcome.kind === 'started'
                ? count + outcome.runs.filter(({ created }) => created).length
                : count,
            0,
          ),
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );
  };
}

// Starts the automation runs the delivery starts, logging what each automation
// did that a person looking for a missing run needs: a failure, a pause, and
// a card that can't be read.
async function startAutomationRuns(
  args: CreateRoutesArgs,
  delivery: WebhookDelivery,
): Promise<WebhookRunOutcome[]> {
  let { dbAdapter, definitionLookup, virtualNetwork, queue } = args;
  let outcomes: WebhookRunOutcome[];
  try {
    outcomes = await startWebhookAutomationRuns(dbAdapter, delivery, {
      queue,
      virtualNetwork,
      matrixServerName: args.matrixClient.serverName,
      readDeclaration: (automationId) =>
        readRunDeclaration({
          dbAdapter,
          definitionLookup,
          virtualNetwork,
          automationId,
        }),
      reportRunChange: realmServerRunChangeReporter(args),
      reportAutomationChange: realmServerAutomationChangeReporter(args),
    });
  } catch (error) {
    console.error(
      `Failed to find the automations delivery ${delivery.deliveryId} to webhook ${delivery.webhookPath} starts:`,
      error,
    );
    return [
      {
        kind: 'failed',
        automationId: 'unknown' as RealmResourceIdentifier,
        error,
      },
    ];
  }
  for (let outcome of outcomes) {
    if (outcome.kind === 'failed') {
      console.error(
        `Automation ${outcome.automationId} failed to take delivery ${delivery.deliveryId} to webhook ${delivery.webhookPath}:`,
        outcome.error,
      );
    } else if (outcome.kind === 'paused') {
      console.warn(
        `Automation ${outcome.automationId} paused: the owner of webhook ${delivery.webhookPath} is no longer a direct writer of its realm`,
      );
    } else if (outcome.kind === 'skipped' && outcome.reason === 'unreadable') {
      console.warn(
        `Automation ${outcome.automationId} took no delivery to webhook ${delivery.webhookPath}: its card doesn't read as an automation`,
      );
    }
  }
  return outcomes;
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
