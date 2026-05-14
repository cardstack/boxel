import { defineConfig } from 'vitest/config';

// CS-10346 proof-of-concept: a single leaf test runs under vitest while the
// rest of the realm-server suite stays on QUnit. The codemod regenerates
// tests-vitest/ from tests/, so include only what's been vetted to pass and
// extend the list as files graduate.
//
// Stage 1.b TODO: vite's SSR transform eager-walks @cardstack/runtime-common's
// export graph and fails to resolve transitive node_module deps (acorn,
// magic-string, ...) that are pnpm-hoisted under runtime-common but not direct
// deps of realm-server. Externalizing via server.deps.external / ssr.external
// doesn't intercept the transform path. Solutions to evaluate:
//   - declare acorn/magic-string as devDependencies of realm-server (matches
//     what Node + ts-node see today via pnpm's hoisted layout);
//   - a custom resolve plugin that delegates to Node's require.resolve;
//   - precompile runtime-common to dist/ so vite reads JS, not TS source.
// Until this is solved, only tests that don't import @cardstack/runtime-common
// can graduate to vitest.
export default defineConfig({
  test: {
    include: ['tests-vitest/async-semaphore.test.ts'],
    globals: false,
    testTimeout: 60000,
    pool: 'threads',
    poolOptions: {
      threads: { singleThread: true },
    },
    sequence: {
      hooks: 'list',
    },
  },
});
