import {
  isCardError,
  type ErrorEntry,
  type SearchRefusal,
  type SerializedError,
} from '@cardstack/runtime-common';

// Serialize a failed search request into the `ErrorEntry` shape the search
// resources expose to their consumers.
export function searchErrorEntry(err: unknown): ErrorEntry {
  let status =
    typeof (err as { status?: unknown })?.status === 'number'
      ? ((err as { status: number }).status as number)
      : 500;
  let message =
    typeof (err as { message?: unknown })?.message === 'string'
      ? ((err as { message: string }).message as string)
      : String(err);
  let stack =
    typeof (err as { stack?: unknown })?.stack === 'string'
      ? ((err as { stack: string }).stack as string)
      : undefined;
  let title = status === 404 ? 'Link Not Found' : 'Search Error';
  let serialized: SerializedError = {
    title,
    status,
    message,
    stack,
    additionalErrors: null,
  };
  if (isCardError(err)) {
    if (err.additionalErrors?.length) {
      serialized.additionalErrors = err.additionalErrors.map(
        (additionalError) => {
          let normalized = additionalError as Partial<SerializedError>;
          return {
            title: normalized.title,
            status: normalized.status,
            message: normalized.message,
            stack: normalized.stack,
          };
        },
      );
    }
    if (err.deps?.length) {
      serialized.deps = [...err.deps];
    }
  }
  let refusal = searchRefusal(status, err);
  return {
    type: 'instance-error',
    error: serialized,
    ...(refusal ? { refusal } : {}),
  };
}

// What the realm said when it refused the search: a 4xx answer whose body is
// the search error document (`{ errors: [{ message, code? }] }`). Undefined
// for any other failure (a network error, a 5xx, a body that isn't JSON).
function searchRefusal(
  status: number,
  err: unknown,
): SearchRefusal | undefined {
  let text = (err as { responseText?: unknown })?.responseText;
  if (status < 400 || status >= 500 || typeof text !== 'string') {
    return undefined;
  }
  let first: { message?: unknown; code?: unknown } | undefined;
  try {
    first = JSON.parse(text)?.errors?.[0];
  } catch {
    return undefined;
  }
  if (!first || typeof first.message !== 'string') {
    return undefined;
  }
  return {
    status,
    ...(typeof first.code === 'string' ? { code: first.code } : {}),
    message: first.message,
  };
}
