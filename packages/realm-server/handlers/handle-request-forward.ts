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
import { handleStreamingRequest } from '../lib/proxy-forward';
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

      // 5. Serialize concurrent requests from the same matrix user across
      // replicas: the next request can't kick off another billable upstream
      // call before the previous request's cost row has landed in the
      // credits ledger. The lock is held through validate-credits →
      // upstream call → save-cost; on streaming, save-cost happens inside
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

        if (json.stream) {
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

        await destinationConfig.creditStrategy.saveUsageCost(
          dbAdapter,
          matrixUserId,
          responseData,
        );

        const response = new Response(JSON.stringify(responseData), {
          status: externalResponse.status,
          statusText: externalResponse.statusText,
          headers: {
            'content-type': SupportedMimeType.JSON,
          },
        });

        await setContextResponse(ctxt, response);
      });
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
