import type { Preprocessor as ContentTagPreprocessor } from 'content-tag';

// content-tag is loaded on first use rather than imported statically. Its
// browser build starts with a top-level `await` that fetches and compiles its
// wasm, and a static import puts that `await` in the module graph of every
// module that reaches this package. Safari's module loader before Safari 27
// mishandles a graph with a top-level `await` in it when several dynamic
// imports are in flight at once: an import can resolve, and the module that
// asked for it run, before a dependency it shares with another import has
// finished evaluating. Loading content-tag here keeps the `await` out of
// every static graph, and keeps the wasm off the path a page takes to boot.
let preprocessorClass: typeof ContentTagPreprocessor | undefined;
let loading: Promise<void> | undefined;

export function loadContentTag(): Promise<void> {
  loading ??= import('content-tag').then(
    (module) => {
      preprocessorClass = module.Preprocessor;
    },
    (error) => {
      // A failed load is retried by the next caller, not cached.
      loading = undefined;
      throw error;
    },
  );
  return loading;
}

// For synchronous callers. Something on the caller's path must have awaited
// `loadContentTag()` first.
export function contentTagPreprocessor(): ContentTagPreprocessor {
  if (!preprocessorClass) {
    throw new Error(
      'content-tag is not loaded yet: await loadContentTag() before parsing a .gts module synchronously',
    );
  }
  return new preprocessorClass();
}
