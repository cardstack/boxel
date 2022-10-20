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

export class CardError extends Error {
  detail: string;
  status: number;
  title?: string;
  source?: ErrorDetails["source"];
  isCardError: true = true;
  additionalErrors: (CardError | Error)[] | null = null;

  // If this error originated from a row in the search index that has stored
  // `compilerErrors`, this propagates forward the card URLs that were
  // dependencies of the failed compile.
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
    };
  }

  static fromSerializableError(err: any): any {
    if (!err || typeof err !== "object" || !isCardError(err)) {
      return err;
    }
    let result = new this(err.detail, {
      status: err.status,
      title: err.title,
      source: err.source,
    });
    if (err.additionalErrors) {
      result.additionalErrors = err.additionalErrors.map((inner) =>
        this.fromSerializableError(inner)
      );
    }
    return result;
  }

  static async fromFetchResponse(
    url: string,
    response: Response
  ): Promise<CardError | undefined> {
    if (!response.ok) {
      let text: string | undefined;
      try {
        text = await response.text();
      } catch (err) {
        debugger;
        // throw err;
      }
      let errorJSON: { errors: any[] } | undefined;
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
        Array.isArray(maybeErrorJSON.errors)
      ) {
        errorJSON = maybeErrorJSON;
      }
      let cardError = new CardError(
        `unable to fetch ${url}${!errorJSON ? ": " + text : ""}`,
        {
          title: response.statusText,
          status: response.status,
        }
      );
      cardError.additionalErrors = [
        ...((errorJSON?.errors.map(
          CardError.fromSerializableError
        ) as Error[]) ?? []),
      ];
      return cardError;
    }
    return undefined; // not actually an error
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

  let result = Object.assign({}, err);
  result.additionalErrors =
    result.additionalErrors?.map((inner) => serializableError(inner)) ?? null;
  return result;
}

export function responseWithError(error: CardError): Response {
  // TODO error.toJSON() does not recursively serialize the additionalErrors
  // array. let's use the serializableError() to do that (need to make sure the
  // result works as a fetch response)
  return new Response(JSON.stringify({ errors: [error.toJSON()] }), {
    status: error.status,
    statusText: error.title,
    headers: { "content-type": "application/vnd.api+json" },
  });
}

export function methodNotAllowed(request: Request): Response {
  return responseWithError(
    new CardError(`${request.method} not allowed for ${request.url}`, {
      status: 405,
    })
  );
}

export function notFound(
  request: Request,
  message = `Could not find ${request.url}`
): Response {
  return responseWithError(new CardError(message, { status: 404 }));
}

export function badRequest(message: string): Response {
  return responseWithError(new CardError(message, { status: 400 }));
}

export function systemUnavailable(message: string): Response {
  return responseWithError(new CardError(message, { status: 503 }));
}

export function systemError(message: string): Response {
  return responseWithError(new CardError(message, { status: 500 }));
}
