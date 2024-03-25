/*
  This module needs to exist so long as we have multiple loaders cooperating in
  the same environment. It ensures that any shared global state is really
  global. Ultimately we would like to get to the point where the loader itself
  is scoped so broadly that there's only one, and module-scoped state is safe to
  treat as global.
*/

const bucket: Map<string, unknown> = (() => {
  let g = globalThis as unknown as {
    __card_api_shared_state: Map<string, unknown> | undefined;
  };
  if (!g.__card_api_shared_state) {
    g.__card_api_shared_state = new Map();
  }
  return g.__card_api_shared_state;
})();

export function initSharedState<T>(key: string, fn: () => T): T {
  if (bucket.has(key)) {
    return bucket.get(key) as T;
  }
  bucket.set(key, fn());
  return bucket.get(key) as T;
}
