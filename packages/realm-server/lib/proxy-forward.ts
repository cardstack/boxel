import type Koa from 'koa';
import type { DBAdapter } from '@cardstack/runtime-common';
import { logger } from '@cardstack/runtime-common';
import * as Sentry from '@sentry/node';

import type { AllowedProxyDestination } from './allowed-proxy-destinations';

const log = logger('proxy-forward');

const KEEP_ALIVE_INTERVAL_MS = 15000;

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
): Promise<void> {
  try {
    setupSSEHeaders(ctxt);

    const fetchInit: RequestInit = { method, headers };
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
