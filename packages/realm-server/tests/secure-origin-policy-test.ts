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
//
// The built pages are also where the theme's tokens resolve, so this is where
// the error and muted text colours are checked against WCAG AA contrast.

// Every page the shell presents, each at its own path, loaded directly: the
// key page at the shell's own address, a key's share page beneath it, and the
// address Google returns to.
const SHELL_PAGES = [
  '/secure',
  '/secure/sign-in',
  '/secure/cli-sign-in?port=4567&state=example-state',
  '/secure/cli-auth?port=4567&state=example-state-0123',
  '/secure/cli-auth?port=4567&state=example-state-0123&session=secure',
  '/secure/register',
  '/secure/verify-email',
  '/secure/forgot-password',
  '/secure/reset-password',
  '/secure/sign-out',
  '/secure/keys',
  '/secure/keys/add',
  '/secure/keys/0b6c1e9e-5a1f-4c47-9d0e-2f5b8f6f1a3c/share',
  '/secure/enter-key',
  '/secure/share-key#realm=https%3A%2F%2Frealm.example%2F',
  '/secure/swap-key#realm=https%3A%2F%2Frealm.example%2F&share=example',
  '/secure/google-callback',
];

// Addresses that name a page by the `mode` query parameter, as earlier CLI
// releases and emails already sent do, and the address each lands on.
const LEGACY_ADDRESSES: [string, string][] = [
  ['/secure?mode=sign-in', '/secure/sign-in'],
  ['/secure/?mode=keys', '/secure/keys'],
  [
    '/secure?mode=cli-sign-in&port=4567&state=example-state&user=someone',
    '/secure/cli-sign-in?port=4567&state=example-state&user=someone',
  ],
  [
    '/secure?mode=cli-auth&port=4567&state=example-state-0123&session=secure',
    '/secure/cli-auth?port=4567&state=example-state-0123&session=secure',
  ],
  ['/secure?mode=register', '/secure/register'],
  ['/secure?mode=forgot-password', '/secure/forgot-password'],
  [
    '/secure?mode=share-key#realm=https%3A%2F%2Frealm.example%2F',
    '/secure/share-key#realm=https%3A%2F%2Frealm.example%2F',
  ],
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
    await page.goto(`${secureOrigin}/secure/sign-in`, {
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

  test("each of the shell's pages runs under the policy", async function (assert) {
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
      await page.waitForSelector('#secure-shell > *', { timeout: 10000 });
      assert.ok(true, `${path}: the page rendered`);
      assert.deepEqual(await violationsIn(page), [], `${path}: no violation`);
    }
  });

  test('an address naming a page by its `mode` lands on that page', async function (assert) {
    for (let [legacy, landed] of LEGACY_ADDRESSES) {
      await page.goto(`${secureOrigin}${legacy}`, {
        waitUntil: 'networkidle0',
      });
      await page.waitForSelector('#secure-shell > *', { timeout: 10000 });
      let { pathname, search, hash } = await page.evaluate(() => ({
        pathname: window.location.pathname,
        search: window.location.search,
        hash: window.location.hash,
      }));
      assert.strictEqual(`${pathname}${search}${hash}`, landed, legacy);
      assert.deepEqual(await violationsIn(page), [], `${legacy}: no violation`);
    }
  });

  test('moving between pages is a route transition, and back returns', async function (assert) {
    // A mark left on the first document is still there after a move only if
    // the move loaded no new one.
    await page.goto(`${secureOrigin}/secure/sign-in`, {
      waitUntil: 'networkidle0',
    });
    await page.evaluate(() => {
      (window as any).__document = 'first';
    });
    await page.waitForSelector('[data-test-forgot-password]', {
      timeout: 10000,
    });
    await page.click('[data-test-forgot-password]');
    await page.waitForFunction(
      () => window.location.pathname === '/secure/forgot-password',
      { timeout: 10000 },
    );
    await page.waitForSelector('[data-test-forgot-password-form]', {
      timeout: 10000,
    });
    assert.strictEqual(
      await page.evaluate(() => (window as any).__document),
      'first',
      'the move forward loads no new document',
    );
    await page.goBack();
    await page.waitForFunction(
      () => window.location.pathname === '/secure/sign-in',
      { timeout: 10000 },
    );
    await page.waitForSelector('[data-test-forgot-password]', {
      timeout: 10000,
    });
    assert.strictEqual(
      await page.evaluate(() => (window as any).__document),
      'first',
      'nor does the move back',
    );
    assert.deepEqual(await violationsIn(page), [], 'no violation');

    // The sign-out page moves on to the sign-in page itself once it has
    // ended the window's session.
    await page.goto(`${secureOrigin}/secure/sign-out`, {
      waitUntil: 'networkidle0',
    });
    await page.waitForFunction(
      () => window.location.pathname === '/secure/sign-in',
      { timeout: 10000 },
    );
    await page.waitForSelector('[data-test-forgot-password]', {
      timeout: 10000,
    });
    assert.deepEqual(await violationsIn(page), [], 'signed out: no violation');
  });

  test('the screens a sign-in is handed back to the app from run under the policy', async function (assert) {
    // A window already signed in, sent here by an app on a loopback origin:
    // it asks to confirm, then, with nothing to mint the token, says the
    // hand-off didn't work.
    await page.goto(`${secureOrigin}/secure?mode=none`, {
      waitUntil: 'networkidle0',
    });
    await page.evaluate(() =>
      localStorage.setItem(
        'boxel-secure-session',
        JSON.stringify({
          token: 'policy-test',
          user: '@someone:example.test',
          expiresAt: '2099-01-01T00:00:00.000Z',
        }),
      ),
    );
    await page.goto(
      `${secureOrigin}/secure/sign-in#return=${encodeURIComponent(`${appOrigin}/`)}`,
      { waitUntil: 'networkidle0' },
    );
    await page.waitForSelector('[data-test-secure-loopback-confirm]', {
      timeout: 10000,
    });
    assert.deepEqual(
      await violationsIn(page),
      [],
      'asking to confirm: no violation',
    );
    await page.click('[data-test-secure-loopback-continue]');
    await page.waitForSelector('[data-test-secure-handoff-retry]', {
      timeout: 10000,
    });
    assert.deepEqual(
      await violationsIn(page),
      [],
      'handing over, and failing to: no violation',
    );
    await page.evaluate(() => localStorage.clear());
  });

  // The error rules a selector pattern picks out of every stylesheet the
  // shell ships, and the page's muted text, each resolved inside `container`
  // under its theme and composited over its background on a canvas, which
  // turns any CSS colour into sRGB.
  async function textColors(container: string, errorRule: RegExp) {
    return await page.evaluate(
      (container, source, flags) => {
        let element = document.querySelector(container)!;
        let canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        let context = canvas.getContext('2d', { willReadFrequently: true })!;
        let backgroundColor = getComputedStyle(element).backgroundColor;
        let toRGB = (color: string) => {
          context.fillStyle = backgroundColor;
          context.fillRect(0, 0, 1, 1);
          context.fillStyle = color;
          context.fillRect(0, 0, 1, 1);
          return [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)];
        };
        let resolve = (value: string) => {
          let probe = document.createElement('span');
          probe.style.setProperty('color', value);
          element.append(probe);
          let color = getComputedStyle(probe).color;
          probe.remove();
          return toRGB(color);
        };
        let errorRule = new RegExp(source, flags);
        let colors: { label: string; rgb: number[] }[] = [];
        let nested = 0;
        // The components' rules sit inside `@layer` blocks, so the walk
        // descends into every grouping rule.
        let visit = (rules: CSSRuleList, depth: number) => {
          for (let rule of rules) {
            if (rule instanceof CSSGroupingRule) {
              visit(rule.cssRules, depth + 1);
              continue;
            }
            if (!(rule instanceof CSSStyleRule)) {
              continue;
            }
            let value = rule.style.getPropertyValue('color');
            if (
              value &&
              rule.selectorText.split(',').some((s) => errorRule.test(s.trim()))
            ) {
              if (depth > 0) {
                nested++;
              }
              colors.push({
                label: `${rule.selectorText} { color: ${value} }`,
                rgb: resolve(value),
              });
            }
          }
        };
        for (let sheet of document.styleSheets) {
          visit(sheet.cssRules, 0);
        }
        colors.push({
          label: 'var(--muted-foreground)',
          rgb: resolve('var(--muted-foreground)'),
        });
        return { background: toRGB(backgroundColor), colors, nested };
      },
      container,
      errorRule.source,
      errorRule.flags,
    );
  }

  function assertContrast(
    assert: Assert,
    where: string,
    { background, colors, nested }: Awaited<ReturnType<typeof textColors>>,
  ) {
    let luminance = (rgb: number[]) => {
      let [r, g, b] = rgb.map((channel) => {
        let c = channel / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    let contrast = (a: number[], b: number[]) => {
      let [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (light + 0.05) / (dark + 0.05);
    };

    assert.ok(
      colors.length > 1,
      `${where}: the shell's stylesheets hold error rules (${colors.length - 1})`,
    );
    // The sign-in pages' rules sit inside `@layer` blocks; this shows the
    // walk reached them.
    if (where === 'sign-in') {
      assert.ok(
        nested > 0,
        `${where}: error rules inside @layer blocks are checked (${nested})`,
      );
    }
    for (let { label, rgb } of colors) {
      let ratio = contrast(rgb, background);
      assert.ok(
        ratio >= 4.5,
        `${where}: ${label}: rgb(${rgb.join(', ')}) on rgb(${background.join(', ')}) is ${ratio.toFixed(2)}:1`,
      );
    }
  }

  test('error and muted text on the sign-in pages meet WCAG AA contrast', async function (assert) {
    // Every page's stylesheet ships with the shell, so this one page holds
    // the error rules of all the sign-in pages.
    await page.goto(`${secureOrigin}/secure/sign-in`, {
      waitUntil: 'networkidle0',
    });
    await page.waitForSelector('[data-test-secure-page]', { timeout: 10000 });
    assertContrast(
      assert,
      'sign-in',
      await textColors(
        '[data-test-secure-page]',
        /^\.error(-message)?(\[[^\]]+\])?$/,
      ),
    );
  });

  test('error and muted text on the key pages meet WCAG AA contrast', async function (assert) {
    // The key pages draw their errors on the key window's own panel, which
    // has a theme and background of its own.
    await page.goto(`${secureOrigin}/secure/keys`, {
      waitUntil: 'networkidle0',
    });
    await page.waitForSelector('[data-test-keys-panel]', { timeout: 10000 });
    assertContrast(
      assert,
      'key pages',
      await textColors('[data-test-keys-panel]', /^\.keys-error(\[[^\]]+\])?$/),
    );
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
