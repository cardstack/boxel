import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { EventEmitter } from 'events';
import puppeteer, { type Browser } from 'puppeteer';
import {
  CHROME_NO_SANDBOX_ARGS,
  chromeSandboxEnabled,
} from '@cardstack/runtime-common/chrome-sandbox';
import { attachRuntimeExceptionCapture } from '../prerender/runtime-exception-capture.ts';
import { PagePool } from '../prerender/page-pool.ts';

// A pool tab serves many renders, and every one of them runs with CDP's
// `Runtime` domain enabled. In that state V8 keeps the arguments of the last
// thousand console messages reachable, so an object a card logs would outlive
// its render. The pool clears that store whenever a render takes the tab.

const noopRecorder = {
  recordThrown: () => true,
  recordRevoked: () => {},
};

module(basename(import.meta.filename), function () {
  module('against Chrome', function (hooks) {
    let browser: Browser | undefined;

    hooks.before(async function () {
      browser = await puppeteer.launch({
        headless: true,
        ...(chromeSandboxEnabled()
          ? {}
          : { args: [...CHROME_NO_SANDBOX_ARGS] }),
      });
    });

    hooks.after(async function () {
      await browser?.close();
    });

    test('logged objects stay reachable until the console store is discarded', async function (assert) {
      let page = await browser!.newPage();
      // A console listener like the pool's, which is what keeps Puppeteer
      // from releasing the argument handles itself.
      page.on('console', () => {});
      let session = await attachRuntimeExceptionCapture({
        page,
        getAffinityKey: () => 'test-affinity',
        pageId: 'page-1',
        recorder: noopRecorder,
      });
      assert.ok(session, 'the capture hands back its Runtime-enabled session');

      let heapMB = async () => {
        let client = await page.createCDPSession();
        try {
          await client.send('HeapProfiler.collectGarbage');
          let usage = (await client.send('Runtime.getHeapUsage')) as {
            usedSize: number;
          };
          return usage.usedSize / (1024 * 1024);
        } finally {
          await client.detach();
        }
      };

      let baseline = await heapMB();
      // 100 logged objects of ~1 MB each, nothing in the page holding them.
      await page.evaluate(() => {
        for (let i = 0; i < 100; i++) {
          console.log('row', { values: new Array(250_000).fill(i) });
        }
      });
      let afterLogging = await heapMB();
      assert.true(
        afterLogging - baseline > 50,
        `the logged objects survive a GC (heap grew ${Math.round(
          afterLogging - baseline,
        )} MB)`,
      );

      await session!.send('Runtime.discardConsoleEntries');
      let afterDiscard = await heapMB();
      assert.true(
        afterDiscard - baseline < 20,
        `discarding the store makes them collectable (heap ${Math.round(
          afterDiscard - baseline,
        )} MB above baseline)`,
      );
      await page.close();
    });
  });

  module('on a pool tab', function (hooks) {
    // Every CDP command any session on the stub's tabs was sent, in order,
    // and the console listener the pool attached to each tab.
    let sent: string[];
    let consoleListeners: Array<(message: any) => void>;
    let pool: PagePool;

    hooks.beforeEach(function () {
      sent = [];
      consoleListeners = [];
      let browser = {
        async createBrowserContext() {
          let context: any = {
            async newPage() {
              let page: any = {
                async goto() {},
                async waitForFunction() {
                  return true;
                },
                async evaluate(fn: any, ...args: any[]) {
                  return fn(...args);
                },
                async close() {},
                isClosed: () => false,
                browserContext: () => context,
                removeAllListeners() {},
                on(event: string, handler: (message: any) => void) {
                  if (event === 'console') {
                    consoleListeners.push(handler);
                  }
                },
                async createCDPSession() {
                  let client = new EventEmitter() as any;
                  client.send = async (method: string) => {
                    sent.push(method);
                    return {};
                  };
                  client.detach = async () => {};
                  return client;
                },
              };
              return page;
            },
            async close() {},
          };
          return context;
        },
      };
      pool = new PagePool({
        maxPages: 1,
        serverURL: 'http://localhost',
        browserManager: {
          async getBrowser() {
            return browser as any;
          },
          async cleanupUserDataDirs() {},
        } as any,
        boxelHostURL: 'http://localhost:4200',
        standbyTimeoutMs: 500,
        disableFileAdmission: true,
        registerWithManager: false,
      });
    });

    hooks.afterEach(async function () {
      await pool.closeAll();
    });

    let settle = () => new Promise((resolve) => setTimeout(resolve, 10));
    let discards = () =>
      sent.filter((m) => m === 'Runtime.discardConsoleEntries').length;

    test('a render taking its tab discards the console store', async function (assert) {
      let lease = await pool.getPage('realm-a');
      await settle();
      let before = discards();

      pool.resetConsoleErrors(lease.pageId);
      await settle();
      assert.strictEqual(
        discards(),
        before + 1,
        "the tab's Runtime session is told to discard its console store",
      );
      lease.release();
    });

    test('a render releasing its tab discards the console store', async function (assert) {
      let lease = await pool.getPage('realm-a');
      await settle();
      let before = discards();

      lease.release();
      await settle();
      assert.strictEqual(
        discards(),
        before + 1,
        'what the render logged does not wait for the next render on the tab',
      );
    });

    test('the discard waits for a console message still being formatted', async function (assert) {
      let lease = await pool.getPage('realm-a');
      await settle();
      let before = discards();

      // A message whose argument is still being read when the render ends.
      // The discard would release the handle the read depends on.
      let finishRead!: (value: unknown) => void;
      let read = new Promise((resolve) => (finishRead = resolve));
      let message = {
        type: () => 'log',
        text: () => 'row [object]',
        location: () => ({}),
        args: () => [{ jsonValue: () => read, toString: () => 'JSHandle' }],
      };
      for (let listener of consoleListeners) {
        listener(message);
      }

      lease.release();
      await settle();
      assert.strictEqual(
        discards(),
        before,
        'no discard while the message is still being formatted',
      );

      finishRead({ values: [1, 2, 3] });
      await settle();
      assert.strictEqual(
        discards(),
        before + 1,
        'the discard goes out once formatting finishes',
      );
    });
  });
});
