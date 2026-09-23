import type Koa from 'koa';
import type { DBAdapter } from '@cardstack/runtime-common';
import { logger, SupportedMimeType } from '@cardstack/runtime-common';
import {
  sendResponseForBadRequest,
  sendResponseForSystemError,
  sendResponseForForbiddenRequest,
  setContextResponse,
  fetchRequestFromContext,
} from '../middleware/index.ts';
import { AllowedProxyDestinations } from '../lib/allowed-proxy-destinations.ts';
import {
  clientDisconnectSignal,
  handleStreamingRequest,
  isClientDisconnectError,
  upstreamCallSignal,
} from '../lib/proxy-forward.ts';
import { withBillableCall } from '../lib/billable-call.ts';
import * as Sentry from '@sentry/node';

const log = logger('request-forward');

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
    // A caller that stops waiting must take the upstream call with it. Each
    // forward occupies one of the user's limited in-flight slots until it
    // ends, so an upstream request nobody is reading any more keeps that slot
    // for as long as it runs — on a slow model call, over a minute.
    let clientGone = clientDisconnectSignal(ctxt);

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

      // 4. Forward request to external endpoint
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

      if (
        json.stream &&
        !(await destinationsConfig.supportsStreaming(json.url))
      ) {
        await sendResponseForBadRequest(
          ctxt,
          `Streaming is not supported for endpoint ${json.url}`,
        );
        return;
      }

      // 5. Admit the call against the user's credits, forward it, and charge
      // for what it cost. See withBillableCall for how one user's concurrent
      // calls are bounded.
      await withBillableCall(
        {
          dbAdapter,
          matrixUserId,
          creditStrategy: destinationConfig.creditStrategy,
          signal: clientGone,
          destination: destinationConfig.url,
        },
        (errorMessage) => sendResponseForForbiddenRequest(ctxt, errorMessage),
        async () => {
          if (json.stream) {
            return await handleStreamingRequest(
              ctxt,
              finalUrl,
              json.method,
              headers,
              finalBody,
              matrixUserId,
              clientGone,
            );
          }

          // Cancelling the upstream call is what frees the user's in-flight
          // slot: without it the slot is held until a response the client
          // will never read finally arrives. The signal is released once that
          // response exists, so reading it and recording its cost cannot be
          // cancelled — by then the provider has already generated and billed
          // for the tokens, and abandoning the read only loses the charge.
          const upstreamCall = upstreamCallSignal(clientGone);
          const fetchOptions: RequestInit = {
            method: json.method,
            headers,
            signal: upstreamCall.signal,
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
          const externalResponse = await globalThis.fetch(
            finalUrl,
            fetchOptions,
          );
          upstreamCall.release();

          const responseData = await externalResponse.json();

          const response = new Response(JSON.stringify(responseData), {
            status: externalResponse.status,
            statusText: externalResponse.statusText,
            headers: {
              'content-type': SupportedMimeType.JSON,
            },
          });

          await setContextResponse(ctxt, response);
          return responseData;
        },
      );
    } catch (error) {
      if (isClientDisconnectError(error, clientGone)) {
        // Cancelling on purpose is not a fault: there is no one left to
        // answer and nothing an on-call engineer could act on, so this stays
        // out of the error channel.
        log.info(
          'Client disconnected during request forward; upstream call cancelled',
        );
        return;
      }
      log.error('Error in request forward handler:', error);
      Sentry.captureException(error);
      await sendResponseForSystemError(
        ctxt,
        'An error occurred while processing the request',
      );
    }
  };
}
