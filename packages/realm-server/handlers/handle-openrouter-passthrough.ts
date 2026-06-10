import type Koa from 'koa';
import type { DBAdapter } from '@cardstack/runtime-common';
import { logger, SupportedMimeType } from '@cardstack/runtime-common';
import * as Sentry from '@sentry/node';

import { AllowedProxyDestinations } from '../lib/allowed-proxy-destinations.ts';
import { handleStreamingRequest } from '../lib/proxy-forward.ts';
import {
  fetchRequestFromContext,
  sendResponseForBadRequest,
  sendResponseForForbiddenRequest,
  sendResponseForSystemError,
  setContextResponse,
} from '../middleware/index.ts';

const log = logger('openrouter-passthrough');

const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * OpenAI-compatible passthrough to OpenRouter chat completions.
 *
 * Unlike `/_request-forward` (which expects a `{ url, method, requestBody }`
 * envelope and exists to proxy arbitrary whitelisted destinations), this
 * endpoint accepts a verbatim OpenAI chat-completions body and pins the
 * upstream destination to `OPENROUTER_CHAT_URL` server-side, so an
 * OpenAI-compatible client (e.g. software-factory's opencode backend)
 * can point its `baseURL` straight at the realm server.
 *
 * Auth: the realm-server JWT (via `jwtMiddleware`). The static
 * `Authorization` header AI-SDK clients stamp onto every request goes
 * here; we never expose the OpenRouter API key to the caller.
 *
 * Streaming: driven by `stream: true` inside the OpenAI body — the caller
 * does not pass it as a query string.
 *
 * Credit accounting / streaming framing is shared with `_request-forward`
 * via `lib/proxy-forward`, so per-user cost-deduction ordering is preserved
 * across both endpoints.
 */
export default function handleOpenRouterPassthrough({
  dbAdapter,
}: {
  dbAdapter: DBAdapter;
}) {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    try {
      const token = ctxt.state.token;
      if (!token) {
        await sendResponseForForbiddenRequest(
          ctxt,
          'Token is required to forward requests',
        );
        return;
      }
      const { user: matrixUserId } = token;

      const request = await fetchRequestFromContext(ctxt);
      const rawBody = await request.text();
      let openAIBody: Record<string, unknown>;
      try {
        openAIBody = JSON.parse(rawBody);
      } catch {
        await sendResponseForBadRequest(ctxt, 'Request body is not valid JSON');
        return;
      }
      if (
        typeof openAIBody !== 'object' ||
        openAIBody === null ||
        Array.isArray(openAIBody)
      ) {
        await sendResponseForBadRequest(
          ctxt,
          'Request body must be a JSON object',
        );
        return;
      }
      const isStreaming = openAIBody.stream === true;

      const destinationsConfig =
        AllowedProxyDestinations.getInstance(dbAdapter);
      const destinationConfig =
        await destinationsConfig.getDestinationConfig(OPENROUTER_CHAT_URL);
      if (!destinationConfig) {
        // Misconfiguration on the server side — OpenRouter must be in the
        // proxy_endpoints whitelist for this endpoint to function.
        await sendResponseForSystemError(
          ctxt,
          'OpenRouter passthrough is not configured on this realm server',
        );
        return;
      }

      if (isStreaming && !destinationConfig.supportsStreaming) {
        await sendResponseForBadRequest(
          ctxt,
          'Streaming is not supported for the OpenRouter passthrough',
        );
        return;
      }

      // Serialize concurrent requests from the same matrix user across
      // replicas: the next request can't kick off another billable upstream
      // call before the previous request's cost row has landed in the
      // credits ledger. The lock is held through validate-credits → upstream
      // call → save-cost; on streaming, save-cost happens inside
      // handleStreamingRequest after the `[DONE]` marker.
      await dbAdapter.withUserCostLock(matrixUserId, async () => {
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

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${destinationConfig.apiKey}`,
        };
        const finalBody = JSON.stringify(openAIBody);

        if (isStreaming) {
          await handleStreamingRequest(
            ctxt,
            OPENROUTER_CHAT_URL,
            'POST',
            headers,
            finalBody,
            destinationConfig,
            dbAdapter,
            matrixUserId,
          );
          return;
        }

        const externalResponse = await globalThis.fetch(OPENROUTER_CHAT_URL, {
          method: 'POST',
          headers,
          body: finalBody,
        });
        const responseData = await externalResponse.json();

        await destinationConfig.creditStrategy.saveUsageCost(
          dbAdapter,
          matrixUserId,
          responseData,
        );

        const response = new Response(JSON.stringify(responseData), {
          status: externalResponse.status,
          statusText: externalResponse.statusText,
          headers: { 'content-type': SupportedMimeType.JSON },
        });
        await setContextResponse(ctxt, response);
      });
    } catch (error) {
      log.error('Error in openrouter-passthrough handler:', error);
      Sentry.captureException(error);
      await sendResponseForSystemError(
        ctxt,
        'An error occurred while processing the request',
      );
    }
  };
}
