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
import {
  isEndpointWhitelisted,
  getEndpointConfig,
  getAllowedEndpoints,
  supportsStreaming,
} from '../lib/external-endpoints';
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
    // Set up streaming response headers
    ctxt.set('Content-Type', 'text/event-stream');
    ctxt.set('Cache-Control', 'no-cache');
    ctxt.set('Connection', 'keep-alive');
    ctxt.set('Access-Control-Allow-Origin', '*');
    ctxt.set('Access-Control-Allow-Headers', 'Cache-Control');

    // Start the streaming response
    ctxt.body = null;
    ctxt.status = 200;

    // Make the streaming request to the external API
    const externalResponse = await fetch(url, {
      method,
      headers,
      body: JSON.stringify(requestBody),
    });

    if (!externalResponse.ok) {
      const errorData = await externalResponse.text();
      log.error(
        `Streaming request failed: ${externalResponse.status} - ${errorData}`,
      );
      ctxt.status = externalResponse.status;
      ctxt.body = errorData;
      return;
    }

    // Get the response body as a readable stream
    const reader = externalResponse.body?.getReader();
    if (!reader) {
      throw new Error('No readable stream available');
    }

    let buffer = '';
    let totalTokens = 0;
    let generationId: string | undefined;

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        // Convert the chunk to text
        const chunk = new TextDecoder().decode(value);
        buffer += chunk;

        // Process complete lines from the buffer
        while (true) {
          const lineEnd = buffer.indexOf('\n');
          if (lineEnd === -1) break;

          const line = buffer.substring(0, lineEnd).trim();
          buffer = buffer.substring(lineEnd + 1);

          // Skip empty lines and comments
          if (!line || line.startsWith(':')) {
            continue;
          }

          // Parse SSE data
          if (line.startsWith('data: ')) {
            const data = line.substring(6);

            if (data === '[DONE]') {
              // Stream is complete, calculate credits
              if (generationId) {
                const creditsToDeduct =
                  await endpointConfig.creditStrategy.calculateCredits({
                    id: generationId,
                    usage: { total_tokens: totalTokens },
                  });

                if (creditsToDeduct > 0) {
                  const user = await getUserByMatrixUserId(
                    dbAdapter,
                    matrixUserId,
                  );
                  if (user) {
                    await spendCredits(dbAdapter, user.id, creditsToDeduct);
                    log.info(
                      `Deducted ${creditsToDeduct} credits from user ${matrixUserId} for streaming request to ${url}`,
                    );
                  }
                }
              }

              // Send the final [DONE] message
              ctxt.res.write(`data: [DONE]\n\n`);
              return;
            }

            try {
              const dataObj = JSON.parse(data);

              // Extract generation ID from the first chunk
              if (!generationId && dataObj.id) {
                generationId = dataObj.id;
              }

              // Count tokens if available
              if (dataObj.usage?.total_tokens) {
                totalTokens = dataObj.usage.total_tokens;
              }

              // Forward the data chunk to the client
              ctxt.res.write(`data: ${data}\n\n`);
            } catch (parseError) {
              // Skip invalid JSON chunks
              log.warn('Invalid JSON in streaming response:', data);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  } catch (error) {
    log.error('Error in streaming request:', error);
    Sentry.captureException(error);

    // Send error to client
    ctxt.res.write(
      `data: ${JSON.stringify({ error: 'Streaming error occurred' })}\n\n`,
    );
    ctxt.res.write('data: [DONE]\n\n');
  }
}

interface RequestForwardBody {
  url: string;
  method: string;
  requestBody: string;
  headers?: Record<string, string>;
  isStreaming?: boolean;
}

export default function handleRequestForward({
  dbAdapter,
}: {
  dbAdapter: DBAdapter;
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

      // 3. Validate external endpoint is whitelisted
      if (!isEndpointWhitelisted(json.url)) {
        const allowedEndpoints = getAllowedEndpoints();
        await sendResponseForBadRequest(
          ctxt,
          `Endpoint ${json.url} is not whitelisted. Allowed endpoints: ${allowedEndpoints.join(', ')}`,
        );
        return;
      }

      const endpointConfig = getEndpointConfig(json.url);
      if (!endpointConfig) {
        await sendResponseForSystemError(
          ctxt,
          'Endpoint configuration not found',
        );
        return;
      }

      // 4. Check user has sufficient credits using credit strategy
      const creditValidation =
        await endpointConfig.creditStrategy.validateCredits(
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
        Authorization: `Bearer ${endpointConfig.apiKey}`,
        ...json.headers,
      };

      // Handle streaming requests
      if (json.isStreaming) {
        if (!supportsStreaming(json.url)) {
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
          endpointConfig,
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
        await endpointConfig.creditStrategy.calculateCredits(responseData);

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
          ...Object.fromEntries(externalResponse.headers.entries()),
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
