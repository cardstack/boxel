import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { runTestsLocally } from '../src/lib/test-engine.ts';

const FIXTURE_DIR = resolve(import.meta.dirname, 'fixtures', 'local-mode');

// Where `resolveHostDistDir` looks, in its order of preference. Local mode
// runs the host's compiled test bundle in a real browser, so without one there
// is nothing to drive.
function hostDistDir(): string | undefined {
  let candidates = [
    process.env.TEST_HARNESS_HOST_DIST_PACKAGE_DIR
      ? join(resolve(process.env.TEST_HARNESS_HOST_DIST_PACKAGE_DIR), 'dist')
      : undefined,
    resolve(import.meta.dirname, '..', 'bundled-test-harness'),
    resolve(import.meta.dirname, '..', '..', 'host', 'dist'),
  ].filter((dir): dir is string => Boolean(dir));
  return candidates.find((dir) => existsSync(join(dir, 'tests', 'index.html')));
}

// A run boots a browser and the host app before a single assertion is reached.
// This is a ceiling for a wedged run, not a target — the runner's own run-end
// wait (300s) is lower, so a hang reports as "did not reach runEnd" rather
// than as a bare vitest timeout that names nothing.
const RUN_TIMEOUT_MS = 360_000;

let dist = hostDistDir();

// The suite that has a host dist is CI's: the boxel-cli job restores the
// test-web-assets artifact, `packages/host/dist` included, before running
// this. Skipping there would hide the only coverage of the browser-level
// path, so CI fails instead of skipping; a developer without a host build
// gets the skip and the command that produces one.
if (!dist && process.env.CI) {
  throw new Error(
    'Host dist not found, so local-mode `boxel test` cannot be exercised. ' +
      'Build it with `pnpm build` in packages/host (needs ' +
      '`mise run build:ui` first), or point ' +
      'TEST_HARNESS_HOST_DIST_PACKAGE_DIR at a package dir that has one.',
  );
}

describe.skipIf(!dist)('local-mode `boxel test`', () => {
  // Everything the mounts have to get right to render one card, end to end:
  // the CLI serves the workspace and base realms itself, the host resolves
  // `@cardstack/base/` onto that server, and the browser loads a card whose
  // module the mount serves. The card GET behind that render resolves a
  // definition for the instance's type and walks its field tree, so it needs
  // each mounted module to name an owning realm and to be modellable. Failing
  // either, the GET 500s and the stack item renders the error card — which is
  // what the fixture's own assertions catch.
  it(
    'renders a card whose module is served from a local mount',
    async () => {
      let result = await runTestsLocally({ workspaceDir: FIXTURE_DIR });

      // Print the failures rather than only the count: a failure here is a
      // browser-side assertion this process never saw.
      expect(
        result.failures.map((f) => `${f.module} > ${f.testName}: ${f.message}`),
      ).toEqual([]);
      expect(result.errorMessage).toBeUndefined();
      expect(result.status).toBe('passed');
      expect(result.passedCount).toBeGreaterThan(0);
      expect(result.testFiles).toEqual(['sample.test.gts']);
    },
    RUN_TIMEOUT_MS,
  );
});
