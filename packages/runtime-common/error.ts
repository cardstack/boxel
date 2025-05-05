import { getReasonPhrase } from 'http-status-codes';
import status from 'statuses';
import { createResponse } from './create-response';
import { RequestContext } from './realm';
import type { SearchResultError } from './realm-index-query-engine';

export interface ErrorDetails {
  status?: number;
  title?: string;
  responseText?: string;
  id?: string | null;
  source?: {
    pointer?: string;
    header?: string;
    parameter?: string;
  };
}

export interface SerializedError {
  message: string;
  status: number;
  title?: string;
  id?: string | null;
  source?: ErrorDetails['source'];
  additionalErrors: any[] | null;
  isCardError?: true;
  deps?: string[];
  stack?: string;
}

export interface CardErrorJSONAPI {
  id?: string; // 404 errors won't necessarily have an id
  status: number;
  title: string;
  message: string;
  realm: string | undefined;
  meta: {
    lastKnownGoodHtml: string | null;
    cardTitle: string | null;
    scopedCssUrls: string[];
    stack: string | null;
    isCreationError?: true;
    responseHeaders?: { [header: string]: string };
  };
  additionalErrors?: (CardError | SearchResultError['error'] | Error)[] | null;
}

export interface CardErrorsJSONAPI {
  errors: CardErrorJSONAPI[];
}

export function formattedError(
  url: string | undefined,
  error: any,
  err?: CardError | Partial<CardErrorJSONAPI>,
): CardErrorsJSONAPI {
  if (isCardError(err)) {
    let cardError;
    let meta: CardErrorJSONAPI['meta'] | undefined;
    let message: string | undefined;
    let additionalError = err.additionalErrors?.[0];

    if (additionalError && 'errorDetail' in additionalError) {
      cardError = additionalError.errorDetail;
      let { lastKnownGoodHtml, scopedCssUrls, cardTitle } = additionalError;
      meta = {
        lastKnownGoodHtml,
        scopedCssUrls,
        stack: cardError.stack ?? err.stack ?? error.stack ?? null,
        cardTitle,
      };
    } else if (isCardError(additionalError)) {
      cardError = additionalError;
    } else {
      message = additionalError?.message;
      cardError = err;
    }

    return {
      errors: [
        {
          id: url,
          message: message ?? cardError.message,
          status: cardError.status,
          title:
            cardError.title ??
            status.message[cardError.status] ??
            cardError.message,
          realm: error.responseHeaders?.get('X-Boxel-Realm-Url'),
          meta: meta ?? {
            lastKnownGoodHtml: null,
            scopedCssUrls: [],
            stack: cardError.stack ?? err.stack ?? error.stack ?? null,
            cardTitle: null,
            ...(cardError.id ? { isCreationError: true } : {}),
          },
          additionalErrors: cardError.additionalErrors,
        },
      ],
    };
  }

  let responseHeaders = error.responseHeaders
    ? Object.fromEntries<string>(error.responseHeaders.entries())
    : undefined;

  let errorStatus = err?.status ?? error.status;
  let errorMessage =
    err?.message ??
    (errorStatus
      ? `Received HTTP ${errorStatus} from server ${
          error.responseText ?? ''
        }`.trim()
      : error.message);

  return {
    errors: [
      {
        id: url,
        status: errorStatus ?? '500',
        title: err?.title ?? status.message[errorStatus] ?? errorMessage,
        message: errorMessage,
        realm: err?.realm ?? error.responseHeaders?.get('X-Boxel-Realm-Url'),
        meta: err?.meta ?? {
          lastKnownGoodHtml: null,
          scopedCssUrls: [],
          stack: error.stack ?? null,
          cardTitle: null,
          ...(err?.id ? { isCreationError: true } : {}),
          ...(responseHeaders ? { responseHeaders } : {}),
        },
      },
    ],
  };
}

export class CardError extends Error implements SerializedError {
  message: string;
  status: number;
  title?: string;
  id?: string | null;
  source?: ErrorDetails['source'];
  responseText?: string;
  isCardError: true = true;
  additionalErrors: (CardError | SearchResultError['error'] | Error)[] | null =
    null;
  deps?: string[];

  constructor(
    message: string,
    { status, title, source, responseText, id }: ErrorDetails = {},
  ) {
    super(message);
    this.id = id || null;
    this.message = message;
    this.status = status || 500;
    this.title = title || getReasonPhrase(this.status);
    this.responseText = responseText;
    this.source = source;
  }
  toJSON() {
    return {
      id: this.id,
      title: this.title,
      message: this.message,
      code: this.status,
      source: this.source,
      stack: this.stack,
    };
  }

  static fromSerializableError(err: any): any {
    if (!err || typeof err !== 'object' || !isCardError(err)) {
      return err;
    }
    let result = new CardError(err.message, {
      status: err.status,
      title: err.title,
      source: err.source,
      id: err.id,
    });
    result.stack = err.stack;
    if (err.additionalErrors) {
      result.additionalErrors = err.additionalErrors.map((inner) =>
        CardError.fromSerializableError(inner),
      );
    }
    return result;
  }

  static async fromFetchResponse(
    url: string,
    response: Response,
  ): Promise<CardError> {
    if (!response.ok) {
      let text = await response.text();
      let maybeErrorJSON: any;
      try {
        maybeErrorJSON = text ? JSON.parse(text) : undefined;
      } catch (err) {
        /* it's ok if we can't parse it*/
      }
      // TODO probably we should refactor this--i don't think our errors follow
      // this shape anymore
      if (
        maybeErrorJSON &&
        typeof maybeErrorJSON === 'object' &&
        'errors' in maybeErrorJSON &&
        Array.isArray(maybeErrorJSON.errors) &&
        maybeErrorJSON.errors.length > 0
      ) {
        let error = CardError.fromSerializableError(maybeErrorJSON.errors[0]);
        if (response.status === 404) {
          error.deps = [response.url];
        }

        return error;
      }
      let error = new CardError(
        `unable to fetch ${url}${!maybeErrorJSON ? ': ' + text : ''}`,
        {
          id: url,
          title: response.statusText,
          status: response.status,
          responseText: text,
        },
      );
      if (response.status === 404) {
        error.deps = [response.url];
      }
      return error;
    }
    throw new CardError(
      `tried to create a card error from a successful fetch response from ${url}, status ${
        response.status
      }, with body: ${await response.text()}`,
    );
  }
}

export function isCardError(err: any): err is CardError {
  return err != null && typeof err === 'object' && err.isCardError;
}

export function printCompilerError(err: any) {
  if (isAcceptableError(err)) {
    return String(err);
  }

  return `${err.message}\n\n${err.stack}`;
}

function isAcceptableError(err: any) {
  return err.isCardstackError || err.code === 'BABEL_PARSE_ERROR';
}

export function serializableError(err: any): any {
  if (!err || typeof err !== 'object' || !isCardError(err)) {
    // rely on the best-effort serialization that we'll get from, for example,
    // "pg" as it puts this object into jsonb
    return err;
  }

  let result = Object.assign({}, err, {
    stack: err.stack,
    message: err.message,
  });
  result.additionalErrors =
    result.additionalErrors?.map((inner) => serializableError(inner)) ?? null;
  return result;
}

export function responseWithError(
  error: CardError,
  requestContext: RequestContext,
): Response;
export function responseWithError(
  body: Record<string, any> | undefined,
  error: CardError,
  requestContext: RequestContext,
): Response;
export function responseWithError(
  bodyOrError: CardError | Record<string, any> | undefined,
  errorOrRequestContext: RequestContext | CardError,
  maybeRequestContext?: RequestContext,
): Response {
  let body: Record<string, any> | undefined;
  let error: CardError | undefined;
  let requestContext: RequestContext | undefined;
  if (bodyOrError instanceof CardError) {
    error = bodyOrError;
  } else {
    body = bodyOrError;
  }
  if (errorOrRequestContext instanceof CardError) {
    error = errorOrRequestContext;
  } else {
    requestContext = errorOrRequestContext;
  }
  if (maybeRequestContext) {
    requestContext = maybeRequestContext;
  }
  if (!error) {
    throw new Error(`Could not fashion error response, error is missing`);
  }
  if (!requestContext) {
    throw new Error(
      `Could not fashion error response, requestContext is missing`,
    );
  }
  return createResponse({
    body: JSON.stringify({ errors: [body ? body : serializableError(error)] }),
    init: {
      status: error.status,
      statusText: error.title,
      headers: { 'content-type': 'application/json' },
    },
    requestContext,
  });
}

export function methodNotAllowed(
  request: Request,
  requestContext: RequestContext,
): Response {
  return responseWithError(
    new CardError(`${request.method} not allowed for ${request.url}`, {
      status: 405,
    }),
    requestContext,
  );
}

export function notFound(
  request: Request,
  requestContext: RequestContext,
  message = `Could not find ${request.url}`,
): Response {
  return responseWithError(
    new CardError(message, { status: 404, id: request.url }),
    requestContext,
  );
}

export function badRequest(
  message: string,
  requestContext: RequestContext,
): Response {
  return responseWithError(
    new CardError(message, { status: 400 }),
    requestContext,
  );
}

export function systemUnavailable(
  message: string,
  requestContext: RequestContext,
): Response {
  return responseWithError(
    new CardError(message, { status: 503 }),
    requestContext,
  );
}

export function systemError({
  requestContext,
  message,
  additionalError,
  body,
  id,
}: {
  requestContext: RequestContext;
  message: string;
  additionalError?: CardError | Error;
  body?: Record<string, any>;
  id?: string;
}): Response {
  let err = new CardError(message, { status: 500, ...(id ? { id } : {}) });
  if (additionalError) {
    err.additionalErrors = [additionalError];
  }
  return responseWithError(body, err, requestContext);
}
