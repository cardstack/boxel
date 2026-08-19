/**
 * Shared QUnit test fixtures and realm-write helpers used by
 * `factory-test-realm.spec.ts` and `run-tests-in-memory.spec.ts`.
 *
 * Both specs set up a real harness realm, write a QUnit test file,
 * and wait for the realm to index it before driving the runner
 * under test. Those steps are identical — this helper is where the
 * shared bits live.
 */

import type { BoxelCLIClient } from '@cardstack/boxel-cli/api';

import { expect } from '../fixtures.ts';

export const PASSING_TEST_GTS = `import { module, test } from 'qunit';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { renderCard } from '@cardstack/host/tests/helpers/render-component';
import { getService } from '@universal-ember/test-support';

let cardModuleUrl = new URL('./hello', import.meta.url).href;

export function runTests() {
  module('HelloCard', function (hooks) {
    setupCardTest(hooks);

    test('greeting renders in isolated view', async function (assert) {
      let loader = getService('loader-service').loader;
      let { HelloCard } = await loader.import(cardModuleUrl);
      let card = new HelloCard({ greeting: 'Hello from smoke test' });
      await renderCard(loader, card, 'isolated');
      assert.dom('[data-test-greeting]').hasText('Hello from smoke test');
    });
  });
}
`;

export const FAILING_TEST_GTS = `import { module, test } from 'qunit';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { renderCard } from '@cardstack/host/tests/helpers/render-component';
import { getService } from '@universal-ember/test-support';

let cardModuleUrl = new URL('./hello', import.meta.url).href;

export function runTests() {
  module('HelloCard Fail', function (hooks) {
    setupCardTest(hooks);

    test('deliberately fails - wrong greeting text', async function (assert) {
      let loader = getService('loader-service').loader;
      let { HelloCard } = await loader.import(cardModuleUrl);
      let card = new HelloCard({ greeting: 'Hello from smoke test' });
      await renderCard(loader, card, 'isolated');
      assert.dom('[data-test-greeting]').hasText('THIS TEXT DOES NOT EXIST');
    });
  });
}
`;

interface WriteAndAwaitIndexOptions {
  pollMs?: number;
  timeoutMs?: number;
}

/**
 * Write a file to a realm and wait for the realm index to see it.
 * Asserts on both the write result and the wait so test setup failures
 * surface with a clear location.
 */
export async function writeAndAwaitIndex(
  client: BoxelCLIClient,
  realmUrl: string,
  path: string,
  content: string,
  options: WriteAndAwaitIndexOptions = {},
): Promise<void> {
  let writeResult = await client.write(realmUrl, path, content);
  expect(writeResult.ok, `write ${path} failed: ${writeResult.error}`).toBe(
    true,
  );
  let indexed = await client.waitForFile(realmUrl, path, {
    pollMs: options.pollMs ?? 300,
    timeoutMs: options.timeoutMs ?? 30_000,
  });
  expect(indexed, `${path} was not indexed within timeout`).toBe(true);
}
