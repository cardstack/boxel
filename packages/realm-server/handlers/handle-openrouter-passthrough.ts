import type Koa from 'koa';
import type { DBAdapter } from '@cardstack/runtime-common';
import { logger, SupportedMimeType } from '@cardstack/runtime-common';
import * as Sentry from '@sentry/node';

import { AllowedProxyDestinations } from '../lib/allowed-proxy-destinations';
import {
  awaitPendingCost,
  handleStreamingRequest,
  trackCostDeduction,
  type StreamingInstrumentation,
} from '../lib/proxy-forward';
import {
  analyzeRequest,
  createResponseAnalyzer,
  isInstrumentationEnabled,
  writeInstrumentationRecord,
  type InstrumentationRecord,
} from '../lib/proxy-instrument';
import {
  fetchRequestFromContext,
  sendResponseForBadRequest,
  sendResponseForForbiddenRequest,
  sendResponseForSystemError,
  setContextResponse,
} from '../middleware';

const log = logger('openrouter-passthrough');

const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * OpenAI-compatible passthrough to OpenRouter chat completions.
 *
 * Unlike `/_request-forward` (which expects a `{ url, method, requestBody }`
 * envelope and exists to proxy arbitrary whitelisted destinations), this
 * endpoint accepts a verbatim OpenAI chat-completions body and pins the
 * upstream destination to `OPENROUTER_CHAT_URL` server-side. It exists so
 * software-factory's opencode backend (and any other OpenAI-compatible
 * client) can point its `baseURL` straight at the realm server, without an
 * in-process relay translating between the two shapes.
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

      try {
        await awaitPendingCost(matrixUserId);
      } catch (e) {
        log.error('Error waiting for pending cost:', e);
        await sendResponseForSystemError(
          ctxt,
          'There was an error saving your Boxel credits usage. Try again or contact support if the problem persists.',
        );
        return;
      }

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

      // Instrumentation (toggled by FACTORY_INSTRUMENT_PATH). Captures
      // request prompt sizes and per-response tool-call counts /
      // timing / usage to a JSONL file. See lib/proxy-instrument.ts
      // and packages/software-factory/OPENCODE_PERFORMANCE.md.
      const instrumentEnabled = isInstrumentationEnabled();
      const requestStats = instrumentEnabled ? analyzeRequest(rawBody) : null;
      const responseAnalyzer = instrumentEnabled
        ? createResponseAnalyzer()
        : null;
      const writeStreamingRecord = (): void => {
        if (!instrumentEnabled || !requestStats || !responseAnalyzer) return;
        const record: InstrumentationRecord = {
          ts: new Date().toISOString(),
          user: matrixUserId,
          endpoint: 'openrouter-passthrough',
          request: requestStats,
          response: responseAnalyzer.finalize(),
        };
        writeInstrumentationRecord(record);
      };

      if (isStreaming) {
        if (!destinationConfig.supportsStreaming) {
          await sendResponseForBadRequest(
            ctxt,
            'Streaming is not supported for the OpenRouter passthrough',
          );
          return;
        }
        const streamingInstrument: StreamingInstrumentation | undefined =
          responseAnalyzer
            ? {
                onSSEData: responseAnalyzer.onSSEData,
                onDone: writeStreamingRecord,
              }
            : undefined;
        await handleStreamingRequest(
          ctxt,
          OPENROUTER_CHAT_URL,
          'POST',
          headers,
          finalBody,
          destinationConfig,
          dbAdapter,
          matrixUserId,
          streamingInstrument,
        );
        return;
      }

      const nonStreamingStart = Date.now();
      const externalResponse = await globalThis.fetch(OPENROUTER_CHAT_URL, {
        method: 'POST',
        headers,
        body: finalBody,
      });
      const responseData = await externalResponse.json();

      trackCostDeduction(
        destinationConfig,
        dbAdapter,
        matrixUserId,
        responseData,
      );

      // For non-streaming responses, mine the same fields the SSE
      // analyzer collects so the JSONL stays uniform across modes.
      if (instrumentEnabled && requestStats) {
        const choice = (responseData?.choices ?? [])[0] ?? {};
        const message = choice.message ?? {};
        const toolCalls = Array.isArray(message.tool_calls)
          ? message.tool_calls
          : [];
        const usage = responseData?.usage ?? {};
        const record: InstrumentationRecord = {
          ts: new Date().toISOString(),
          user: matrixUserId,
          endpoint: 'openrouter-passthrough',
          request: requestStats,
          response: {
            toolCallsCount: toolCalls.length,
            toolCallNames: toolCalls.map(
              (tc: { function?: { name?: string } }) =>
                tc.function?.name ?? '<unknown>',
            ),
            assistantTextChars:
              typeof message.content === 'string' ? message.content.length : 0,
            finishReason:
              typeof choice.finish_reason === 'string'
                ? choice.finish_reason
                : null,
            usagePromptTokens:
              typeof usage.prompt_tokens === 'number'
                ? usage.prompt_tokens
                : null,
            usageCompletionTokens:
              typeof usage.completion_tokens === 'number'
                ? usage.completion_tokens
                : null,
            usageTotalTokens:
              typeof usage.total_tokens === 'number'
                ? usage.total_tokens
                : null,
            ttfbMs: null,
            durationMs: Date.now() - nonStreamingStart,
          },
        };
        writeInstrumentationRecord(record);
      }

      const response = new Response(JSON.stringify(responseData), {
        status: externalResponse.status,
        statusText: externalResponse.statusText,
        headers: { 'content-type': SupportedMimeType.JSON },
      });
      await setContextResponse(ctxt, response);
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
