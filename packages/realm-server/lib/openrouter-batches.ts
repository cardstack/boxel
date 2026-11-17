// OpenRouter's Batch API: one request carries many AI requests, which a
// provider may answer any time within 24 hours, at about half the per-token
// price. A submit answers with no cost, so batches are submitted and read only
// through the batch path (`handle-ai-batches.ts`), which records each batch
// for billing, and by the settle job (`ai-batch-settle.ts`), which bills each
// one when it ends; `_request-forward` refuses these URLs.

import type { DBAdapter } from '@cardstack/runtime-common';
import { AllowedProxyDestinations } from './allowed-proxy-destinations.ts';
import {
  outboundFailureResponse,
  systemKeyCredential,
} from './proxy-forward.ts';
import {
  OutboundRefusedError,
  outboundFetch,
  sendContext,
  type OutboundErrorContext,
} from './outbound/client.ts';
import { scrubError } from './outbound/scrub-error.ts';
import { CredentialScrubber } from './outbound/scrubber.ts';

// The realm server's route for an automation run's batch calls.
export const AI_BATCHES_PATH = '/_ai-batches';

export const OPENROUTER_BATCHES_URL = 'https://openrouter.ai/api/v1/batches';

// The endpoint every request in a batch is sent to. The batch path accepts
// chat completion requests only, since only their worst case can be priced
// before they are sent.
export const OPENROUTER_BATCH_ENDPOINT = '/v1/chat/completions';

// The only completion window OpenRouter accepts.
export const OPENROUTER_BATCH_COMPLETION_WINDOW = '24h';

// The longest a script may wait for a batch's results.
export const MAX_AI_BATCH_DEADLINE_SECONDS = 24 * 60 * 60;

// Whether `url` is OpenRouter's batch API or under it. OpenRouter decodes a
// path before routing it, so `/api/v1/%62atches` reaches the batch API too:
// the path is compared decoded, and one that can't be decoded counts as a
// batch URL rather than slipping past.
export function isOpenRouterBatchURL(url: string): boolean {
  let parsed: URL;
  let batches = new URL(OPENROUTER_BATCHES_URL);
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.origin !== batches.origin) {
    return false;
  }
  let path: string;
  try {
    path = decodeURIComponent(parsed.pathname);
  } catch {
    return true;
  }
  return path === batches.pathname || path.startsWith(`${batches.pathname}/`);
}

export function openRouterBatchURL(batchId: string): string {
  return `${OPENROUTER_BATCHES_URL}/${encodeURIComponent(batchId)}`;
}

// The body OpenRouter's submit takes. OpenRouter refuses a body whose
// `requests` comes before the batch's other fields, so it is built last.
export function openRouterBatchSubmitBody({
  model,
  requests,
}: {
  model: string;
  requests: { customId: string; body: Record<string, unknown> }[];
}): string {
  return JSON.stringify({
    endpoint: OPENROUTER_BATCH_ENDPOINT,
    model,
    completion_window: OPENROUTER_BATCH_COMPLETION_WINDOW,
    requests: requests.map(({ customId, body }) => ({
      custom_id: customId,
      body,
    })),
  });
}

// What the platform reads from a batch OpenRouter returns: its id and
// status, when its provider stops working on it (`expiresAt`), how many
// requests it accepted (`total`), when it reached a final status
// (`finalizedAt`), and what it cost in USD (`costUsd`), which OpenRouter
// reports once the batch ends, and says it reports for a completed one.
export interface OpenRouterBatch {
  id: string;
  status: string;
  model: string | null;
  createdAt: Date | null;
  expiresAt: Date | null;
  finalizedAt: Date | null;
  total: number | null;
  costUsd: number | null;
}

// Reads a batch from OpenRouter's answer, or undefined when the answer isn't
// a batch.
export function readOpenRouterBatch(
  json: unknown,
): OpenRouterBatch | undefined {
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return undefined;
  }
  let batch = json as Record<string, unknown>;
  if (typeof batch.id !== 'string' || typeof batch.status !== 'string') {
    return undefined;
  }
  let counts = batch.request_counts as Record<string, unknown> | undefined;
  let total = counts && typeof counts.total === 'number' ? counts.total : null;
  let usage = batch.usage as Record<string, unknown> | null | undefined;
  let cost =
    usage && typeof usage === 'object' && typeof usage.cost === 'number'
      ? usage.cost
      : null;
  return {
    id: batch.id,
    status: batch.status,
    model: typeof batch.model === 'string' ? batch.model : null,
    createdAt: unixTime(batch.created_at),
    expiresAt: unixTime(batch.expires_at),
    finalizedAt: unixTime(batch.finalized_at),
    total,
    costUsd: cost !== null && Number.isFinite(cost) && cost >= 0 ? cost : null,
  };
}

// The most batches one page of OpenRouter's batch list holds.
export const OPENROUTER_BATCH_LIST_PAGE_SIZE = 100;

// A page of OpenRouter's batch list, newest first, for the batches created
// after `createdAfter`, continuing after the batch `after` names.
export function openRouterBatchListURL({
  createdAfter,
  after,
}: {
  createdAfter: Date;
  after?: string;
}): string {
  let url = new URL(OPENROUTER_BATCHES_URL);
  url.searchParams.set('limit', String(OPENROUTER_BATCH_LIST_PAGE_SIZE));
  url.searchParams.set(
    'created_after',
    String(Math.floor(createdAfter.getTime() / 1000)),
  );
  if (after) {
    url.searchParams.set('after', after);
  }
  return url.href;
}

// Reads a page of OpenRouter's batch list, or undefined when the answer isn't
// one. `lastId` is what the next page continues after, while `hasMore`.
export function readOpenRouterBatchList(
  json: unknown,
):
  | { batches: OpenRouterBatch[]; lastId: string | null; hasMore: boolean }
  | undefined {
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return undefined;
  }
  let list = json as Record<string, unknown>;
  if (!Array.isArray(list.data)) {
    return undefined;
  }
  let batches = list.data
    .map((item) => readOpenRouterBatch(item))
    .filter((batch): batch is OpenRouterBatch => batch !== undefined);
  return {
    batches,
    lastId: typeof list.last_id === 'string' ? list.last_id : null,
    hasMore: list.has_more === true,
  };
}

function unixTime(value: unknown): Date | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? new Date(value * 1000)
    : null;
}

// What a call to OpenRouter's Batch API with the platform's OpenRouter key
// came to:
// - `answered`: OpenRouter answered, with any status; its whole body is read.
// - `no-key`: no system key covers the URL, so nothing was sent.
// - `failed`: the call failed before its answer was read. When `sent` is
//   false the outbound guard refused it before sending; otherwise it went
//   out, and OpenRouter may have acted on it. `failure` is how the guard
//   would answer a caller for it, when the guard stopped it.
export type OpenRouterBatchCall =
  | { kind: 'answered'; status: number; json: unknown; text: string }
  | { kind: 'no-key' }
  | {
      kind: 'failed';
      sent: boolean;
      error: unknown;
      failure:
        | { status: number; statusText: string; message: string }
        | undefined;
      call: OutboundErrorContext;
    };

// Sends one call to OpenRouter's Batch API with the platform's OpenRouter
// key: the system key whose destination covers the URL in `proxy_endpoints`.
// The error a failed call carries is scrubbed of the key.
export async function callOpenRouterBatchAPI(
  dbAdapter: DBAdapter,
  { url, method, body }: { url: string; method: string; body?: string },
): Promise<OpenRouterBatchCall> {
  let destination =
    await AllowedProxyDestinations.getInstance(dbAdapter).getDestinationConfig(
      url,
    );
  if (!destination) {
    return { kind: 'no-key' };
  }
  let scrubber = new CredentialScrubber();
  let credential = systemKeyCredential(destination);
  let call = sendContext(credential.name, url);
  try {
    let response = await outboundFetch({
      url,
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body,
      sizePath: 'system-key',
      responseSizeCap: destination.responseSizeCap,
      destinationSetBy: 'platform',
      credential,
      scrubber,
    });
    let text = await response.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return { kind: 'answered', status: response.status, json, text };
  } catch (error) {
    scrubError(error, scrubber);
    return {
      kind: 'failed',
      sent: !(error instanceof OutboundRefusedError),
      error,
      failure: outboundFailureResponse(error),
      call,
    };
  }
}
