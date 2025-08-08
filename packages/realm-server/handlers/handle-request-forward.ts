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
} from '../lib/external-endpoints';
import * as Sentry from '@sentry/node';

const log = logger('request-forward');

interface RequestForwardBody {
  url: string;
  method: string;
  requestBody: string;
  headers?: Record<string, string>;
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
