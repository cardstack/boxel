import QUnit from 'qunit';
import puppeteer, { type Browser } from 'puppeteer';
import {
  captureFileExtract,
  captureModule,
  captureResult,
  renderHTML,
} from '../prerender/utils.ts';

const { module, test } = QUnit;

module('Prerender | DOM readiness without animation frames', function (hooks) {
  let browser: Browser;
  hooks.before(async function () {
    browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  });
  hooks.after(async function () {
    await browser?.close();
  });

  for (let kind of ['module', 'file-extract', 'card'] as const) {
    test(`${kind} capture observes new output even when no animation frame is delivered`, async function (assert) {
      assert.timeout(10_000);
      let page = await browser.newPage();
      let deadline: ReturnType<typeof setTimeout> | undefined;
      try {
        // Intercept the sole navigation: this test needs a same-origin render
        // pathname, no application server, definitions, timers or network.
        await page.setRequestInterception(true);
        page.on('request', (request) => {
          void request.respond({
            contentType: 'text/html',
            body: '<body></body>',
          });
        });
        await page.goto('http://lattice-render.test/render/card/2/meta');
        let prefix =
          kind === 'card' ? 'data-prerender' : `data-prerender-${kind}`;
        let id = 'http://lattice-render.test/card';
        await page.evaluate(
          ({ prefix, id }) => {
            document.body.innerHTML = `<div ${prefix} ${prefix}-id="${id}" ${prefix}-nonce="1" ${prefix}-status="ready"><pre>old</pre></div>`;
            // Observe installation of either poller before changing the DOM.
            // The old RAF poller installs successfully but never runs again.
            let root = globalThis as typeof globalThis & {
              captureWaitInstalled?: boolean;
            };
            window.requestAnimationFrame = () => {
              root.captureWaitInstalled = true;
              return 1;
            };
            let NativeObserver = window.MutationObserver;
            window.MutationObserver = class extends NativeObserver {
              override observe(
                ...args: Parameters<MutationObserver['observe']>
              ) {
                root.captureWaitInstalled = true;
                super.observe(...args);
              }
            };
          },
          { prefix, id },
        );
        let opts = { expectedId: id, expectedNonce: '2' };
        let pending =
          kind === 'module'
            ? captureModule(page, opts)
            : kind === 'file-extract'
              ? captureFileExtract(page, opts)
              : captureResult(page, 'textContent', opts);
        pending.catch(() => {});
        await page.waitForFunction(
          () => (globalThis as any).captureWaitInstalled,
          { polling: 10, timeout: 2000 },
        );
        let value = { id, nonce: '2', status: 'ready', count: 8 };
        await page.evaluate(
          ({ prefix, value }) => {
            let node = document.querySelector(`[${prefix}]`)!;
            node.setAttribute(`${prefix}-nonce`, '2');
            node.querySelector('pre')!.textContent = JSON.stringify(value);
          },
          { prefix, value },
        );
        let result = await Promise.race([
          pending,
          new Promise<never>((_, reject) => {
            deadline = setTimeout(
              () => reject(new Error('Ready DOM waited for a frame')),
              1500,
            );
          }),
        ]);
        assert.strictEqual((result as { nonce?: string }).nonce, '2');
        assert.strictEqual(
          (result as { value?: string }).value,
          JSON.stringify(value),
        );
      } finally {
        clearTimeout(deadline);
        await page.close();
      }
    });
  }

  test('format route readiness observes history changes without DOM mutations or animation frames', async function (assert) {
    assert.timeout(10_000);
    let page = await browser.newPage();
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        void request.respond({
          contentType: 'text/html',
          body: '<body></body>',
        });
      });
      await page.goto('http://lattice-render.test/before');
      await page.evaluate(() => {
        document.body.innerHTML =
          '<div data-prerender data-prerender-status="ready" data-prerender-id="http://lattice-render.test/card" data-prerender-nonce="2"><b>Current</b></div>';
        window.requestAnimationFrame = () => 1;
        // The test controls when same-document navigation completes.
        (globalThis as any).boxelTransitionTo = () => {};
        let original = document.querySelectorAll.bind(document);
        document.querySelectorAll = ((...args: Parameters<typeof original>) => {
          (globalThis as any).routeWaitObserved = true;
          return original(...args);
        }) as typeof document.querySelectorAll;
      });
      let pending = renderHTML(page, 'isolated', 0, {
        expectedId: 'http://lattice-render.test/card',
        expectedNonce: '2',
      });
      pending.catch(() => {});
      await page.waitForFunction(() => (globalThis as any).routeWaitObserved, {
        polling: 10,
        timeout: 2000,
      });
      await page.evaluate(() =>
        history.pushState(null, '', '/render/card/2/html/isolated/0'),
      );
      let result = await Promise.race([
        pending,
        new Promise<never>((_, reject) => {
          deadline = setTimeout(
            () => reject(new Error('Route readiness waited for a frame')),
            1500,
          );
        }),
      ]);
      assert.strictEqual(typeof result, 'string');
      assert.true(String(result).includes('<b>Current</b>'));
    } finally {
      clearTimeout(deadline);
      await page.close();
    }
  });
});
