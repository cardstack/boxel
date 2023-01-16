import { getReasonPhrase } from "http-status-codes";
export interface ErrorDetails {
  status?: number;
  title?: string;
  source?: {
    pointer?: string;
    header?: string;
    parameter?: string;
  };
}

export interface SerializedError {
  detail: string;
  status: number;
  title?: string;
  source?: ErrorDetails["source"];
  additionalErrors: any[] | null;
  isCardError?: true;
  deps?: string[];
  stack?: string;
}

export class CardError extends Error implements SerializedError {
  detail: string;
  status: number;
  title?: string;
  source?: ErrorDetails["source"];
  isCardError: true = true;
  additionalErrors: (CardError | Error)[] | null = null;
  deps?: string[];

  constructor(detail: string, { status, title, source }: ErrorDetails = {}) {
    super(detail);
    this.detail = detail;
    this.status = status || 500;
    this.title = title || getReasonPhrase(this.status);
    this.source = source;
  }
  toJSON() {
    return {
      title: this.title,
      detail: this.detail,
      code: this.status,
      source: this.source,
      stack: this.stack,
    };
  }

  static fromSerializableError(err: any): any {
    if (!err || typeof err !== "object" || !isCardError(err)) {
      return err;
    }
    let result = new CardError(err.detail, {
      status: err.status,
      title: err.title,
      source: err.source,
    });
    result.stack = err.stack;
    if (err.additionalErrors) {
      result.additionalErrors = err.additionalErrors.map((inner) =>
        CardError.fromSerializableError(inner)
      );
    }
    return result;
  }

  static async fromFetchResponse(
    url: string,
    response: Response
  ): Promise<CardError> {
    if (!response.ok) {
      let text: string | undefined;
      try {
        text = await response.text();
      } catch (err) {
        throw err;
      }
      let maybeErrorJSON: any;
      try {
        maybeErrorJSON = text ? JSON.parse(text) : undefined;
      } catch (err) {
        /* it's ok if we can't parse it*/
      }
      if (
        maybeErrorJSON &&
        typeof maybeErrorJSON === "object" &&
        "errors" in maybeErrorJSON &&
        Array.isArray(maybeErrorJSON.errors) &&
        maybeErrorJSON.errors.length > 0
      ) {
        return CardError.fromSerializableError(maybeErrorJSON.errors[0]);
      }
      return new CardError(
        `unable to fetch ${url}${!maybeErrorJSON ? ": " + text : ""}`,
        {
          title: response.statusText,
          status: response.status,
        }
      );
    }
    throw new CardError(
      `tried to create a card error from a successful fetch response from ${url}, status ${
        response.status
      }, with body: ${await response.text()}`
    );
  }
}

export function isCardError(err: any): err is CardError {
  return err != null && typeof err === "object" && err.isCardError;
}

export function printCompilerError(err: any) {
  if (isAcceptableError(err)) {
    return String(err);
  }

  return `${err.message}\n\n${err.stack}`;
}

function isAcceptableError(err: any) {
  return err.isCardstackError || err.code === "BABEL_PARSE_ERROR";
}

export function serializableError(err: any): any {
  if (!err || typeof err !== "object" || !isCardError(err)) {
    // rely on the best-effort serialization that we'll get from, for example,
    // "pg" as it puts this object into jsonb
    return err;
  }

  let result = Object.assign({}, err, { stack: err.stack });
  result.additionalErrors =
    result.additionalErrors?.map((inner) => serializableError(inner)) ?? null;
  return result;
}

export function responseWithError(
  error: CardError,
  response: Response
): Response {
  response.json = async () => {
    errors: [serializableError(error)];
  };
  // response.status = error.status; // TODO
  // response.statusText = error.title; // TODO
  response.headers.set("content-type", "application/vnd.api+json");
  return response;
}

export function methodNotAllowed(
  request: Request,
  response: Response
): Response {
  return responseWithError(
    new CardError(`${request.method} not allowed for ${request.url}`, {
      status: 405,
    }),
    response
  );
}

export function notFound(
  request: Request,
  response: Response,
  message = `Could not find ${request.url}`
): Response {
  return responseWithError(new CardError(message, { status: 404 }), response);
}

export function badRequest(response: Response, message: string): Response {
  return responseWithError(new CardError(message, { status: 400 }), response);
}

export function systemUnavailable(
  response: Response,
  message: string
): Response {
  return responseWithError(new CardError(message, { status: 503 }), response);
}

export function systemError(
  response: Response,
  message: string,
  additionalError?: CardError | Error
): Response {
  let err = new CardError(message, { status: 500 });
  if (additionalError) {
    err.additionalErrors = [additionalError];
  }
  return responseWithError(err, response);
}
