/**
 * Mock BoxelCLIClient for unit tests.
 *
 * Wraps a mock fetch function so tests can control responses while
 * using the same BoxelCLIClient interface that production code expects.
 */
import type {
  BoxelCLIClient,
  ReadResult,
  WriteResult,
  DeleteResult,
  SearchResult,
} from '@cardstack/boxel-cli/api';

interface MockClientOptions {
  /**
   * Mock fetch — used to simulate realm API responses.
   * If not provided, all operations return ok: true with empty data.
   */
  fetch?: typeof globalThis.fetch;
}

/**
 * Create a mock BoxelCLIClient that delegates to a mock fetch.
 * Tests can pass in their own fetch mock to control responses.
 *
 * The mock client implements the subset of BoxelCLIClient that
 * production code uses: read, write, delete, search, getRealmToken.
 */
export function createMockClient(options?: MockClientOptions): BoxelCLIClient {
  let defaultCardDoc = JSON.stringify({
    data: {
      type: 'card',
      attributes: {},
      meta: { adoptsFrom: { module: 'mock', name: 'Mock' } },
    },
  });
  let fetchImpl =
    options?.fetch ??
    ((() =>
      Promise.resolve(
        new Response(defaultCardDoc, { status: 200 }),
      )) as typeof globalThis.fetch);

  function ensureTrailingSlash(url: string): string {
    return url.endsWith('/') ? url : `${url}/`;
  }

  return {
    getActiveProfile: () => ({
      matrixId: '@test:example.test',
      realmServerUrl: 'https://realms.example.test/',
    }),

    getRealmToken: async (_realmUrl: string) => 'Bearer mock-realm-token',

    async read(realmUrl: string, path: string): Promise<ReadResult> {
      let url = new URL(path, ensureTrailingSlash(realmUrl)).href;
      try {
        let response = await fetchImpl(url, {
          method: 'GET',
          headers: { Accept: 'application/vnd.card+source' },
        });
        if (!response.ok) {
          let body = await response.text();
          return {
            ok: false,
            status: response.status,
            error: `HTTP ${response.status}: ${body.slice(0, 300)}`,
          };
        }
        let content = await response.text();
        return { ok: true, status: response.status, content };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },

    async write(
      realmUrl: string,
      path: string,
      content: string,
    ): Promise<WriteResult> {
      let url = new URL(path, ensureTrailingSlash(realmUrl)).href;
      try {
        let response = await fetchImpl(url, {
          method: 'POST',
          headers: {
            Accept: 'application/vnd.card+source',
            'Content-Type': 'application/vnd.card+source',
          },
          body: content,
        });
        if (!response.ok) {
          let body = await response.text();
          return {
            ok: false,
            error: `HTTP ${response.status}: ${body.slice(0, 300)}`,
          };
        }
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },

    async delete(realmUrl: string, path: string): Promise<DeleteResult> {
      let url = new URL(path, ensureTrailingSlash(realmUrl)).href;
      try {
        let response = await fetchImpl(url, {
          method: 'DELETE',
          headers: { Accept: 'application/vnd.card+source' },
        });
        if (!response.ok) {
          let body = await response.text();
          return {
            ok: false,
            error: `HTTP ${response.status}: ${body.slice(0, 300)}`,
          };
        }
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },

    async search(
      realmUrl: string,
      query: Record<string, unknown>,
    ): Promise<SearchResult> {
      let searchUrl = `${ensureTrailingSlash(realmUrl)}_search`;
      try {
        let response = await fetchImpl(searchUrl, {
          method: 'QUERY',
          headers: {
            Accept: 'application/vnd.card+json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(query),
        });
        if (!response.ok) {
          let body = await response.text();
          return {
            ok: false,
            status: response.status,
            error: `HTTP ${response.status}: ${body.slice(0, 300)}`,
          };
        }
        let result = (await response.json()) as {
          data?: Record<string, unknown>[];
        };
        return { ok: true, data: result.data };
      } catch (err) {
        return {
          ok: false,
          status: 0,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },

    // Stubs for methods that tests typically don't call
    listFiles: async () => ({ filenames: [] }),
    runCommand: async () => ({
      status: 'ready' as const,
      result: null,
      error: null,
    }),
    lint: async () => ({ fixed: false, output: '', messages: [] }),
    waitForReady: async () => ({ ready: true }),
    waitForFile: async () => true,
    atomicOperation: async () => ({ ok: true }),
    cancelAllIndexingJobs: async () => ({ ok: true }),
    authedFetch: async () => new Response(null),
    authedServerFetch: async () => new Response(null),
    pull: async () => ({ files: [] }),
    createRealm: async () => ({
      realmUrl: '',
      created: false,
    }),
    ensureProfile: async () => {},
  } as unknown as BoxelCLIClient;
}
