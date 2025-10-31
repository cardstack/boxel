import type Koa from 'koa';
import type { DBAdapter } from '@cardstack/runtime-common';
import { logger, SupportedMimeType } from '@cardstack/runtime-common';
import {
  sendResponseForBadRequest,
  sendResponseForSystemError,
  sendResponseForForbiddenRequest,
  setContextResponse,
  fetchRequestFromContext,
} from '../middleware';
import { AllowedProxyDestinations } from '../lib/allowed-proxy-destinations';
import * as Sentry from '@sentry/node';

const log = logger('request-forward');

async function handleStreamingRequest(
  ctxt: Koa.Context,
  url: string,
  method: string,
  headers: Record<string, string>,
  requestBody: BodyInit | undefined,
  endpointConfig: any,
  dbAdapter: DBAdapter,
  matrixUserId: string,
) {
  try {
    setupSSEHeaders(ctxt);

    const fetchInit: RequestInit = {
      method,
      headers,
    };
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
    let lastPing = Date.now();

    await proxySSE(
      reader,
      async (data) => {
        // Handle end of stream
        if (data === '[DONE]') {
          if (generationId) {
            // Create a mock response object with the generation ID for the credit strategy
            const mockResponse = { id: generationId };
            await endpointConfig.creditStrategy.saveUsageCost(
              dbAdapter,
              matrixUserId,
              mockResponse,
            );
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

interface MultipartFileField {
  filename: string;
  content: string;
  contentType?: string;
}

function isMultipartFileField(value: unknown): value is MultipartFileField {
  return (
    typeof value === 'object' &&
    value !== null &&
    'filename' in value &&
    'content' in value &&
    typeof (value as { filename: unknown }).filename === 'string' &&
    typeof (value as { content: unknown }).content === 'string'
  );
}

function jsonToMultipartFormData(jsonData: Record<string, unknown>): {
  body: BodyInit;
  boundary: string;
} {
  const boundary = `----WebKitFormBoundary${Math.random()
    .toString(36)
    .slice(2)}`;
  const parts: Uint8Array[] = [];
  const encoder = new TextEncoder();

  const pushString = (value: string) => {
    parts.push(encoder.encode(value));
  };

  for (const [key, value] of Object.entries(jsonData)) {
    pushString(`--${boundary}\r\n`);

    if (isMultipartFileField(value)) {
      const fileField = value;
      const contentType = fileField.contentType || 'application/octet-stream';
      pushString(
        `Content-Disposition: form-data; name="${key}"; filename="${fileField.filename}"\r\n`,
      );
      pushString(`Content-Type: ${contentType}\r\n\r\n`);
      parts.push(Buffer.from(fileField.content, 'base64'));
      pushString('\r\n');
      continue;
    }

    const normalisedValue =
      value === null || value === undefined
        ? ''
        : typeof value === 'object'
          ? JSON.stringify(value)
          : String(value);

    pushString(`Content-Disposition: form-data; name="${key}"\r\n\r\n`);
    pushString(normalisedValue);
    pushString('\r\n');
  }

  pushString(`--${boundary}--\r\n`);

  const totalLength = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const body = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    body.set(part, offset);
    offset += part.byteLength;
  }

  return {
    body,
    boundary,
  };
}

function hasContentTypeHeader(headers: Record<string, string>): boolean {
  return Object.keys(headers).some(
    (header) => header.toLowerCase() === 'content-type',
  );
}

function setContentTypeHeader(
  headers: Record<string, string>,
  value: string,
): void {
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === 'content-type') {
      delete headers[key];
    }
  }
  headers['Content-Type'] = value;
}

interface RequestForwardBody {
  url: string;
  method: string;
  requestBody: string;
  headers?: Record<string, string>;
  stream?: boolean;
  multipart?: boolean;
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
      if (!json.url || !json.method) {
        await sendResponseForBadRequest(
          ctxt,
          'Request body must include url and method fields',
        );
        return;
      }

      // requestBody is required for non-GET requests
      if (json.method !== 'GET' && !json.requestBody) {
        await sendResponseForBadRequest(
          ctxt,
          'Request body must include requestBody field for non-GET requests',
        );
        return;
      }

      // 3. Validate proxy destination is allowed and get config
      const destinationsConfig =
        AllowedProxyDestinations.getInstance(dbAdapter);
      const destinationConfig = await destinationsConfig.getDestinationConfig(
        json.url,
      );

      if (!destinationConfig) {
        await sendResponseForBadRequest(
          ctxt,
          `Endpoint ${json.url} is not whitelisted.`,
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
      let parsedRequestBody: unknown;
      if (json.requestBody) {
        try {
          parsedRequestBody = JSON.parse(json.requestBody);
        } catch (e) {
          await sendResponseForBadRequest(
            ctxt,
            'requestBody must be valid JSON',
          );
          return;
        }
      }

      // Build headers and URL based on authentication method
      let finalUrl = json.url;
      const headers: Record<string, string> = {
        ...(json.headers ?? {}),
      };

      // Add authentication based on the configured method
      if (destinationConfig.authMethod === 'url-parameter') {
        const paramName = destinationConfig.authParameterName || 'key';
        const url = new URL(json.url);
        url.searchParams.set(paramName, destinationConfig.apiKey);
        finalUrl = url.toString();
      } else if (
        destinationConfig.authMethod === 'header' &&
        destinationConfig.authParameterName
      ) {
        headers[destinationConfig.authParameterName] =
          `Bearer ${destinationConfig.apiKey}`;
      } else {
        // Default to header authentication
        headers.Authorization = `Bearer ${destinationConfig.apiKey}`;
      }

      let finalBody: BodyInit | undefined;
      if (json.multipart) {
        const multipartPayload = (parsedRequestBody ?? {}) as Record<
          string,
          unknown
        >;
        if (
          typeof multipartPayload !== 'object' ||
          multipartPayload === null ||
          Array.isArray(multipartPayload)
        ) {
          await sendResponseForBadRequest(
            ctxt,
            'requestBody must be a JSON object when multipart is true',
          );
          return;
        }

        try {
          const { body, boundary } = jsonToMultipartFormData(multipartPayload);
          finalBody = body;
          setContentTypeHeader(
            headers,
            `multipart/form-data; boundary=${boundary}`,
          );
        } catch (error) {
          log.error(
            'Error converting request body to multipart form-data:',
            error,
          );
          await sendResponseForBadRequest(
            ctxt,
            'Failed to convert request body to multipart form-data',
          );
          return;
        }
      } else if (parsedRequestBody !== undefined) {
        finalBody = JSON.stringify(parsedRequestBody);
        if (!hasContentTypeHeader(headers)) {
          setContentTypeHeader(headers, 'application/json');
        }
      } else if (!hasContentTypeHeader(headers)) {
        setContentTypeHeader(headers, 'application/json');
      }

      // Handle streaming requests
      if (json.stream) {
        if (!(await destinationsConfig.supportsStreaming(json.url))) {
          await sendResponseForBadRequest(
            ctxt,
            `Streaming is not supported for endpoint ${json.url}`,
          );
          return;
        }

        await handleStreamingRequest(
          ctxt,
          finalUrl,
          json.method,
          headers,
          finalBody,
          destinationConfig,
          dbAdapter,
          matrixUserId,
        );
        return;
      }

      // Handle non-streaming requests
      const fetchOptions: RequestInit = {
        method: json.method,
        headers,
      };

      // Only add body for non-GET requests or when requestBody is provided
      if (json.method !== 'GET' && finalBody !== undefined) {
        fetchOptions.body = finalBody;
      }

      // FIXME undici or something is swallowing the errors, making them useless:
      /*
        Error in request forward handler: TypeError: fetch failed
          at node:internal/deps/undici/undici:13510:13
          at processTicksAndRejections (node:internal/process/task_queues:105:5)
      */
      const externalResponse = await globalThis.fetch(finalUrl, fetchOptions);

      const responseData = await externalResponse.json();

      // 6. Calculate and deduct credits using credit strategy
      await destinationConfig.creditStrategy.saveUsageCost(
        dbAdapter,
        matrixUserId,
        responseData,
      );

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
