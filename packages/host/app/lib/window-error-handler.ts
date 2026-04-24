import {
  isCardErrorJSONAPI,
  isCardError,
  CardError,
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
  let errorPayload: RenderError;
  if (reason) {
    if (isCardError(reason)) {
      errorPayload = {
        type: 'instance-error',
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
        type: 'instance-error',
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
      type: 'instance-error',
      error: new CardError('indexing failed', { status: 500, id }),
    };
  }

  if ('stack' in errorPayload.error) {
    let updatedStack = appendRenderTimerSummaryToStack(
      errorPayload.error.stack ?? undefined,
    );
    if (updatedStack !== undefined) {
      errorPayload.error.stack = updatedStack;
    }
  }

  // CS-10860: tag errors that bubbled up through Glimmer revalidation so
  // the prerender server / ops operator has a cheap signal that the
  // offending code lives in a template helper (getter/if/each) rather
  // than in loader or model wiring. The minified stack still surfaces
  // recognizable Glimmer/Ember frames — look for any of them and prepend
  // a hint to the message so it shows up in the error doc without having
  // to parse the stack by hand.
  let templateHint = describeTemplateOrigin(errorPayload.error.stack);
  if (templateHint && typeof errorPayload.error.message === 'string') {
    if (!errorPayload.error.message.startsWith(templateHint)) {
      errorPayload.error.message = `${templateHint}: ${errorPayload.error.message}`;
    }
  }

  setError(JSON.stringify(errorPayload));
  setStatusToUnusable();
  event.preventDefault?.();
}

const TEMPLATE_STACK_MARKERS = [
  'ifHelper',
  'eachHelper',
  'helperForImpl',
  'evaluateOuter',
  'handleException',
  'rerender',
  'renderRoots',
  'revalidate',
  'UpdatingVM',
  'LowLevelVM',
] as const;

function describeTemplateOrigin(
  stack: string | null | undefined,
): string | undefined {
  if (!stack) {
    return undefined;
  }
  let hit = TEMPLATE_STACK_MARKERS.find((marker) => stack.includes(marker));
  if (!hit) {
    return undefined;
  }
  return `Error during template render (Glimmer frame "${hit}" in stack)`;
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
