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

  test('a render taking its tab discards the console store on that tab', async function (assert) {
    let sentByPage: string[][] = [];
    let browser = {
      async createBrowserContext() {
        let context: any = {
          async newPage() {
            let sent: string[] = [];
            sentByPage.push(sent);
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
              on() {},
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
    let pool = new PagePool({
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
    try {
      let lease = await pool.getPage('realm-a');
      let sent = sentByPage.flat();
      assert.false(
        sent.includes('Runtime.discardConsoleEntries'),
        'nothing is discarded before a render takes the tab',
      );

      pool.resetConsoleErrors(lease.pageId);
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.true(
        sentByPage.flat().includes('Runtime.discardConsoleEntries'),
        "the tab's Runtime session is told to discard its console store",
      );
      lease.release();
    } finally {
      await pool.closeAll();
    }
  });
});
