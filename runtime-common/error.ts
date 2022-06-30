export class WorkerError extends Error {
  constructor(readonly response: Response) {
    super(`WorkerError ${response.status}`);
  }

  static withResponse(response: Response) {
    return new WorkerError(response);
  }
}

export function methodNotAllowed(request: Request): Response {
  return new Response(
    JSON.stringify({
      errors: [`${request.method} not allowed for ${request.url}`],
    }),
    {
      status: 405,
      headers: { 'Content-Type': 'application/vnd.api+json' },
    }
  );
}

export function notFound(
  request: Request,
  message = `Could not find ${request.url}`
): Response {
  return new Response(
    JSON.stringify({
      errors: [message],
    }),
    {
      status: 404,
      headers: { 'Content-Type': 'application/vnd.api+json' },
    }
  );
}

export function badRequest(message: string): Response {
  return new Response(
    JSON.stringify({
      errors: [message],
    }),
    {
      status: 400,
      headers: { 'Content-Type': 'application/vnd.api+json' },
    }
  );
}

export function systemError(message: string): Response {
  return new Response(
    JSON.stringify({
      errors: [message],
    }),
    {
      status: 500,
      headers: { 'Content-Type': 'application/vnd.api+json' },
    }
  );
}
