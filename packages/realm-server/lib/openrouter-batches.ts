// OpenRouter's Batch API: one request carries many AI requests, which a
// provider may answer any time within 24 hours, at about half the per-token
// price. A submit answers with no cost, so batches are submitted and read only
// through the batch path (`handle-ai-batches.ts`), which records each batch
// for billing; `_request-forward` refuses these URLs.

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

// What the batch record keeps from a batch OpenRouter returns, or undefined
// when the answer isn't a batch.
export function readOpenRouterBatch(
  json: unknown,
):
  | { id: string; status: string; expiresAt: Date | null; total: number | null }
  | undefined {
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return undefined;
  }
  let batch = json as Record<string, unknown>;
  if (typeof batch.id !== 'string' || typeof batch.status !== 'string') {
    return undefined;
  }
  let expiresAt =
    typeof batch.expires_at === 'number' && Number.isFinite(batch.expires_at)
      ? new Date(batch.expires_at * 1000)
      : null;
  let counts = batch.request_counts as Record<string, unknown> | undefined;
  let total = counts && typeof counts.total === 'number' ? counts.total : null;
  return { id: batch.id, status: batch.status, expiresAt, total };
}
