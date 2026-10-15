import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { createServer, type Server, type ServerResponse } from 'http';
import type { RealmPermissions } from '@cardstack/runtime-common';
import { rri } from '@cardstack/runtime-common';
import type { Prerenderer } from '../prerender/index.ts';
import {
  UnresponsiveTabTracker,
  type UnresponsiveTabReport,
} from '../prerender/unresponsive-tab-tracker.ts';
import {
  getPrerendererForTesting,
  setupPermissionedRealmsCached,
  testCreatePrerenderAuth,
  testPort,
} from './helpers/index.ts';
import { prerenderCard } from './helpers/prerender.ts';

// When unresponsive tabs call for a browser recycle, the prerender server
// kills Chrome and restarts it under every render in flight, not just the
// one that reported. This drives that sequence against real Chrome: a card
// that pegs its tab times out and triggers the recycle while another realm's
// visit is mid-render on a tab of its own. The kill must not hang on the
// wedged browser, and the other visit must fail over to the new browser and
// render there.
//
// The decision to recycle is the tracker's, which its own tests pin. Here the
// tracker is stubbed to call for a recycle on the first report, so a single
// pegged card is enough to reach the kill.
//
// Both cards consult a gate this test serves:
//   * the wedged card pegs its main thread when the gate says so;
//   * the steady card makes a synchronous request the gate holds, which keeps
//     its visit mid-render until the test releases it.
// Outside this test nothing listens on the gate's port, so the requests fail
// at once and the fixture build renders both cards normally.

const wedgedRealmURL = `http://127.0.0.1:${testPort(4475)}/wedged/`;
const steadyRealmURL = `http://127.0.0.1:${testPort(4476)}/steady/`;
const gatePort = testPort(4477);
const gateURL = `http://127.0.0.1:${gatePort}/`;

// Bounded, so a failure of the kill path can't leave a tab spinning for the
// rest of the suite.
const PEG_MS = 60_000;
// The wedged card's render timeout. The steady card's is far above anything
// this test waits through, so only the wedged card times out.
const WEDGED_TIMEOUT_MS = 2_000;
const STEADY_TIMEOUT_MS = 60_000;
// Long enough for the responsiveness probe to report the pegged tab, short
// enough to keep the test quick.
const DIAGNOSTICS_BUDGET_MS = 5_000;

const testUserId = '@user1:localhost';

// Answers `/peg` at once and holds `/hold` until released. Every answer
// carries CORS headers, since the request comes from the host app's origin.
function startGate() {
  let held: ServerResponse[] = [];
  let released = false;
  let holdCount = 0;
  let onHold: (() => void) | undefined;
  let answer = (res: ServerResponse, body: string) => {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain',
    });
    res.end(body);
  };
  let server: Server = createServer((req, res) => {
    if (req.url?.startsWith('/peg')) {
      answer(res, 'peg');
      return;
    }
    if (req.url?.startsWith('/hold')) {
      holdCount++;
      onHold?.();
      if (released) {
        answer(res, 'go');
      } else {
        held.push(res);
      }
      return;
    }
    res.writeHead(404);
    res.end();
  });
  let firstHold = new Promise<void>((resolve) => (onHold = resolve));
  return {
    async listen() {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(gatePort, '127.0.0.1', () => {
          server.off('error', reject);
          resolve();
        });
      });
    },
    firstHold,
    get holdCount() {
      return holdCount;
    },
    release() {
      released = true;
      for (let res of held.splice(0)) {
        if (!res.writableEnded && !res.destroyed) {
          answer(res, 'go');
        }
      }
    },
    async close() {
      this.release();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function cardDoc(module: string, name: string, title: string) {
  return {
    data: {
      attributes: { title },
      meta: { adoptsFrom: { module: rri(module), name } },
    },
  };
}

async function waitFor(condition: () => boolean, label: string) {
  let deadline = Date.now() + 60_000;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${label}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

module(basename(import.meta.filename), function (hooks) {
  let prerenderer: Prerenderer;
  let permissions: RealmPermissions = {};
  let auth = () => testCreatePrerenderAuth(testUserId, permissions);

  hooks.before(async () => {
    prerenderer = getPrerendererForTesting({
      maxPages: 2,
      serverURL: new URL(steadyRealmURL).origin,
    });
  });

  hooks.after(async () => {
    await prerenderer.stop();
  });

  setupPermissionedRealmsCached(hooks, {
    mode: 'before',
    realms: [
      {
        realmURL: wedgedRealmURL,
        permissions: {
          '*': ['read'],
          [testUserId]: ['read', 'write', 'realm-owner'],
        },
        fileSystem: {
          'wedge.gts': `
            import { CardDef, field, contains, StringField, Component } from '@cardstack/base/card-api';

            export class Wedge extends CardDef {
              static displayName = 'Wedge';
              @field title = contains(StringField);
              static isolated = class Isolated extends Component<typeof this> {
                get renderedTitle() {
                  let peg = false;
                  try {
                    let xhr = new XMLHttpRequest();
                    xhr.open('GET', '${gateURL}peg?' + Math.random(), false);
                    xhr.send();
                    peg = xhr.status === 200;
                  } catch (e) {
                    // no gate: render normally
                  }
                  if (peg) {
                    let deadline = performance.now() + ${PEG_MS};
                    while (performance.now() < deadline) {
                      // hold the main thread so the render cannot settle
                    }
                  }
                  return this.args.model.title;
                }
                <template><h1>{{this.renderedTitle}}</h1></template>
              };
            }
          `,
          'wedge-1.json': cardDoc('./wedge', 'Wedge', 'wedged'),
        },
      },
      {
        realmURL: steadyRealmURL,
        permissions: {
          '*': ['read'],
          [testUserId]: ['read', 'write', 'realm-owner'],
        },
        fileSystem: {
          'steady.gts': `
            import { CardDef, field, contains, StringField, Component } from '@cardstack/base/card-api';

            export class Steady extends CardDef {
              static displayName = 'Steady';
              @field title = contains(StringField);
              static isolated = class Isolated extends Component<typeof this> {
                get renderedTitle() {
                  try {
                    let xhr = new XMLHttpRequest();
                    xhr.open('GET', '${gateURL}hold?' + Math.random(), false);
                    xhr.send();
                  } catch (e) {
                    // no gate, or the gate went away: render normally
                  }
                  return this.args.model.title;
                }
                <template><h1>{{this.renderedTitle}}</h1></template>
              };
            }
          `,
          'steady-1.json': cardDoc('./steady', 'Steady', 'still standing'),
        },
      },
    ],
    onRealmSetup() {
      permissions = {
        [wedgedRealmURL]: ['read', 'write', 'realm-owner'],
        [steadyRealmURL]: ['read', 'write', 'realm-owner'],
      };
    },
  });

  test('a recycle kills Chrome under an in-flight visit, which renders on the new browser', async function (assert) {
    assert.timeout(180_000);
    let gate = startGate();
    let originalRecord = UnresponsiveTabTracker.prototype.record;
    let priorBudget = process.env.RENDER_TIMEOUT_DIAGNOSTICS_BUDGET_MS;
    let reports: UnresponsiveTabReport[] = [];
    try {
      await gate.listen();
      UnresponsiveTabTracker.prototype.record = function (report) {
        reports.push(report);
        return reports.length === 1 ? 'recycle on the first report' : null;
      };
      process.env.RENDER_TIMEOUT_DIAGNOSTICS_BUDGET_MS = String(
        DIAGNOSTICS_BUDGET_MS,
      );
      let restartsBefore = prerenderer.getBrowserRestartCount();

      let steady = prerenderCard(prerenderer, {
        affinityType: 'realm',
        affinityValue: steadyRealmURL,
        realm: steadyRealmURL,
        url: `${steadyRealmURL}steady-1`,
        auth: auth(),
        opts: { timeoutMs: STEADY_TIMEOUT_MS },
      });
      // The steady visit is mid-render, holding its tab, before the wedged
      // card starts.
      await gate.firstHold;

      let wedged = prerenderCard(prerenderer, {
        affinityType: 'realm',
        affinityValue: wedgedRealmURL,
        realm: wedgedRealmURL,
        url: `${wedgedRealmURL}wedge-1`,
        auth: auth(),
        opts: { timeoutMs: WEDGED_TIMEOUT_MS },
      });

      await waitFor(
        () => prerenderer.getBrowserRestartCount() > restartsBefore,
        'the browser recycle',
      );
      // Requests from the new browser are answered at once.
      gate.release();

      let steadyResult = await steady;
      assert.notOk(
        steadyResult.response.error,
        `the steady visit rendered without error: ${JSON.stringify(
          steadyResult.response.error?.error?.message,
        )}`,
      );
      assert.ok(
        steadyResult.response.isolatedHTML?.includes('still standing'),
        'the steady card rendered its HTML',
      );
      assert.true(
        gate.holdCount >= 2,
        `the steady card rendered again on the new browser (${gate.holdCount} renders reached the gate)`,
      );

      let [wedgedResult] = await Promise.allSettled([wedged]);
      let wedgedRendered =
        wedgedResult.status === 'fulfilled' &&
        Boolean(wedgedResult.value.response.isolatedHTML?.includes('wedged'));
      assert.false(wedgedRendered, 'the wedged card did not render');
      assert.strictEqual(
        reports[0]?.affinityKey.split('#')[0],
        `realm:${wedgedRealmURL}`,
        'the wedged realm reported the unresponsive tab',
      );
      assert.strictEqual(
        prerenderer.getBrowserRestartCount(),
        restartsBefore + 1,
        'the browser restarted once',
      );
    } finally {
      UnresponsiveTabTracker.prototype.record = originalRecord;
      if (priorBudget === undefined) {
        delete process.env.RENDER_TIMEOUT_DIAGNOSTICS_BUDGET_MS;
      } else {
        process.env.RENDER_TIMEOUT_DIAGNOSTICS_BUDGET_MS = priorBudget;
      }
      await gate.close();
    }
  });
});
