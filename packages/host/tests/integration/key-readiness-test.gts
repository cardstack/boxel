import Service from '@ember/service';
import { render, settled } from '@ember/test-helpers';

import window from 'ember-window-mock';
import { module, test } from 'qunit';

import type { CapabilityCheck, KeyReadiness } from '@cardstack/runtime-common';

import type CapabilitiesService from '@cardstack/host/services/capabilities';
import type SecureWindowService from '@cardstack/host/services/secure-window';

import { setupRenderingTest } from '../helpers/setup';

import type { CardDef } from '@cardstack/base/card-api';

// `@context.keyReadiness` rides on the capability check's request, so what a
// test pins is what it adds there: the pair it sends, the answer a template
// reads, and that coming back from the secure window asks again without the
// page reloading.

const REALM = 'http://test-realm/test/';

interface Sent {
  url: string;
  checks: CapabilityCheck[];
}

// The realm as this test plays it: every pair is allowed, and a pair that asks
// for readiness is answered from `readiness`, by operation.
const realmUnderTest = {
  sent: [] as Sent[],
  readiness: new Map<string, KeyReadiness>(),
  denied: new Set<string>(),
};

class FakeNetwork extends Service {
  authedFetch = async (url: string, init: { body: string }) => {
    let { checks } = JSON.parse(init.body) as { checks: CapabilityCheck[] };
    realmUnderTest.sent.push({ url, checks });
    return {
      ok: true,
      json: async () => ({
        checks: checks.map((check) => {
          let allowed = !realmUnderTest.denied.has(check.operation);
          let readiness = realmUnderTest.readiness.get(check.operation);
          return {
            operation: check.operation,
            target: check.target,
            allowed,
            ...(check.readiness && allowed && readiness ? { readiness } : {}),
          };
        }),
      }),
    } as unknown as Response;
  };
}

class FakeRealm extends Service {
  realmOf = (id: string) => (id.startsWith(REALM) ? REALM : undefined);
}

class FakeMessageService extends Service {
  subscribe() {
    return () => {};
  }
}

function cardAt(id: string): CardDef {
  return { id } as unknown as CardDef;
}

module('Integration | keyReadiness', function (hooks) {
  setupRenderingTest(hooks);

  let service: CapabilitiesService;

  hooks.beforeEach(function () {
    realmUnderTest.sent = [];
    realmUnderTest.readiness = new Map();
    realmUnderTest.denied = new Set();
    this.owner.register('service:network', FakeNetwork);
    this.owner.register('service:realm', FakeRealm);
    this.owner.register('service:message-service', FakeMessageService);
    service = this.owner.lookup(
      'service:capabilities',
    ) as unknown as CapabilitiesService;
  });

  test('readiness goes out on the same request as canInvoke, as a pair that asks for it', async function (assert) {
    realmUnderTest.readiness.set('listPRs', 'needs-connect');
    let inbox = cardAt(`${REALM}inbox`);
    assert.strictEqual(
      service.keyReadiness('listPRs', inbox),
      undefined,
      'nothing is known before the realm has been asked',
    );
    service.canInvoke('listPRs', inbox);
    await settled();
    assert.strictEqual(realmUnderTest.sent.length, 1, 'one request');
    assert.deepEqual(
      realmUnderTest.sent[0].checks,
      [
        { target: `${REALM}inbox`, operation: 'listPRs', readiness: true },
        { target: `${REALM}inbox`, operation: 'listPRs' },
      ],
      'readiness is its own pair beside the canInvoke one',
    );
    assert.strictEqual(service.keyReadiness('listPRs', inbox), 'needs-connect');
    assert.true(
      service.canInvoke('listPRs', inbox),
      'and canInvoke reads its own answer, unchanged',
    );
  });

  test('a pair the realm gives no readiness for reads as not known, and is not asked again until stale', async function (assert) {
    realmUnderTest.denied.add('listPRs');
    let inbox = cardAt(`${REALM}inbox`);
    service.keyReadiness('listPRs', inbox);
    await settled();
    assert.strictEqual(
      service.keyReadiness('listPRs', inbox),
      undefined,
      'a caller who may not invoke it has nothing to be ready for',
    );
    await settled();
    assert.strictEqual(
      realmUnderTest.sent.length,
      1,
      'reading it again does not ask again',
    );
  });

  test('nothing is asked or answered inside a prerender', async function (assert) {
    (globalThis as any).__boxelPrerenderApp = true;
    try {
      assert.strictEqual(
        service.keyReadiness('listPRs', cardAt(`${REALM}inbox`)),
        undefined,
        'prerendered HTML is served to everyone, so it never says Connect',
      );
      await settled();
      assert.deepEqual(realmUnderTest.sent, [], 'so it asks nothing');
    } finally {
      delete (globalThis as any).__boxelPrerenderApp;
    }
  });

  test('coming back from the secure window flips needs-approval to ready without a reload', async function (assert) {
    realmUnderTest.readiness.set('listPRs', 'needs-approval');
    let secureWindow = this.owner.lookup(
      'service:secure-window',
    ) as unknown as SecureWindowService;
    window.open = (() => ({})) as unknown as typeof window.open;
    let { keyReadiness } = service;
    let inbox = cardAt(`${REALM}inbox`);
    await render(
      <template>
        <span data-test-readiness>{{keyReadiness 'listPRs' inbox}}</span>
      </template>,
    );
    assert.dom('[data-test-readiness]').hasText('needs-approval');

    window.dispatchEvent(new Event('focus'));
    await settled();
    assert.strictEqual(
      realmUnderTest.sent.length,
      1,
      'focus alone asks nothing while no secure window has opened',
    );

    assert.strictEqual(
      secureWindow.open('https://secure.example.test/secure'),
      'opened',
    );
    realmUnderTest.readiness.set('listPRs', 'ready');
    window.dispatchEvent(new Event('focus'));
    await settled();
    assert.strictEqual(realmUnderTest.sent.length, 2, 'it was asked again');
    assert.deepEqual(
      realmUnderTest.sent[1].checks,
      [{ target: `${REALM}inbox`, operation: 'listPRs', readiness: true }],
      'only the readiness pairs',
    );
    assert
      .dom('[data-test-readiness]')
      .hasText('ready', 'and the template re-reads the new answer');
  });

  test('a focus long after the secure window opened is not a return from it', async function (assert) {
    realmUnderTest.readiness.set('listPRs', 'needs-approval');
    let secureWindow = this.owner.lookup(
      'service:secure-window',
    ) as unknown as SecureWindowService;
    window.open = (() => ({})) as unknown as typeof window.open;
    service.keyReadiness('listPRs', cardAt(`${REALM}inbox`));
    await settled();
    let realNow = Date.now;
    let now = realNow();
    Date.now = () => now;
    try {
      secureWindow.open('https://secure.example.test/secure');
      now += 11 * 60_000;
      window.dispatchEvent(new Event('focus'));
      await settled();
      assert.strictEqual(
        realmUnderTest.sent.length,
        1,
        'switching back to the app later asks nothing',
      );
    } finally {
      Date.now = realNow;
    }
  });
});
