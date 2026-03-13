// Opt-in type declarations for colocated realm test files.
// Add this path to your realm package's tsconfig "include" array:
//   "../local-types/test-support.d.ts"
//
// Also add to your realm package's devDependencies:
//   "@ember/test-helpers": "catalog:"
//   "@types/qunit": "catalog:"
//   "@universal-ember/test-support": "catalog:"
//
// The declarations below cover @cardstack/host internal modules which have no
// separate npm package. All other test imports resolve via node_modules.

// ── @cardstack/host services ─────────────────────────────────────────────────
declare module '@cardstack/host/services/store' {
  export default class StoreService {
    add(instance: unknown): Promise<unknown>;
    peek(id: string): unknown;
  }
}

// ── @cardstack/host test helpers ─────────────────────────────────────────────
declare module '@cardstack/host/tests/helpers/adapter' {
  export interface TestRealmAdapter {
    openFile(path: string): Promise<{ content: string | Uint8Array } | undefined>;
  }
}

declare module '@cardstack/host/tests/helpers' {
  import type { TestRealmAdapter } from '@cardstack/host/tests/helpers/adapter';

  export interface SetupRealmResult {
    adapter: TestRealmAdapter;
  }

  export function setupIntegrationTestRealm(opts: {
    mockMatrixUtils: unknown;
    contents: Record<string, unknown>;
  }): Promise<SetupRealmResult>;

  export function setupLocalIndexing(hooks: unknown): void;
  export function setupOnSave(hooks: unknown): void;
  export function setupCardLogs(hooks: unknown, fn: () => Promise<unknown>): void;
  export function setupRealmCacheTeardown(hooks: unknown): void;
  export function withCachedRealmSetup<T>(fn: () => Promise<T>): Promise<T>;

  export const testRealmURL: string;

  export interface TestContextWithSave {
    onSave(cb: (url: URL, doc: unknown) => void): void;
  }
}

declare module '@cardstack/host/tests/helpers/mock-matrix' {
  export function setupMockMatrix(
    hooks: unknown,
    opts: {
      loggedInAs: string;
      activeRealms: string[];
      autostart: boolean;
    },
  ): unknown;
}

declare module '@cardstack/host/tests/helpers/setup' {
  export function setupRenderingTest(hooks: unknown): void;
}
