// Webhook triggers: a delivery to an incoming webhook starts a run of each
// switched-on automation whose card names that webhook in a trigger of kind
// `webhook`.
//
// The webhook receiver verifies the delivery's signature, then hands it here
// (`startWebhookAutomationRuns`). For each automation that may take it, the
// delivery:
//
// - makes a run row for each trigger on the card naming the webhook. The run
//   acts as the automation's payer, never the webhook's owner, and its slot
//   is `delivery:` and the delivery's id (`webhookDeliveryId`,
//   `webhookDeliverySlot`), so a sender that delivers the same event again
//   finds the run the first delivery made and starts no second one.
// - enqueues the run's job through `enqueueAutomationRunJob`, as the tick
//   does for a scheduled run, with the delivery's body as the job's
//   `webhookPayload`. The script reads it as
//   `realm.current.automation.webhookPayload`. A body longer than
//   `MAX_WEBHOOK_PAYLOAD_CHARS` isn't sent: the job carries its length
//   instead, and the worker ends the run saying the body was too large, so
//   the run's log shows the delivery that didn't run. The run then goes through
//   the same admission as any run of the card's triggers: a paused
//   automation's run doesn't start, and the payer's access, keys and credits
//   are checked.
//
// Which automations may take a delivery: those that are active or *waiting
// for credits*, whose caps snapshot lists the webhook among the webhooks
// the payer agreed to (`webhookPaths`). A snapshot without `webhookPaths`
// limits no webhook (`webhooksChangedFrom`), so such an automation is a
// candidate too, and its card decides. Either way the card, as indexed, must
// name the webhook, and the webhook's owner must be a direct writer of
// the automation's realm, which each delivery asks again
// (`takeWebhookDelivery`). An owner who lost write pauses the automation with
// `webhook-owner-lost-access`.
//
// A delivery's payload lives only in its run's job. A webhook run whose job is
// lost is ended by reconcile, never enqueued again, since nothing else holds
// the payload, and the worker refuses a webhook run whose job carries none. A cron trigger on the same card is the backstop for anything a
// webhook missed: it runs on its schedule and catches up from the realm.

import type * as JSONTypes from 'json-typescript';
import { v4 as uuidv4 } from 'uuid';

import type { AutomationTickOptions } from './automation-tick.ts';
import type { ReportAutomationChange } from './automation-change-events.ts';
import type { ReportRunChange } from './automation-run-events.ts';
import { logRunPlatformLine } from './automation-run-log.ts';
import {
  MAX_WEBHOOK_PAYLOAD_CHARS,
  webhookDeliverySlot,
} from './automation-run-command.ts';
import { emitAutomationRunEvent } from './automation-run-telemetry.ts';
import { takeWebhookDelivery, type AutomationRow } from './automations.ts';
import type { DBAdapter } from './db.ts';
import { param, query } from './expression.ts';
import { enqueueAutomationRunJob } from './jobs/run-command.ts';
import { ensureTrailingSlash } from './paths.ts';
import type { QueuePublisher } from './queue.ts';
import type { RealmResourceIdentifier } from './realm-identifiers.ts';
import type { VirtualNetwork } from './virtual-network.ts';

// The longest delivery id a sender's header or body may give. A longer one is
// treated as no id at all.
const MAX_DELIVERY_ID_LENGTH = 256;

export type WebhookHeaders = Record<string, string | string[] | undefined>;

// The id a sender gives a delivery, which is the slot of each run the
// delivery starts. A sender that delivers an event again sends the same id,
// so the redelivery finds the runs the first delivery made. Where each sender
// puts it:
//
// - GitHub: the `X-GitHub-Delivery` header.
// - Senders that follow Standard Webhooks (such as Svix): the `webhook-id`
//   header.
// - Google Drive and Docs push notifications: the `X-Goog-Channel-ID` and
//   `X-Goog-Message-Number` headers, joined as `<channel>:<number>`.
// - Stripe: the body's `id`, on an event (`object` is `"event"`).
//
// A delivery that carries none of these gets a fresh id (`fromSender` false),
// so it starts its own runs, and a redelivery of it starts them again.
//
// The receiver verifies a delivery's signature before any of this, and checks
// only an HMAC-SHA256 of the body in one header, as GitHub signs. So of these
// senders only GitHub's deliveries reach an automation; the rest are read for
// the day the receiver verifies their signatures too.
export function webhookDeliveryId(
  headers: WebhookHeaders,
  payload: unknown,
): { id: string; fromSender: boolean } {
  let header = (name: string) => usableId(headers[name]);
  let fromSender = (id: string) => ({ id, fromSender: true });
  let github = header('x-github-delivery');
  if (github) {
    return fromSender(github);
  }
  let standard = header('webhook-id');
  if (standard) {
    return fromSender(standard);
  }
  let channel = header('x-goog-channel-id');
  let message = header('x-goog-message-number');
  if (channel && message) {
    let joined = usableId(`${channel}:${message}`);
    if (joined) {
      return fromSender(joined);
    }
  }
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    let body = payload as Record<string, unknown>;
    let stripe = body.object === 'event' ? usableId(body.id) : undefined;
    if (stripe) {
      return fromSender(stripe);
    }
  }
  return { id: uuidv4(), fromSender: false };
}

function usableId(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  let id = value.trim();
  return id && id.length <= MAX_DELIVERY_ID_LENGTH ? id : undefined;
}

// A delivery the receiver verified.
export interface WebhookDelivery {
  // The incoming webhook's path, as triggers name it.
  webhookPath: string;
  // Who made the incoming webhook.
  owner: string;
  // `webhookDeliveryId`'s id.
  deliveryId: string;
  // The delivery's body: its JSON, or its text when it isn't JSON.
  payload: JSONTypes.Value;
}

export interface WebhookRunOptions {
  queue: QueuePublisher;
  // Reads the automation card's declaration from the index.
  readDeclaration: AutomationTickOptions['readDeclaration'];
  virtualNetwork: Pick<VirtualNetwork, 'toURL' | 'toURLHref'>;
  // The paired Matrix server, whose bot accounts are never direct writers.
  matrixServerName: string;
  reportRunChange?: ReportRunChange;
  reportAutomationChange?: ReportAutomationChange;
}

// What a delivery did with one candidate automation:
//
// - `started`: a run for each trigger naming the webhook. `created` is false
//   for a run a redelivery found. When that run is still pending, the
//   redelivery enqueues its job again: the queue joins the job already
//   there when the args match, and otherwise adds a job that, running after
//   the first in the automation's concurrency group, finds the run started
//   or over and leaves it. A first delivery that made the run and failed to
//   enqueue its job is made good this way.
// - `paused`: the webhook's owner lost write, so the automation paused with
//   `webhook-owner-lost-access`.
// - `skipped`: the automation took no delivery (`reason`):
//   `takeWebhookDelivery`'s reasons, `unreadable` for a card that doesn't
//   read as a declaration, or `not-named` for a card that names the webhook
//   in no trigger.
// - `failed`: handling the automation threw. A redelivery tries it again.
export type WebhookRunOutcome =
  | {
      kind: 'started';
      automationId: RealmResourceIdentifier;
      runs: {
        runId: string;
        trigger: string;
        created: boolean;
        jobId?: number;
      }[];
    }
  | { kind: 'paused'; automationId: RealmResourceIdentifier }
  | {
      kind: 'skipped';
      automationId: RealmResourceIdentifier;
      reason:
        | 'not-switched-on'
        | 'not-active'
        | 'agreement-exceeded'
        | 'unreadable'
        | 'not-named';
    }
  | { kind: 'failed'; automationId: RealmResourceIdentifier; error: unknown };

// Starts the runs a delivery starts (see the top of this module), one
// automation at a time, so one automation's failure doesn't stop the rest.
export async function startWebhookAutomationRuns(
  dbAdapter: DBAdapter,
  delivery: WebhookDelivery,
  options: WebhookRunOptions,
): Promise<WebhookRunOutcome[]> {
  let outcomes: WebhookRunOutcome[] = [];
  for (let automationId of await candidateAutomations(
    dbAdapter,
    delivery.webhookPath,
  )) {
    try {
      outcomes.push(
        await startRunsOf(dbAdapter, automationId, delivery, options),
      );
    } catch (error) {
      outcomes.push({ kind: 'failed', automationId, error });
    }
  }
  return outcomes;
}

// The automations that may take a delivery to `webhookPath`: active or
// waiting for credits, with a snapshot that agreed to the webhook or that
// predates the record of webhooks.
async function candidateAutomations(
  dbAdapter: DBAdapter,
  webhookPath: string,
): Promise<RealmResourceIdentifier[]> {
  let rows = await query(dbAdapter, [
    "SELECT automation_id FROM automations WHERE state IN ('active', 'waiting-for-credits')",
    "AND (caps_snapshot->'webhookPaths' @> jsonb_build_array(",
    param(webhookPath),
    "::text) OR caps_snapshot->'webhookPaths' IS NULL)",
    'ORDER BY automation_id',
  ]);
  return rows.map((row) => row.automation_id as RealmResourceIdentifier);
}

async function startRunsOf(
  dbAdapter: DBAdapter,
  automationId: RealmResourceIdentifier,
  delivery: WebhookDelivery,
  options: WebhookRunOptions,
): Promise<WebhookRunOutcome> {
  let read = await options.readDeclaration(automationId);
  if (!read.ok) {
    return { kind: 'skipped', automationId, reason: 'unreadable' };
  }
  let { declaration } = read;
  let triggers = declaration.triggers
    .filter(
      (trigger) =>
        trigger.kind === 'webhook' &&
        trigger.webhookPath === delivery.webhookPath,
    )
    .map(({ label }) => label);
  if (triggers.length === 0) {
    return { kind: 'skipped', automationId, reason: 'not-named' };
  }
  let taken = await takeWebhookDelivery(
    dbAdapter,
    {
      automationId,
      owner: delivery.owner,
      declaration,
      triggers,
      slot: webhookDeliverySlot(delivery.deliveryId),
    },
    options,
  );
  if (taken.kind === 'skipped') {
    return { kind: 'skipped', automationId, reason: taken.reason };
  }
  if (taken.kind === 'paused') {
    return { kind: 'paused', automationId };
  }
  let runs: Extract<WebhookRunOutcome, { kind: 'started' }>['runs'] = [];
  for (let { run, created } of taken.runs) {
    // A redelivery that finds the run ended starts nothing: the run already
    // took this delivery.
    if (run.state !== 'pending') {
      runs.push({ runId: run.id, trigger: run.trigger, created });
      continue;
    }
    let job = await enqueueAutomationRunJob(options.queue, {
      automationId,
      realmURL: ensureTrailingSlash(
        options.virtualNetwork.toURLHref(run.realm),
      ),
      actsAs: run.actsAs,
      trigger: run.trigger,
      slot: run.slot,
      secondsCap: declaration.caps.seconds,
      input: {
        runId: run.id,
        scheduledAt: run.createdAt,
        dryRun: false,
        ...payloadInput(delivery.payload),
      },
    });
    runs.push({ runId: run.id, trigger: run.trigger, created, jobId: job.id });
    await reportEnqueued(
      dbAdapter,
      taken.automation,
      run,
      job.id,
      delivery,
      created,
    );
    await options.reportRunChange?.(run.id);
  }
  return { kind: 'started', automationId, runs };
}

// The delivery's body as the job carries it: the body itself, or its length
// when it is too large to send to the tab.
function payloadInput(
  payload: JSONTypes.Value,
): { webhookPayload: JSONTypes.Value } | { webhookPayloadChars: number } {
  let chars = JSON.stringify(payload).length;
  return chars > MAX_WEBHOOK_PAYLOAD_CHARS
    ? { webhookPayloadChars: chars }
    : { webhookPayload: payload };
}

// The line on the run's log naming the trigger, the webhook and the delivery,
// which is how a delivery is traced to its run, and, for the delivery that
// made the run, the run's `enqueued` telemetry. A redelivery that enqueued a
// pending run's job again says so on the log too.
async function reportEnqueued(
  dbAdapter: DBAdapter,
  automation: AutomationRow,
  run: { id: string; trigger: string; slot: string; createdAt: string },
  jobId: number,
  delivery: WebhookDelivery,
  created: boolean,
): Promise<void> {
  if (!created) {
    await logRunPlatformLine(
      dbAdapter,
      run.id,
      {
        kind: 'trigger',
        level: 'info',
        message: `Delivery ${delivery.deliveryId} to the incoming webhook ${delivery.webhookPath} came again while this run was pending, and enqueued its job again`,
        data: {
          trigger: run.trigger,
          slot: run.slot,
          webhookPath: delivery.webhookPath,
          redelivered: true,
        },
      },
      jobId,
    );
    return;
  }
  let enqueuedAt = new Date().toISOString();
  emitAutomationRunEvent({
    kind: 'enqueued',
    automation: automation.automationId,
    run: run.id,
    job: jobId,
    realm: automation.realm,
    trigger: run.trigger,
    triggerKind: 'webhook',
    dryRun: false,
    scheduledAt: run.createdAt,
    enqueuedAt,
    scheduleLagMs: Math.max(
      0,
      Date.parse(enqueuedAt) - Date.parse(run.createdAt),
    ),
  });
  await logRunPlatformLine(
    dbAdapter,
    run.id,
    {
      kind: 'trigger',
      level: 'info',
      message: `The ${run.trigger} trigger started this run for delivery ${delivery.deliveryId} to the incoming webhook ${delivery.webhookPath}`,
      data: {
        trigger: run.trigger,
        slot: run.slot,
        webhookPath: delivery.webhookPath,
      },
    },
    jobId,
  );
}
