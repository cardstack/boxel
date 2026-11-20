import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { BrowserManager } from '../prerender/browser-manager.ts';

module(basename(import.meta.filename), function (hooks) {
  let manager: BrowserManager;

  hooks.beforeEach(() => {
    manager = new BrowserManager();
  });

  hooks.afterEach(async () => {
    await manager.stop();
  });

  // Chrome 157 gives every window an omnibox-popup WebUI renderer
  // (`--top-chrome-webui`) unless the launch turns the feature off. The
  // prerender browser opens one window per pooled BrowserContext and shows
  // none of them.
  test('the prerender browser runs no omnibox-popup WebUI renderer', async function (assert) {
    let browser = await manager.getBrowser();
    let context = await browser.createBrowserContext();
    try {
      let page = await context.newPage();
      await page.goto('about:blank');
      let session = await browser.target().createCDPSession();
      try {
        let { targetInfos } = await session.send('Target.getTargets');
        let webUI = targetInfos
          .map((t) => t.url)
          .filter((url) => url.startsWith('chrome://omnibox-popup'));
        assert.deepEqual(webUI, [], 'no omnibox-popup WebUI targets');
      } finally {
        await session.detach();
      }
    } finally {
      await context.close();
    }
  });
});
