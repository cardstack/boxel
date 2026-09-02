// Boots the host's `/_standby` route in a browser the way the prerender page
// pool does (fresh browser context, `#standby-ready` readiness marker) and
// reports how long each phase took, what the page logged, which requests
// failed, and how much memory the browser holds while N standby pages are
// open. Run it against a launched Chrome for the baseline and against
// another CDP endpoint to compare.
//
//   node scripts/standby-boot-probe.ts --launch --host-url https://host.<slug>.localhost
//   node scripts/standby-boot-probe.ts --ws ws://127.0.0.1:9224 --host-url https://... --rss-pid <obscura pid>
//
// Options:
//   --iterations <n>  sequential cold standby boots to time (default 3)
//   --hold <n>        standby pages to keep open for the memory sample (default 4)
//   --hold-ms <ms>    how long to hold them before the second sample (default 5000)
//   --timeout <ms>    per-phase navigation / readiness timeout (default 120000)
//   --rss-pid <pid>   process tree to measure in --ws mode
//   --dump            print every request URL and the page's script tags / globals after each boot
//   --shim <file.js>  JavaScript to run in every new document before the page's own scripts

import puppeteer, {
  type Browser,
  type BrowserContext,
  type Page,
} from 'puppeteer';
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { performance } from 'perf_hooks';

let argv = process.argv.slice(2);
function opt(name: string, fallback?: string): string | undefined {
  let i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : fallback;
}
let launch = argv.includes('--launch');
let wsEndpoint = opt('--ws');
let hostURL = opt('--host-url')?.replace(/\/$/, '');
let iterations = Number(opt('--iterations', '3'));
let hold = Number(opt('--hold', '4'));
let holdMs = Number(opt('--hold-ms', '5000'));
let timeout = Number(opt('--timeout', '120000'));
let rssPid = opt('--rss-pid') ? Number(opt('--rss-pid')) : undefined;
let dump = argv.includes('--dump');
let shimSource = opt('--shim')
  ? readFileSync(opt('--shim')!, 'utf8')
  : undefined;
if ((!launch && !wsEndpoint) || !hostURL) {
  console.error('need (--launch | --ws <endpoint>) and --host-url <url>');
  process.exit(2);
}

setTimeout(() => {
  console.error('standby probe: hard timeout, exiting');
  process.exit(3);
}, 15 * 60_000).unref();

function rssTreeMB(rootPid: number): number {
  let out = execFileSync('ps', ['-axo', 'pid=,ppid=,rss='], {
    encoding: 'utf8',
  });
  let children = new Map<number, number[]>();
  let rss = new Map<number, number>();
  for (let line of out.split('\n')) {
    let m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)$/);
    if (!m) continue;
    let pid = Number(m[1]);
    let ppid = Number(m[2]);
    rss.set(pid, Number(m[3]));
    if (!children.has(ppid)) children.set(ppid, []);
    children.get(ppid)!.push(pid);
  }
  let total = 0;
  let stack = [rootPid];
  let seen = new Set<number>();
  while (stack.length) {
    let pid = stack.pop()!;
    if (seen.has(pid)) continue;
    seen.add(pid);
    total += rss.get(pid) ?? 0;
    for (let c of children.get(pid) ?? []) stack.push(c);
  }
  return Math.round(total / 1024);
}

type BootReport = {
  navMs: number;
  readyMs: number;
  totalMs: number;
  ready: boolean;
  status?: number;
  error?: string;
  consoleErrors: string[];
  consoleWarnings: number;
  consoleTotal: number;
  pageErrors: string[];
  requestsFailed: string[];
  badResponses: string[];
  requests: number;
  requestURLs: string[];
  diagnostics?: unknown;
  dumped?: unknown;
};

async function bootStandby(
  browser: Browser,
): Promise<{ context: BrowserContext; page: Page; report: BootReport }> {
  let report: BootReport = {
    navMs: 0,
    readyMs: 0,
    totalMs: 0,
    ready: false,
    consoleErrors: [],
    consoleWarnings: 0,
    consoleTotal: 0,
    pageErrors: [],
    requestsFailed: [],
    badResponses: [],
    requests: 0,
    requestURLs: [],
  };
  let context = await browser.createBrowserContext();
  let page = await context.newPage();
  await page.evaluateOnNewDocument(() => {
    (globalThis as any).__boxelRenderContext = true;
  });
  if (shimSource) {
    await page.evaluateOnNewDocument(shimSource);
  }
  page.on('console', (m) => {
    report.consoleTotal++;
    if (m.type() === 'error') report.consoleErrors.push(m.text().slice(0, 300));
    if (m.type() === 'warn') report.consoleWarnings++;
  });
  page.on('pageerror', (e) =>
    report.pageErrors.push(String(e?.message ?? e).slice(0, 300)),
  );
  page.on('request', (r) => {
    report.requests++;
    if (dump)
      report.requestURLs.push(`${r.method()} ${r.resourceType()} ${r.url()}`);
  });
  page.on('requestfailed', (r) =>
    report.requestsFailed.push(
      `${r.failure()?.errorText ?? '?'} ${r.url()}`.slice(0, 300),
    ),
  );
  page.on('response', (r) => {
    if (r.status() >= 400)
      report.badResponses.push(`${r.status()} ${r.url()}`.slice(0, 300));
  });
  let t0 = performance.now();
  try {
    let response = await page.goto(`${hostURL}/_standby`, {
      waitUntil: 'domcontentloaded',
      timeout,
    });
    report.status = response?.status();
    let t1 = performance.now();
    report.navMs = Math.round(t1 - t0);
    await page.waitForFunction(
      () => !!document.querySelector('#standby-ready'),
      { timeout },
    );
    let t2 = performance.now();
    report.readyMs = Math.round(t2 - t1);
    report.ready = true;
  } catch (e: any) {
    report.error = String(e?.message ?? e)
      .split('\n')[0]
      .slice(0, 300);
  }
  report.totalMs = Math.round(performance.now() - t0);
  try {
    report.diagnostics = await Promise.race([
      page.evaluate(() => ({
        title: document.title,
        readyState: document.readyState,
        url: location.href,
        scripts: document.scripts.length,
        bodyLength: document.body?.innerHTML.length ?? 0,
        standby:
          document.querySelector('#standby-ready')?.outerHTML.slice(0, 200) ??
          null,
        emberApp:
          !!document.querySelector('.ember-application') ||
          !!(globalThis as any).Ember ||
          !!(globalThis as any).boxelTransitionTo,
        transitionFn: typeof (globalThis as any).boxelTransitionTo,
        bodySnippet: (document.body?.innerHTML ?? '')
          .replace(/\s+/g, ' ')
          .slice(0, 400),
      })),
      new Promise((_, rej) =>
        setTimeout(
          () => rej(new Error('diagnostics evaluate timed out')),
          10_000,
        ),
      ),
    ]);
  } catch (e: any) {
    report.diagnostics = `ERR ${String(e?.message ?? e).slice(0, 200)}`;
  }
  if (dump) {
    try {
      report.dumped = await Promise.race([
        page.evaluate(() => ({
          scripts: Array.from(document.scripts).map(
            (s) =>
              `${s.type || 'classic'} ${s.src ? s.src.replace(location.origin, '') : `inline(${s.textContent?.length})`}${(s as any).noModule ? ' nomodule' : ''}${s.async ? ' async' : ''}${s.defer ? ' defer' : ''}`,
          ),
          links: Array.from(document.querySelectorAll('link'))
            .map((l) => `${l.rel} ${l.getAttribute('href')}`)
            .slice(0, 30),
          globals: Object.keys(globalThis)
            .filter((k) =>
              /ember|glimmer|boxel|__|define|require|vite|process/i.test(k),
            )
            .slice(0, 40),
          importMap:
            document
              .querySelector('script[type="importmap"]')
              ?.textContent?.slice(0, 200) ?? null,
          errors: (globalThis as any).__viteErrors ?? null,
        })),
        new Promise((_, rej) =>
          setTimeout(() => rej(new Error('dump evaluate timed out')), 10_000),
        ),
      ]);
    } catch (e: any) {
      report.dumped = `ERR ${String(e?.message ?? e).slice(0, 200)}`;
    }
  }
  return { context, page, report };
}

function printReport(label: string, r: BootReport) {
  console.log(
    `\n--- ${label}: ${r.ready ? 'READY' : 'NOT READY'} status=${r.status ?? '?'} nav=${r.navMs}ms boot=${r.readyMs}ms total=${r.totalMs}ms requests=${r.requests}`,
  );
  if (r.error) console.log(`  error: ${r.error}`);
  console.log(
    `  console: ${r.consoleTotal} messages, ${r.consoleWarnings} warnings, ${r.consoleErrors.length} errors`,
  );
  for (let m of r.consoleErrors.slice(0, 15))
    console.log(`    [console.error] ${m}`);
  for (let m of r.pageErrors.slice(0, 15)) console.log(`    [pageerror] ${m}`);
  for (let m of r.requestsFailed.slice(0, 15))
    console.log(`    [requestfailed] ${m}`);
  for (let m of r.badResponses.slice(0, 15)) console.log(`    [response] ${m}`);
  console.log(`  diagnostics: ${JSON.stringify(r.diagnostics)}`);
  if (dump) {
    console.log(`  dumped: ${JSON.stringify(r.dumped, null, 1)}`);
    console.log(`  requests (${r.requestURLs.length}):`);
    for (let u of r.requestURLs.slice(0, 150))
      console.log(`    ${u.replace(hostURL!, '')}`);
    if (r.requestURLs.length > 150)
      console.log(`    … ${r.requestURLs.length - 150} more`);
  }
}

async function main() {
  let t0 = performance.now();
  let browser: Browser;
  if (launch) {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--ignore-certificate-errors',
        '--allow-insecure-localhost',
      ],
    });
  } else {
    browser = await puppeteer.connect({ browserWSEndpoint: wsEndpoint! });
  }
  let connectMs = Math.round(performance.now() - t0);
  let rootPid = launch ? browser.process()?.pid : rssPid;
  console.log(
    `mode=${launch ? 'launch' : `connect ${wsEndpoint}`} version=${await browser.version().catch(() => '?')} connect/launch=${connectMs}ms rssRoot=${rootPid ?? 'n/a'}`,
  );
  if (rootPid) console.log(`RSS before any page: ${rssTreeMB(rootPid)} MB`);

  let totals: number[] = [];
  for (let i = 0; i < iterations; i++) {
    let { context, report } = await bootStandby(browser);
    printReport(`cold standby boot #${i + 1}`, report);
    if (report.ready) totals.push(report.totalMs);
    await context.close().catch(() => {});
  }
  if (totals.length) {
    let sorted = [...totals].sort((a, b) => a - b);
    console.log(
      `\nstandby boot total ms: median ${sorted[Math.floor(sorted.length / 2)]} all [${totals.join(', ')}]`,
    );
  }

  if (hold > 0) {
    let held: BrowserContext[] = [];
    let readyCount = 0;
    let t = performance.now();
    for (let i = 0; i < hold; i++) {
      let { context, report } = await bootStandby(browser);
      if (report.ready) readyCount++;
      else printReport(`held standby #${i + 1}`, report);
      held.push(context);
    }
    console.log(
      `\nheld ${held.length} standby pages (${readyCount} ready) in ${Math.round(performance.now() - t)}ms`,
    );
    if (rootPid)
      console.log(
        `RSS with ${held.length} standby pages open: ${rssTreeMB(rootPid)} MB`,
      );
    await new Promise((r) => setTimeout(r, holdMs));
    if (rootPid)
      console.log(`RSS after holding ${holdMs}ms: ${rssTreeMB(rootPid)} MB`);
    for (let c of held) await c.close().catch(() => {});
    await new Promise((r) => setTimeout(r, 1000));
    if (rootPid)
      console.log(`RSS after closing them: ${rssTreeMB(rootPid)} MB`);
  }

  if (launch) await browser.close();
  else await browser.disconnect();
}

main().catch((e) => {
  console.error('standby probe failed:', e);
  process.exit(1);
});
