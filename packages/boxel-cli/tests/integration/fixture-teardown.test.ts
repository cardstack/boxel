import '../helpers/setup-realm-server.ts';
import { describe, it, expect, afterAll } from 'vitest';
import * as net from 'net';
import {
  startTestRealmServer,
  stopTestRealmServer,
  TEST_REALM_SERVER_URL,
} from '../helpers/integration.ts';

// Every integration file boots its fixture on the same fixed port, and the
// whole suite shares one process, so a fixture that outlives the file that
// asked for it takes every later file down with `EADDRINUSE`. The case that
// produces one is a setup hook that overruns its budget: vitest rejects the
// hook's promise but cannot cancel the boot the hook started, so the boot
// keeps running — and binds the port — with nobody waiting on it.
//
// This drives that state directly rather than through a real hook timeout:
// start a boot, drop the promise, tear down the way the file's `afterAll`
// would, and then boot again the way the next file would.

const CARD_JSON = JSON.stringify({
  data: {
    type: 'card',
    attributes: { title: 'Teardown Probe' },
    meta: {
      adoptsFrom: { module: '@cardstack/base/card-api', name: 'CardDef' },
    },
  },
});

function isFixturePortListening(): Promise<boolean> {
  let { hostname, port } = new URL(TEST_REALM_SERVER_URL);
  return new Promise((resolve) => {
    let socket = new net.Socket();
    let settle = (listening: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(listening);
    };
    socket.setTimeout(1000);
    socket.once('connect', () => settle(true));
    socket.once('timeout', () => settle(false));
    socket.once('error', () => settle(false));
    socket.connect(Number(port), hostname);
  });
}

afterAll(async () => {
  await stopTestRealmServer();
});

describe('fixture teardown (integration)', () => {
  it('releases the fixture port when a boot outlives its caller', async () => {
    let abandoned = startTestRealmServer({
      fileSystem: { 'teardown-probe.json': CARD_JSON },
    });
    // The hook that started this boot is the one that would see its outcome;
    // here nothing does, which is the point.
    abandoned.catch(() => {});

    await stopTestRealmServer();

    // The next file's boot is what a leaked listener actually breaks, so that
    // is the assertion — a bare port probe can sample the gap before an
    // abandoned boot has reached its `listen`.
    let { testRealmHttpServer } = await startTestRealmServer({
      fileSystem: { 'teardown-probe.json': CARD_JSON },
    });
    expect(testRealmHttpServer.listening).toBe(true);

    await stopTestRealmServer();
    expect(await isFixturePortListening()).toBe(false);
  });
});
