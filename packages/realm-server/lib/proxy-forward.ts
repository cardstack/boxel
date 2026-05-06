import type Koa from 'koa';
import type { DBAdapter } from '@cardstack/runtime-common';
import { logger } from '@cardstack/runtime-common';
import * as Sentry from '@sentry/node';

import type { AllowedProxyDestination } from './allowed-proxy-destinations';

const log = logger('proxy-forward');

/**
 * Per-user barrier ensuring the previous request's billable cost has been
 * recorded before a new request starts. Shared across every handler that
 * forwards through a credit-bearing destination so the same user can't race
 * concurrent requests through different endpoints (e.g. `_request-forward`
 * and `/_openrouter/chat/completions`).
 */
const pendingCostPromises = new Map<string, Promise<void>>();

const KEEP_ALIVE_INTERVAL_MS = 15000;

export async function awaitPendingCost(matrixUserId: string): Promise<void> {
  let pending = pendingCostPromises.get(matrixUserId);
  if (pending) {
    await pending;
  }
}

/** Schedule cost deduction in the background, chained after any prior pending. */
export function trackCostDeduction(
  destinationConfig: AllowedProxyDestination,
  dbAdapter: DBAdapter,
  matrixUserId: string,
  responseData: unknown,
): void {
  const previous = pendingCostPromises.get(matrixUserId) ?? Promise.resolve();
  const cost = previous
    .then(() =>
      destinationConfig.creditStrategy.saveUsageCost(
        dbAdapter,
        matrixUserId,
        responseData,
      ),
    )
    .finally(() => {
      if (pendingCostPromises.get(matrixUserId) === cost) {
        pendingCostPromises.delete(matrixUserId);
      }
    });
  pendingCostPromises.set(matrixUserId, cost);
}

/**
 * Stream the upstream `text/event-stream` response back to the client, parsing
 * each `data:` line so we can capture the OpenRouter generation id / inline
 * cost and schedule a credit deduction at `[DONE]`.
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

    ctxt.res.write(': connected\n\n');

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

    const reader = externalResponse.body?.getReader();
    if (!reader) throw new Error('No readable stream available');

    let generationId: string | undefined;
    let costInUsd: number | undefined;
    let lastPing = Date.now();

    await proxySSE(
      reader,
      async (data) => {
        if (data === '[DONE]') {
          if (
            generationId != null ||
            (typeof costInUsd === 'number' &&
              Number.isFinite(costInUsd) &&
              costInUsd > 0)
          ) {
            trackCostDeduction(endpointConfig, dbAdapter, matrixUserId, {
              id: generationId,
              usage: { cost: costInUsd },
            });
          } else {
            log.warn(
              `Streaming response for user ${matrixUserId} contained no generation ID or usage cost, skipping credit deduction`,
            );
          }

          ctxt.res.write(`data: [DONE]\n\n`);
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
  ctx.set('Content-Type', 'text/event-stream');
  ctx.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  ctx.set('Connection', 'keep-alive');
  ctx.set('Access-Control-Allow-Origin', '*');
  ctx.set('Access-Control-Allow-Headers', 'Cache-Control');
  ctx.set('X-Accel-Buffering', 'no'); // Disable nginx buffering
  ctx.set('Transfer-Encoding', 'chunked');
  ctx.body = null;
  ctx.status = 200;
  ctx.res.flushHeaders();
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

      for (const line of extractSSELines(buffer)) {
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

function extractSSELines(buffer: string): string[] {
  const lines: string[] = [];
  let lineEnd: number;
  while ((lineEnd = buffer.indexOf('\n')) !== -1) {
    lines.push(buffer.slice(0, lineEnd).trim());
    buffer = buffer.slice(lineEnd + 1);
  }
  return lines;
}
