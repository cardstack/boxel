import {
  isCardErrorJSONAPI,
  isCardError,
  CardError,
  type CardErrorJSONAPI,
  type RenderError,
  type ErrorEntry,
} from '@cardstack/runtime-common';
import { serializableError } from '@cardstack/runtime-common/error';

export function renderErrorHandler({
  event,
  setPrerenderStatus,
  setError,
  healthCheck,
  currentURL,
}: {
  event: Event;
  setPrerenderStatus: (
    status: 'ready' | 'loading' | 'error' | 'unusable',
  ) => void;
  setError: (error: string) => void;
  healthCheck?: (timeout?: number) => Promise<boolean>;
  currentURL?: string | null;
}) {
  let [_a, _b, encodedId] = (currentURL ?? '').split('/');
  let id = encodedId ? decodeURIComponent(encodedId) : undefined;
  let reason =
    'reason' in event
      ? (event as any).reason
      : (event as CustomEvent).detail?.reason;
  // Coerce stringified JSON into objects so our type guards work
  if (typeof reason === 'string') {
    try {
      reason = JSON.parse(reason);
    } catch (_e) {
      // leave as string
    }
  }
  let errorPayload: RenderError;
  if (reason) {
    if (isCardError(reason)) {
      errorPayload = {
        type: 'error',
        error: { ...reason, stack: reason.stack },
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
        type: 'error',
        error:
          reason instanceof CardError
            ? { ...serializableError(reason) }
            : {
                id,
                message: reason.message,
                stack: reason.stack,
                status: 500,
              },
      };
    }
  } else {
    errorPayload = {
      type: 'error',
      error: new CardError('indexing failed', { status: 500, id }),
    };
  }

  setError(JSON.stringify(errorPayload));
  if (healthCheck) {
    // Defer setting prerender status until we know Ember health
    void healthCheck()
      .then((alive) => {
        // this is never run during in-browser indexed, so this is safe to use
        let element: HTMLElement = document.querySelector('[data-prerender]')!;
        element.dataset.emberAlive = alive ? 'true' : 'false';
        setPrerenderStatus(alive ? 'error' : 'unusable');
      })
      .catch(() => {
        setPrerenderStatus('unusable');
      });
  } else {
    setPrerenderStatus('error');
  }

  event.preventDefault?.();
}

export function errorJsonApiToErrorEntry(
  errorJSONAPI: CardErrorJSONAPI,
): ErrorEntry {
  let error = CardError.fromCardErrorJsonAPI(errorJSONAPI);
  return {
    type: 'error',
    error,
  };
}
