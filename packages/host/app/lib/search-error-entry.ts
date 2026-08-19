import {
  isCardError,
  type ErrorEntry,
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
  return {
    type: 'instance-error',
    error: serialized,
  };
}
