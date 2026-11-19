import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { inMemorySessionsGlobal } from '@cardstack/runtime-common/in-memory-sessions';
import { PagePool } from '../prerender/page-pool.ts';
import { RenderRunner } from '../prerender/render-runner.ts';

// How a run-command attempt hands its tab the command's sessions, and what
// becomes of a tab whose command never answers. An automation run's token
// goes to the tab in the page's memory only, and the host drops it as the run
// answers; a run that doesn't answer may still be running its script with the
// token, so its tab is closed rather than returned to the pool. Any other
// command's tab holds only storage-based sessions and goes back to the pool.
//
// The stub tab records every evaluate and never settles the command runner's
// wait, so every command here times out.

type StubTab = { closed: boolean; evaluates: unknown[][] };

function makeBrowserStub() {
  let tabs: StubTab[] = [];
  let browser = {
    async createBrowserContext() {
      let contextTabs: StubTab[] = [];
      let context: any = {
        async close() {
          for (let tab of contextTabs) {
            tab.closed = true;
          }
        },
        async newPage() {
          let tab: StubTab = { closed: false, evaluates: [] };
          let page: any = {
            async goto() {
              return undefined;
            },
            url() {
              return 'http://localhost:4200/';
            },
            async waitForFunction(_fn: unknown, opts?: { timeout?: number }) {
              // The pool's own readiness waits pass no timeout; the command
              // runner's wait passes one and never sees its container.
              if (opts?.timeout === undefined) {
                return true;
              }
              return new Promise<never>(() => {});
            },
            async evaluate(_fn: unknown, ...args: unknown[]) {
              tab.evaluates.push(args);
              return undefined;
            },
            async createCDPSession() {
              return {
                send: async () => ({}),
                once() {},
                on() {},
                off() {},
                async detach() {},
              };
            },
            isClosed() {
              return tab.closed;
            },
            async close() {
              tab.closed = true;
            },
            browserContext() {
              return context;
            },
            on() {},
            off() {},
            removeAllListeners() {},
          };
          tabs.push(tab);
          contextTabs.push(tab);
          return page;
        },
      };
      return context;
    },
  };
  return {
    manager: {
      async getBrowser() {
        return browser as any;
      },
      async cleanupUserDataDirs() {},
    },
    tabs,
  };
}

// A token is read here only for its claims, never verified.
function token(claims: Record<string, unknown>): string {
  let encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256' })}.${encode(claims)}.signature`;
}

const REALM = 'http://localhost:4201/run-sessions/';
const USER = '@run-sessions-user:localhost';

const ENV_KEYS = [
  'PRERENDER_PAGE_POOL_MIN',
  'PRERENDER_PAGE_POOL_MAX',
  'PRERENDER_PAGE_POOL_INITIAL',
  'PRERENDER_AFFINITY_TAB_MAX',
  'PRERENDER_PAGE_POOL_HIGH_PRIORITY_MAX',
  'PRERENDER_HIGH_PRIORITY_THRESHOLD',
  'PRERENDER_POOL_IDLE_CONTRACTION_MS',
  'PRERENDER_SHARED_CONTEXT_CAP',
  'PRERENDER_TAB_HEALTH_PROBE_MS',
  'RENDER_TIMEOUT_DIAGNOSTICS_BUDGET_MS',
];

const COMMAND_TIMEOUT_MS = 200;

module(basename(import.meta.filename), function (hooks) {
  let pools: PagePool[] = [];
  let savedEnv: Record<string, string | undefined> = {};

  hooks.beforeEach(() => {
    for (let key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    process.env.PRERENDER_PAGE_POOL_MIN = '1';
    process.env.PRERENDER_PAGE_POOL_MAX = '2';
    process.env.PRERENDER_AFFINITY_TAB_MAX = '1';
    process.env.RENDER_TIMEOUT_DIAGNOSTICS_BUDGET_MS = '200';
  });

  hooks.afterEach(async () => {
    for (let pool of pools.splice(0)) {
      try {
        await pool.closeAll();
      } catch {
        // best-effort
      }
    }
    for (let key of ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
    savedEnv = {};
  });

  async function setup() {
    let { manager, tabs } = makeBrowserStub();
    let pool = new PagePool({
      maxPages: 2,
      serverURL: 'http://localhost',
      browserManager: manager as any,
      boxelHostURL: 'http://localhost:4200',
      standbyTimeoutMs: 500,
      disableFileAdmission: true,
      tabHealthProbeMs: 50,
    });
    pools.push(pool);
    let runner = new RenderRunner({
      pagePool: pool,
      boxelHostURL: 'http://localhost:4200',
    });
    await pool.warmStandbys();
    return { runner, tabs };
  }

  async function waitFor(condition: () => boolean, label: string) {
    let deadline = Date.now() + 2000;
    while (!condition()) {
      if (Date.now() > deadline) {
        throw new Error(`timed out waiting for: ${label}`);
      }
      await new Promise<void>((r) => setTimeout(r, 5));
    }
  }

  // The evaluate that hands the tab its sessions: the first one whose first
  // argument is the command's auth.
  function sessionsHandoff(tabs: StubTab[], auth: string) {
    for (let tab of tabs) {
      let args = tab.evaluates.find((evaluateArgs) => evaluateArgs[0] === auth);
      if (args) {
        return { tab, inMemory: args[1], sessionsGlobal: args[2] };
      }
    }
    return undefined;
  }

  test("an automation run's sessions go to its tab in memory, and a run that never answers loses its tab", async function (assert) {
    let { runner, tabs } = await setup();
    let auth = JSON.stringify({
      [REALM]: token({ user: USER, realm: REALM, run: 'run-1' }),
    });

    let { response, pool } = await runner.runCommandAttempt({
      affinityType: 'realm',
      affinityValue: REALM,
      auth,
      command: '@cardstack/boxel-host/tools/run-automation/default',
      opts: { timeoutMs: COMMAND_TIMEOUT_MS },
    });

    assert.strictEqual(response.status, 'unusable', 'the run never answered');
    let handoff = sessionsHandoff(tabs, auth);
    assert.true(handoff?.inMemory, 'the sessions went to the tab in memory');
    assert.strictEqual(
      handoff?.sessionsGlobal,
      inMemorySessionsGlobal,
      'on the global the host reads them from',
    );
    assert.true(pool.evicted, "the run's tab was evicted");
    await waitFor(() => handoff?.tab.closed === true, "the run's tab to close");
    assert.true(handoff?.tab.closed, "the run's tab was closed");
  });

  test("another command's sessions go through storage, and its tab outlives a timeout", async function (assert) {
    let { runner, tabs } = await setup();
    let auth = JSON.stringify({
      [REALM]: token({ user: USER, realm: REALM }),
    });

    let { response, pool } = await runner.runCommandAttempt({
      affinityType: 'user',
      affinityValue: USER,
      auth,
      command: '@cardstack/boxel-host/tools/some-command/default',
      opts: { timeoutMs: COMMAND_TIMEOUT_MS },
    });

    assert.strictEqual(
      response.status,
      'unusable',
      'the command never answered',
    );
    let handoff = sessionsHandoff(tabs, auth);
    assert.false(handoff?.inMemory, 'the sessions went through storage');
    assert.false(pool.evicted, "the command's tab was not evicted");
    // Long enough for an eviction's close to have landed.
    await new Promise<void>((r) => setTimeout(r, 100));
    assert.false(handoff?.tab.closed, "the command's tab is still open");
  });
});
