export function createEnvironmentAwareFetch(): typeof globalThis.fetch {
  // Browser environment - use native fetch
  return globalThis.fetch.bind(globalThis);
}
