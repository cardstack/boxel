import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { Browser } from 'puppeteer';
import { BrowserManager } from '../prerender/browser-manager.ts';

// A launch that has not finished must be visible to the rest of the
// manager. A second caller shares it instead of starting another Chrome, and
// a restart waits for it and closes the browser it starts. Otherwise a
// restart that runs during the first launch finds no browser to close, and
// the caller after it starts a second Chrome that nothing tracks.

interface FakeBrowser {
  closed: boolean;
}

function makeLauncher() {
  let launches: Array<{ browser: FakeBrowser; finish: () => void }> = [];
  let launchChrome = () => {
    let browser: FakeBrowser = { closed: false };
    let fake = {
      process: () => null,
      version: async () => 'fake',
      close: async () => {
        browser.closed = true;
      },
    } as unknown as Browser;
    return new Promise<Browser>((resolve) => {
      launches.push({ browser, finish: () => resolve(fake) });
    });
  };
  return { launches, launchChrome };
}

async function waitUntil(condition: () => boolean, message: string) {
  let deadline = Date.now() + 5000;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting: ${message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

module(basename(import.meta.filename), function () {
  test('concurrent getBrowser calls share one launch', async function (assert) {
    let { launches, launchChrome } = makeLauncher();
    let manager = new BrowserManager({ launchChrome });

    let first = manager.getBrowser();
    let second = manager.getBrowser();
    await waitUntil(() => launches.length > 0, 'the launch to start');
    launches[0].finish();

    assert.strictEqual(await first, await second, 'both get the same browser');
    assert.strictEqual(launches.length, 1, 'Chrome is launched once');
  });

  test('a restart during a launch waits for it and closes the browser it starts', async function (assert) {
    let { launches, launchChrome } = makeLauncher();
    let manager = new BrowserManager({ launchChrome });

    let launching = manager.getBrowser();
    await waitUntil(() => launches.length > 0, 'the launch to start');

    let restarted = false;
    let restart = manager.restartBrowser().then(() => (restarted = true));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.false(restarted, 'the restart waits for the launch');

    launches[0].finish();
    await launching;
    await restart;
    assert.true(launches[0].browser.closed, 'the launched browser is closed');

    let next = manager.getBrowser();
    await waitUntil(() => launches.length > 1, 'the relaunch to start');
    launches[1].finish();
    await next;
    assert.strictEqual(
      launches.length,
      2,
      'the next caller launches once, after the restart',
    );
    await manager.stop();
  });
});
