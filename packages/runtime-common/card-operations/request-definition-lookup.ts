import type { ResolvedCodeRef } from '../code-ref.ts';
import type { DefinitionLookupOptions } from '../definition-lookup.ts';
import type { Definition, ModuleDefinitionResult } from '../index.ts';
import { userInitiatedPriority } from '../queue.ts';
import { definitionNotReady } from './types.ts';

// How long a request waits for a definition before it is turned away. A cache
// miss renders the module, which takes a few seconds on an idle prerenderer;
// past this the render is waiting on the queue, and holding the request open
// only invites the caller to retry on top of it.
export const REQUEST_DEFINITION_DEADLINE_MS = 20_000;

// The reads of `DefinitionLookup` a request makes, each taking the priority a
// cache miss renders at.
export interface RequestPathLookup {
  lookupDefinition(
    codeRef: ResolvedCodeRef,
    opts?: DefinitionLookupOptions,
  ): Promise<Definition>;
  lookupDefinitionEntry(
    codeRef: ResolvedCodeRef,
    opts?: DefinitionLookupOptions,
  ): Promise<ModuleDefinitionResult>;
  definitionGeneration?(): number;
}

// The realm's definition lookup as a request reaches it.
//
// Two things separate it from the lookup the indexer uses. A cache miss renders
// the module at `userInitiatedPriority`, so a caller waiting on an answer is
// served ahead of a background re-index, whose card renders run at
// `systemInitiatedPriority`: without it the render goes in at the page pool's
// default of 0, below every card render the re-index queued, and a realm with
// a few thousand instances of the module answers nothing until they drain. And
// the wait is bounded: a lookup still unanswered at the deadline refuses with a
// retryable `target-not-indexed` 503 instead of holding the request open. The
// render is left running, so the definition it populates is there for the
// retry.
export function requestDefinitionLookup(
  lookup: RequestPathLookup,
  opts: { deadlineMs?: number } = {},
): {
  lookupDefinition(codeRef: ResolvedCodeRef): Promise<Definition>;
  lookupDefinitionEntry(
    codeRef: ResolvedCodeRef,
  ): Promise<ModuleDefinitionResult>;
  definitionGeneration?(): number;
} {
  let deadlineMs = opts.deadlineMs ?? REQUEST_DEFINITION_DEADLINE_MS;
  let options = { priority: userInitiatedPriority };
  return {
    lookupDefinition: (codeRef) =>
      withinDeadline(
        lookup.lookupDefinition(codeRef, options),
        codeRef,
        deadlineMs,
      ),
    lookupDefinitionEntry: (codeRef) =>
      withinDeadline(
        lookup.lookupDefinitionEntry(codeRef, options),
        codeRef,
        deadlineMs,
      ),
    ...(lookup.definitionGeneration
      ? { definitionGeneration: () => lookup.definitionGeneration!() }
      : {}),
  };
}

async function withinDeadline<T>(
  pending: Promise<T>,
  codeRef: ResolvedCodeRef,
  deadlineMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () =>
        reject(
          definitionNotReady(
            undefined,
            codeRef,
            `did not finish rendering within ${deadlineMs} ms`,
          ),
        ),
      deadlineMs,
    );
  });
  // The abandoned lookup still settles, and a rejection nobody awaits any more
  // must not surface as an unhandled one.
  pending.catch(() => {});
  try {
    return await Promise.race([pending, expired]);
  } finally {
    clearTimeout(timer);
  }
}
