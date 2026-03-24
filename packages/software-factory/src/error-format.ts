export function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack?.trim() || error.message;
  }

  if (
    error === null ||
    error === undefined ||
    typeof error === 'string' ||
    typeof error === 'number' ||
    typeof error === 'boolean' ||
    typeof error === 'bigint'
  ) {
    return String(error);
  }

  try {
    let serialized = JSON.stringify(error);
    if (serialized && serialized !== '{}') {
      return serialized;
    }
  } catch {
    // fall through to object tag
  }

  let tag = Object.prototype.toString.call(error);
  return tag === '[object Object]' ? 'non-Error object thrown' : tag;
}

export function formatErrorBody(
  body: string,
  contentType?: string | null,
): string {
  let trimmed = body.trim();
  if (!trimmed) {
    return '';
  }

  let looksJson =
    contentType?.includes('json') ||
    trimmed.startsWith('{') ||
    trimmed.startsWith('[');

  if (looksJson) {
    try {
      return formatUnknownError(JSON.parse(trimmed));
    } catch {
      // keep the original text when the body is malformed JSON
    }
  }

  if (trimmed === '[object Object]') {
    return 'server returned a non-serialized object body';
  }

  return trimmed;
}

export async function formatErrorResponse(response: Response): Promise<string> {
  return formatErrorBody(
    await response.text(),
    response.headers.get('content-type'),
  );
}
