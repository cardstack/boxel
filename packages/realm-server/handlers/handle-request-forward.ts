import Koa from 'koa';
import {
  DBAdapter,
  logger,
  SupportedMimeType,
} from '@cardstack/runtime-common';
import {
  sendResponseForBadRequest,
  sendResponseForSystemError,
  sendResponseForForbiddenRequest,
  setContextResponse,
  fetchRequestFromContext,
} from '../middleware';
import {
  spendCredits,
  getUserByMatrixUserId,
} from '@cardstack/billing/billing-queries';
import { AllowedProxyDestinations } from '../lib/allowed-proxy-destinations';
import * as Sentry from '@sentry/node';

const log = logger('request-forward');

async function handleStreamingRequest(
  ctxt: Koa.Context,
  url: string,
  method: string,
  headers: Record<string, string>,
  requestBody: any,
  endpointConfig: any,
  dbAdapter: DBAdapter,
  matrixUserId: string,
) {
  try {
    setupSSEHeaders(ctxt);

    const externalResponse = await fetch(url, {
      method,
      headers,
      body: JSON.stringify(requestBody),
    });

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

    let totalTokens = 0;
    let generationId: string | undefined;
    let lastPing = Date.now();

    await proxySSE(
      reader,
      async (data) => {
        // Handle end of stream
        if (data === '[DONE]') {
          if (generationId) {
            const creditsToDeduct =
              await endpointConfig.creditStrategy.calculateCredits({
                id: generationId,
                usage: { total_tokens: totalTokens },
              });

            if (creditsToDeduct > 0) {
              const user = await getUserByMatrixUserId(dbAdapter, matrixUserId);
              if (user) {
                await spendCredits(dbAdapter, user.id, creditsToDeduct);
                log.info(
                  `Deducted ${creditsToDeduct} credits from user ${matrixUserId} for streaming request to ${url}`,
                );
              }
            }
          }
          ctxt.res.write(`data: [DONE]\n\n`);
          return 'stop';
        }

        // Try parsing JSON data
        try {
          const dataObj = JSON.parse(data);

          if (!generationId && dataObj.id) {
            generationId = dataObj.id;
          }

          if (dataObj.usage?.total_tokens) {
            totalTokens = dataObj.usage.total_tokens;
          }
        } catch {
          log.warn('Invalid JSON in streaming response:', data);
        }

        ctxt.res.write(`data: ${data}\n\n`);
        return;
      },
      () => {
        // Keep-alive ping
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

/** ---------------------------
 * Helper functions
 * --------------------------- */
const KEEP_ALIVE_INTERVAL_MS = 15000;

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

interface RequestForwardBody {
  url: string;
  method: string;
  requestBody: string;
  headers?: Record<string, string>;
  stream?: boolean;
}

export default function handleRequestForward({
  dbAdapter,
  allowedProxyDestinations,
}: {
  dbAdapter: DBAdapter;
  allowedProxyDestinations: string;
}) {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    try {
      // 1. Validate JWT token and extract user
      const token = ctxt.state.token;
      if (!token) {
        await sendResponseForForbiddenRequest(
          ctxt,
          'Token is required to forward requests',
        );
        return;
      }

      const { user: matrixUserId } = token;

      // 2. Parse request body
      const request = await fetchRequestFromContext(ctxt);
      const body = await request.text();
      let json: RequestForwardBody;

      try {
        json = JSON.parse(body);
      } catch (e) {
        await sendResponseForBadRequest(ctxt, 'Request body is not valid JSON');
        return;
      }

      // Validate required fields
      if (!json.url || !json.method || !json.requestBody) {
        await sendResponseForBadRequest(
          ctxt,
          'Request body must include url, method, and requestBody fields',
        );
        return;
      }

      // 3. Validate proxy destination is allowed and get config
      const destinationsConfig = AllowedProxyDestinations.getInstance(
        allowedProxyDestinations,
      );
      const destinationConfig = destinationsConfig.getDestinationConfig(
        json.url,
      );

      if (!destinationConfig) {
        const allowedDestinations = destinationsConfig.getAllowedDestinations();
        await sendResponseForBadRequest(
          ctxt,
          `Endpoint ${json.url} is not whitelisted. Allowed endpoints: ${allowedDestinations.join(', ')}`,
        );
        return;
      }

      // 4. Check user has sufficient credits using credit strategy
      const creditValidation =
        await destinationConfig.creditStrategy.validateCredits(
          dbAdapter,
          matrixUserId,
        );

      if (!creditValidation.hasEnoughCredits) {
        await sendResponseForForbiddenRequest(
          ctxt,
          creditValidation.errorMessage || 'Insufficient credits',
        );
        return;
      }

      // 5. Forward request to external endpoint
      let requestBody;
      try {
        requestBody = JSON.parse(json.requestBody);
      } catch (e) {
        await sendResponseForBadRequest(ctxt, 'requestBody must be valid JSON');
        return;
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${destinationConfig.apiKey}`,
        ...json.headers,
      };

      // Handle streaming requests
      if (json.stream) {
        if (!destinationsConfig.supportsStreaming(json.url)) {
          await sendResponseForBadRequest(
            ctxt,
            `Streaming is not supported for endpoint ${json.url}`,
          );
          return;
        }

        await handleStreamingRequest(
          ctxt,
          json.url,
          json.method,
          headers,
          requestBody,
          destinationConfig,
          dbAdapter,
          matrixUserId,
        );
        return;
      }

      // Handle non-streaming requests
      const externalResponse = await fetch(json.url, {
        method: json.method,
        headers,
        body: JSON.stringify(requestBody),
      });

      const responseData = await externalResponse.json();

      // 6. Calculate and deduct credits using credit strategy
      const creditsToDeduct =
        await destinationConfig.creditStrategy.calculateCredits(responseData);

      if (creditsToDeduct > 0) {
        // Get user for credit deduction
        const user = await getUserByMatrixUserId(dbAdapter, matrixUserId);
        if (user) {
          await spendCredits(dbAdapter, user.id, creditsToDeduct);

          log.info(
            `Deducted ${creditsToDeduct} credits from user ${matrixUserId} for request to ${json.url}`,
          );
        }
      }

      // 7. Return response
      const response = new Response(JSON.stringify(responseData), {
        status: externalResponse.status,
        statusText: externalResponse.statusText,
        headers: {
          'content-type': SupportedMimeType.JSON,
        },
      });

      await setContextResponse(ctxt, response);
    } catch (error) {
      log.error('Error in request forward handler:', error);
      Sentry.captureException(error);
      await sendResponseForSystemError(
        ctxt,
        'An error occurred while processing the request',
      );
    }
  };
}
