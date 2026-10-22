import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import Koa from 'koa';
import puppeteer, { type Browser, type Frame, type Page } from 'puppeteer';
import { createSecureOrigin, secureOriginGate } from '../lib/secure-origin.ts';

// Each page the secure origin serves, loaded from its build in a real browser
// under the origin's real policy, must run without the policy refusing
// anything. The policy has no `unsafe-inline` and no `unsafe-eval`, so a
// `style` attribute, an inline script or style, or code compiled at run time
// shows up here as a `securitypolicyviolation` event.

// Every mode the shell presents, and the address Google returns to.
const SHELL_PAGES = [
  '/secure',
  '/secure?mode=sign-in',
  '/secure?mode=cli-sign-in&port=4567&state=example-state',
  '/secure?mode=register',
  '/secure?mode=verify-email',
  '/secure?mode=forgot-password',
  '/secure?mode=reset-password',
  '/secure/google-callback',
];

// Every form the credential fields present.
const CREDENTIAL_FORMS = [
  'login',
  'cli-login',
  'register',
  'reset',
  'change-password',
  'confirm-password',
];

// Records every policy violation in a frame, from before any of its own
// script runs.
function recordViolations() {
  let violations: string[] = [];
  (window as any).__securePolicyViolations = violations;
  document.addEventListener('securitypolicyviolation', (event) => {
    violations.push(
      `${event.effectiveDirective} refused ${event.blockedURI || 'inline'} (${event.sourceFile}:${event.lineNumber})`,
    );
  });
}

async function violationsIn(frame: Page | Frame): Promise<string[]> {
  return await frame.evaluate(() => [
    ...((window as any).__securePolicyViolations ?? ['no listener in frame']),
  ]);
}

async function listen(handler: Parameters<typeof createServer>[1]) {
  let server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, port: (server.address() as AddressInfo).port };
}

async function close(server: Server | undefined) {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

module(basename(import.meta.filename), function (hooks) {
  let browser: Browser;
  let page: Page;
  let secureServer: Server | undefined;
  let appServer: Server | undefined;
  let apiServer: Server | undefined;
  let secureOrigin: string;
  let appOrigin: string;

  hooks.before(async function () {
    // The realm server and the Matrix server the pages talk to. Neither has
    // anything to say: a page that can't reach one still renders, and a
    // request to one is within the policy either way.
    let api = await listen((_req, res) => {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
    apiServer = api.server;
    let apiURL = new URL(`http://localhost:${api.port}/`);

    // The app page that frames the credential fields, on an origin of its
    // own, as the host app's is.
    let app = await listen((req, res) => {
      let form = new URL(req.url ?? '/', 'http://localhost').searchParams.get(
        'form',
      );
      let src = `${secureOrigin}/secure/credentials#form=${encodeURIComponent(
        form ?? '',
      )}&origin=${encodeURIComponent(appOrigin)}`;
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(
        `<!doctype html><html><body><iframe id="fields" src="${src}"></iframe></body></html>`,
      );
    });
    appServer = app.server;
    appOrigin = `http://localhost:${app.port}`;

    let koa = new Koa();
    let secure = await listen((req, res) => koa.callback()(req, res));
    secureServer = secure.server;
    secureOrigin = `http://127.0.0.1:${secure.port}`;
    koa.use(
      secureOriginGate(
        createSecureOrigin(
          new URL(`${secureOrigin}/secure`),
          {
            matrixURL: apiURL,
            realmServerURL: apiURL,
            appOrigins: [appOrigin],
          },
          { realmServerURL: apiURL, matrixURL: apiURL },
        ),
      ),
    );

    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        // Keeps the framed credential fields in the page's own process, so
        // the violation listener is installed in that frame too.
        '--disable-features=IsolateOrigins,site-per-process',
      ],
      ...(process.env.PUPPETEER_EXECUTABLE_PATH
        ? { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH }
        : {}),
    });
    page = await browser.newPage();
    await page.evaluateOnNewDocument(recordViolations);
  });

  hooks.after(async function () {
    await browser?.close();
    await close(secureServer);
    await close(appServer);
    await close(apiServer);
  });

  test('a violation of the policy is seen', async function (assert) {
    await page.goto(`${secureOrigin}/secure?mode=sign-in`, {
      waitUntil: 'networkidle0',
    });
    await page.evaluate(() =>
      document.body.setAttribute('style', 'color: red'),
    );
    await page.waitForFunction(
      () => (window as any).__securePolicyViolations.length > 0,
      { timeout: 5000 },
    );
    let [violation] = await violationsIn(page);
    assert.ok(
      violation.startsWith('style-src-attr refused inline'),
      `a style attribute is refused and recorded (${violation})`,
    );
  });

  test("each of the shell's modes runs under the policy", async function (assert) {
    for (let path of SHELL_PAGES) {
      let response = await page.goto(`${secureOrigin}${path}`, {
        waitUntil: 'networkidle0',
      });
      assert.strictEqual(response?.status(), 200, `${path}: status`);
      assert.ok(
        response
          ?.headers()
          ['content-security-policy']?.includes(`default-src 'self'`),
        `${path}: served with the policy`,
      );
      if (path !== '/secure') {
        await page.waitForSelector('#secure-shell > *', { timeout: 10000 });
        assert.ok(true, `${path}: the mode rendered`);
      }
      assert.deepEqual(await violationsIn(page), [], `${path}: no violation`);
    }
  });

  test('each credential form runs under the policy, framed by the app', async function (assert) {
    for (let form of CREDENTIAL_FORMS) {
      await page.goto(`${appOrigin}/?form=${form}`, {
        waitUntil: 'networkidle0',
      });
      let frame = await (await page.$('#fields'))!.contentFrame();
      assert.ok(frame, `${form}: framed`);
      await frame!.waitForSelector('#credential-fields input', {
        timeout: 10000,
      });
      assert.ok(true, `${form}: the fields rendered`);
      assert.deepEqual(await violationsIn(frame!), [], `${form}: no violation`);
    }
  });
});
