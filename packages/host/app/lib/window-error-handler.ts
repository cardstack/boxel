import {
  isCardErrorJSONAPI,
  isCardError,
  CardError,
  coerceErrorMessage,
  type CardErrorJSONAPI,
  type RenderError,
  type ErrorEntry,
} from '@cardstack/runtime-common';
import { serializableError } from '@cardstack/runtime-common/error';

import { appendRenderTimerSummaryToStack } from '../utils/render-timer-stub';

export function windowErrorHandler({
  event,
  setStatusToUnusable,
  setError,
  currentURL,
}: {
  event: Event;
  setStatusToUnusable: () => void;
  setError: (error: string) => void;
  currentURL?: string | null;
}) {
  let [_a, _b, encodedId] = (currentURL ?? '').split('/');
  let id = encodedId ? decodeURIComponent(encodedId) : undefined;
  let reason =
    'reason' in event
      ? (event as any).reason
      : (event as CustomEvent).detail?.reason;
  if (!reason && event instanceof ErrorEvent) {
    if (event.error) {
      reason = event.error;
    } else if (event.message) {
      reason = {
        message: event.message,
        status: 500,
      };
    }
  }
  // Coerce stringified JSON into objects so our type guards work
  if (typeof reason === 'string') {
    try {
      reason = JSON.parse(reason);
    } catch (_e) {
      // leave as string
    }
  }
  // Synthesized when an upstream caller hands us a value with no usable
  // `message` text. Names the URL so the persisted error row at least
  // identifies which card was being rendered.
  let synthesizedMessage = `Unhandled render-time error at ${id ?? currentURL ?? 'unknown URL'} (host produced no message)`;
  let errorPayload: RenderError;
  if (reason) {
    if (isCardError(reason)) {
      errorPayload = {
        type: 'instance-error',
        error: {
          ...reason,
          stack: reason.stack,
          message: coerceErrorMessage(reason, synthesizedMessage),
        },
      };
    } else if (isCardErrorJSONAPI(reason)) {
      errorPayload = errorJsonApiToErrorEntry({ ...reason });
    } else if (
      typeof reason === 'object' &&
      reason !== null &&
      'errors' in (reason as any) &&
      Array.isArray((reason as any).errors) &&
      (reason as any).errors.length > 0
    ) {
      errorPayload = errorJsonApiToErrorEntry({
        ...(reason as any).errors[0],
        id,
      });
    } else {
      errorPayload = {
        type: 'instance-error',
        error:
          reason instanceof CardError
            ? {
                ...serializableError(reason),
                message: coerceErrorMessage(reason, synthesizedMessage),
              }
            : {
                id,
                message: coerceErrorMessage(reason, synthesizedMessage),
                stack: reason.stack,
                status: 500,
              },
      };
    }
  } else {
    errorPayload = {
      type: 'instance-error',
      error: new CardError('indexing failed', { status: 500, id }),
    };
  }
  // Final belt-and-suspenders: regardless of which branch above ran,
  // guarantee the error.message is a non-empty string before we send
  // it to the prerender server. The indexer-side guard at
  // index-writer.ts:412 refuses entries with empty message and fails
  // the whole indexing job.
  errorPayload.error.message = coerceErrorMessage(
    errorPayload.error,
    synthesizedMessage,
  );

  if ('stack' in errorPayload.error) {
    let updatedStack = appendRenderTimerSummaryToStack(
      errorPayload.error.stack ?? undefined,
    );
    if (updatedStack !== undefined) {
      errorPayload.error.stack = updatedStack;
    }
  }

  setError(JSON.stringify(errorPayload));
  setStatusToUnusable();
  event.preventDefault?.();
}

export function errorJsonApiToErrorEntry(
  errorJSONAPI: CardErrorJSONAPI,
): ErrorEntry {
  let error = CardError.fromCardErrorJsonAPI(errorJSONAPI);
  return {
    type: 'instance-error',
    error,
  };
}
