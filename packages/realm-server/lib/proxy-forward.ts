import type Koa from 'koa';
import type { DBAdapter } from '@cardstack/runtime-common';
import { logger } from '@cardstack/runtime-common';
import * as Sentry from '@sentry/node';

import type { AllowedProxyDestination } from './allowed-proxy-destinations.ts';

const log = logger('proxy-forward');

const KEEP_ALIVE_INTERVAL_MS = 15000;

/**
 * A signal that fires when this request's client goes away before it was
 * answered — a caller enforcing its own deadline, a closed tab, a dropped
 * connection. Proxy handlers pass it into the upstream `fetch` so abandoning
 * the wait also cancels the call.
 *
 * The disconnect is observable on the response, not the request. Node
 * destroys the request stream as soon as its body has been read, so `req`
 * emits 'close' on every request — served or abandoned — and its deprecated
 * 'aborted' event never fires once the body has arrived in full. `res` closes
 * with `writableEnded` still false only when the socket went away before the
 * response was finished, which is exactly the case worth cancelling.
 */
export function clientDisconnectSignal(ctxt: Koa.Context): AbortSignal {
  let controller = new AbortController();
  ctxt.res.once('close', () => {
    if (!ctxt.res.writableEnded) {
      controller.abort(
        new Error('Client disconnected before the response was finished'),
      );
    }
  });
  return controller.signal;
}

// A `cause` chain is walked rather than inspected one level deep because
// `fetch` surfaces an abort reason wrapped rather than rethrown. The bound
// stops a malformed or self-referential chain from spinning.
const MAX_CAUSE_DEPTH = 8;

/**
 * Whether `error` is the cancellation `signal` asked for, as opposed to a
 * failure that merely happened while the signal was aborted.
 *
 * `signal.aborted` alone cannot answer this. Work that runs *after* the
 * upstream call — saving the usage cost — never receives the signal, so it
 * runs to completion or failure regardless of whether the client is still
 * there. A caller that treats every post-abort exception as a cancellation
 * therefore swallows a genuine billing failure whenever the client happens to
 * leave during that write, which is precisely when nobody is watching.
 *
 * Identity against `signal.reason` is exact: `clientDisconnectSignal` aborts
 * with a specific `Error` instance. The `AbortError` name is accepted too, for
 * an abort that a lower layer reports in its own terms.
 */
export function isClientDisconnectError(
  error: unknown,
  signal: AbortSignal,
): boolean {
  if (!signal.aborted) {
    return false;
  }
  let cursor: unknown = error;
  for (let depth = 0; cursor != null && depth < MAX_CAUSE_DEPTH; depth++) {
    if (cursor === signal.reason) {
      return true;
    }
    if ((cursor as { name?: unknown }).name === 'AbortError') {
      return true;
    }
    cursor = (cursor as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Stream the upstream `text/event-stream` response back to the client, parsing
 * each `data:` line so we can capture the OpenRouter generation id / inline
 * cost and save the credit deduction at `[DONE]`.
 *
 * Cost-save is awaited inline (not fire-and-forget). Callers run this inside
 * `dbAdapter.withUserCostLock(matrixUserId, ...)`, which serializes concurrent
 * same-user requests across replicas; the lock must be held until the cost
 * row commits so the next request can't kick off another billable upstream
 * call before the previous request's debit lands in the ledger.
 *
 * `signal` fires when the client that asked for the stream goes away. It
 * cancels the upstream call and, with it, the body stream this function is
 * reading, which is how the cost lock is released instead of being held for
 * the rest of a generation nobody is receiving. A stream cut short never
 * reaches `[DONE]`, so no cost is saved for it.
 */
export async function handleStreamingRequest(
  ctxt: Koa.Context,
  url: string,
  method: string,
  headers: Record<string, string>,
  requestBody: BodyInit | undefined,
  endpointConfig: AllowedProxyDestination,
  dbAdapter: DBAdapter,
  matrixUserId: string,
  signal: AbortSignal,
): Promise<void> {
  try {
    setupSSEHeaders(ctxt);

    const fetchInit: RequestInit = { method, headers, signal };
    if (requestBody !== undefined) {
      fetchInit.body = requestBody;
    }

    const externalResponse = await fetch(url, fetchInit);

    if (!externalResponse.ok) {
      const errorData = await externalResponse.text();
      log.error(
        `Streaming request failed: ${externalResponse.status} - ${errorData}`,
      );
      ctxt.status = externalResponse.status;
      ctxt.res.write(`data: ${JSON.stringify({ error: errorData })}\n\n`);
      ctxt.res.write('data: [DONE]\n\n');
      return;
    }

    // First write commits headers + status to the wire, so do this
    // only after the upstream-OK check above has had a chance to
    // override the status.
    ctxt.res.write(': connected\n\n');

    const reader = externalResponse.body?.getReader();
    if (!reader) throw new Error('No readable stream available');

    let generationId: string | undefined;
    let costInUsd: number | undefined;
    let lastPing = Date.now();

    await proxySSE(
      reader,
      async (data) => {
        if (data === '[DONE]') {
          ctxt.res.write(`data: [DONE]\n\n`);
          if (
            generationId != null ||
            (typeof costInUsd === 'number' &&
              Number.isFinite(costInUsd) &&
              costInUsd > 0)
          ) {
            await endpointConfig.creditStrategy.saveUsageCost(
              dbAdapter,
              matrixUserId,
              { id: generationId, usage: { cost: costInUsd } },
            );
          } else {
            log.warn(
              `Streaming response for user ${matrixUserId} contained no generation ID or usage cost, skipping credit deduction`,
            );
          }
          return 'stop';
        }

        try {
          const dataObj = JSON.parse(data);
          if (!generationId && dataObj.id) {
            generationId = dataObj.id;
          }
          if (dataObj.usage?.cost != null) {
            costInUsd = dataObj.usage.cost;
          }
        } catch {
          log.warn('Invalid JSON in streaming response:', data);
        }

        ctxt.res.write(`data: ${data}\n\n`);
        return;
      },
      () => {
        const now = Date.now();
        if (now - lastPing > KEEP_ALIVE_INTERVAL_MS) {
          ctxt.res.write(': ping\n\n');
          lastPing = now;
        }
      },
    );
  } catch (error) {
    if (isClientDisconnectError(error, signal)) {
      // The read failed because the client hung up and we cancelled the
      // upstream call ourselves. There is no socket left to write the error
      // frames to and no fault to page anyone about. A cost-save that fails
      // on its own after the client left is not this, and falls through.
      log.info(
        `Client disconnected during streaming request for user ${matrixUserId}; upstream call cancelled`,
      );
      return;
    }
    log.error('Error in streaming request:', error);
    Sentry.captureException(error);
    ctxt.res.write(
      `data: ${JSON.stringify({ error: 'Streaming error occurred' })}\n\n`,
    );
    ctxt.res.write('data: [DONE]\n\n');
  }
}

function setupSSEHeaders(ctx: Koa.Context) {
  // Headers and status are set here but NOT flushed — `flushHeaders`
  // commits the wire status, which would mask any later
  // `ctx.status = upstream.status` on upstream failure. Caller flushes
  // (implicitly, via the first `ctx.res.write`) only after confirming
  // the upstream response was OK.
  ctx.set('Content-Type', 'text/event-stream');
  ctx.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  ctx.set('Connection', 'keep-alive');
  ctx.set('Access-Control-Allow-Origin', '*');
  ctx.set('Access-Control-Allow-Headers', 'Cache-Control');
  ctx.set('X-Accel-Buffering', 'no'); // Disable nginx buffering
  ctx.set('Transfer-Encoding', 'chunked');
  ctx.body = null;
  ctx.status = 200;
}

async function proxySSE(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onData: (data: string) => Promise<void | 'stop'>,
  onTick?: () => void,
) {
  let buffer = '';
  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += new TextDecoder().decode(value);
      if (onTick) onTick();

      // Split on `\n`, keep the trailing incomplete fragment in
      // `buffer`, dispatch every complete line. The previous
      // implementation called a helper that locally reassigned
      // its `buffer` parameter — the caller's buffer never got
      // trimmed, so every new read re-emitted every prior line.
      // For SSE that means the receiver got each delta multiple
      // times and concatenated them ("foofoo barfoo bar baz...").
      let parts = buffer.split('\n');
      buffer = parts.pop() ?? '';

      for (let raw of parts) {
        let line = raw.trim();
        if (!line || line.startsWith(':')) continue;
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          const result = await onData(data);
          if (result === 'stop') return;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
