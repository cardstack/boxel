import Service from '@ember/service';
import { render, settled, waitUntil } from '@ember/test-helpers';

import { module, test } from 'qunit';

import {
  CAPABILITY_CHECK_CAP,
  type CapabilityCheck,
} from '@cardstack/runtime-common';

import type CapabilitiesService from '@cardstack/host/services/capabilities';

import { setupRenderingTest } from '../helpers/setup';

import type { CardDef } from '@cardstack/base/card-api';

// `@context.canInvoke` reads synchronously and answers from what the session
// already knows, so what a test has to pin is the shape of the traffic behind
// it: how many requests one render pass makes, what each one carries, and what
// a template reads before and after an answer lands.

const REALM = 'http://test-realm/test/';
const OTHER = 'http://test-realm/other/';

interface Sent {
  url: string;
  checks: CapabilityCheck[];
}

// The realm as this test plays it: it records what it was asked, answers
// `true` only for the pairs `allow` names, and can be made to hold a request
// open or to fail.
const realmUnderTest = {
  sent: [] as Sent[],
  allow: new Set<string>(),
  holding: undefined as Promise<void> | undefined,
  release: undefined as (() => void) | undefined,
  failing: false,
  hold() {
    this.holding = new Promise<void>((resolve) => {
      this.release = () => {
        this.holding = undefined;
        this.release = undefined;
        resolve();
      };
    });
  },
};

class FakeNetwork extends Service {
  authedFetch = async (url: string, init: { body: string }) => {
    let { checks } = JSON.parse(init.body) as { checks: CapabilityCheck[] };
    realmUnderTest.sent.push({ url, checks });
    if (realmUnderTest.holding) {
      await realmUnderTest.holding;
    }
    if (realmUnderTest.failing) {
      return { ok: false } as unknown as Response;
    }
    return {
      ok: true,
      json: async () => ({
        checks: checks.map((check) => ({
          ...check,
          allowed: realmUnderTest.allow.has(
            `${check.operation} ${String(check.target)}`,
          ),
        })),
      }),
    } as unknown as Response;
  };
}

class FakeRealm extends Service {
  realmOf = (id: string) =>
    [REALM, OTHER].find((realm) => id.startsWith(realm));
}

function cardAt(id: string): CardDef {
  return { id } as CardDef;
}

// The two services the capability check reaches the realm through are faked,
// so what a test observes is exactly the requests the check would send.
module('Integration | canInvoke', function (hooks) {
  setupRenderingTest(hooks);

  let service: CapabilitiesService;

  hooks.beforeEach(function () {
    realmUnderTest.sent = [];
    realmUnderTest.allow = new Set();
    realmUnderTest.holding = undefined;
    realmUnderTest.release = undefined;
    realmUnderTest.failing = false;
    this.owner.register('service:network', FakeNetwork);
    this.owner.register('service:realm', FakeRealm);
    service = this.owner.lookup(
      'service:capabilities',
    ) as unknown as CapabilitiesService;
  });

  test('the reads one render pass makes go out as one request per realm', async function (assert) {
    // Thirty cards, three gated controls each — the shape the batch endpoint
    // exists for. Ninety separate requests would cost more than rendering all
    // ninety controls and asking nothing.
    let cards = Array.from(
      { length: 30 },
      (_, index) => `${REALM}classrooms/room-${index}`,
    );
    for (let id of cards) {
      for (let operation of ['read', 'rename', 'delete']) {
        assert.strictEqual(
          service.canInvoke(operation, cardAt(id)),
          undefined,
          'nothing is known before the realm has been asked',
        );
      }
    }
    await settled();
    assert.strictEqual(realmUnderTest.sent.length, 1, 'one request');
    assert.strictEqual(
      realmUnderTest.sent[0].url,
      `${REALM}_capabilities`,
      'to the realm that decides them',
    );
    assert.strictEqual(
      realmUnderTest.sent[0].checks.length,
      90,
      'carrying all ninety pairs',
    );
  });

  test('a pass spanning two realms sends one request to each', async function (assert) {
    service.canInvoke('read', cardAt(`${REALM}a`));
    service.canInvoke('read', cardAt(`${OTHER}b`));
    await settled();
    assert.deepEqual(
      realmUnderTest.sent.map((request) => request.url).sort(),
      [`${OTHER}_capabilities`, `${REALM}_capabilities`],
      'a check is addressed to the realm whose policy decides it',
    );
  });

  test('a pass that enrols more than the cap is split rather than refused', async function (assert) {
    for (let index = 0; index < CAPABILITY_CHECK_CAP + 1; index++) {
      service.canInvoke('read', cardAt(`${REALM}card-${index}`));
    }
    await settled();
    assert.deepEqual(
      realmUnderTest.sent.map((request) => request.checks.length),
      [CAPABILITY_CHECK_CAP, 1],
      'so the coalescing cannot carry a request past the cap the realm enforces',
    );
  });

  test('an answer lands on the pair that was asked about and on no other', async function (assert) {
    realmUnderTest.allow.add(`read ${REALM}granted`);
    service.canInvoke('read', cardAt(`${REALM}granted`));
    service.canInvoke('read', cardAt(`${REALM}denied`));
    service.canInvoke('rename', cardAt(`${REALM}granted`));
    await settled();
    assert.true(service.canInvoke('read', cardAt(`${REALM}granted`)));
    assert.false(service.canInvoke('read', cardAt(`${REALM}denied`)));
    assert.false(
      service.canInvoke('rename', cardAt(`${REALM}granted`)),
      'the same card under another operation is a different question',
    );
    assert.strictEqual(
      realmUnderTest.sent.length,
      1,
      'and an answered pair is not asked again',
    );
  });

  test('a pair already in flight is not asked a second time', async function (assert) {
    realmUnderTest.allow.add(`read ${REALM}a`);
    realmUnderTest.hold();
    service.canInvoke('read', cardAt(`${REALM}a`));
    // Past the microtask the flush is scheduled on, so the request is out.
    await Promise.resolve();
    await Promise.resolve();
    assert.strictEqual(
      realmUnderTest.sent.length,
      1,
      'the request is in flight',
    );
    assert.strictEqual(
      service.canInvoke('read', cardAt(`${REALM}a`)),
      undefined,
      'a re-render while it is in flight still reads "not known"',
    );
    realmUnderTest.release!();
    await settled();
    assert.strictEqual(
      realmUnderTest.sent.length,
      1,
      'and enrolled nothing further',
    );
    assert.true(service.canInvoke('read', cardAt(`${REALM}a`)));
  });

  test('a card with no id, and a realm this session does not know, ask nothing', async function (assert) {
    assert.strictEqual(
      service.canInvoke('read', {} as CardDef),
      undefined,
      'an unsaved card has no stored state for a predicate to read',
    );
    assert.strictEqual(
      service.canInvoke('read', 'http://elsewhere/card'),
      undefined,
      'and a realm this session does not know has nothing to be asked',
    );
    await settled();
    assert.deepEqual(realmUnderTest.sent, [], 'neither enrolled a pair');
  });

  test('nothing is asked or answered inside a prerender', async function (assert) {
    (globalThis as any).__boxelPrerenderApp = true;
    try {
      assert.strictEqual(
        service.canInvoke('read', cardAt(`${REALM}a`)),
        undefined,
        'the prerender app is not the session the HTML it produces is served to',
      );
      await settled();
      assert.deepEqual(realmUnderTest.sent, [], 'so it asks nothing');
    } finally {
      delete (globalThis as any).__boxelPrerenderApp;
    }
  });

  test('a request that fails leaves the pair unanswered rather than denied', async function (assert) {
    realmUnderTest.failing = true;
    service.canInvoke('read', cardAt(`${REALM}a`));
    await settled();
    assert.strictEqual(realmUnderTest.sent.length, 1, 'the realm was asked');
    realmUnderTest.failing = false;
    realmUnderTest.allow.add(`read ${REALM}a`);
    assert.strictEqual(
      service.canInvoke('read', cardAt(`${REALM}a`)),
      undefined,
      'a realm that could not answer has said nothing about whether the caller may',
    );
    await settled();
    assert.strictEqual(
      realmUnderTest.sent.length,
      2,
      'so the next read of the pair asks again',
    );
    assert.true(
      service.canInvoke('read', cardAt(`${REALM}a`)),
      'and takes the answer the realm gives this time',
    );
  });

  test('the session ending drops every answer it held', async function (assert) {
    realmUnderTest.allow.add(`read ${REALM}a`);
    service.canInvoke('read', cardAt(`${REALM}a`));
    await settled();
    assert.true(service.canInvoke('read', cardAt(`${REALM}a`)));
    service.resetState();
    assert.strictEqual(
      service.canInvoke('read', cardAt(`${REALM}a`)),
      undefined,
      'who is asking is half the question, so the next read asks again',
    );
    await settled();
    assert.strictEqual(realmUnderTest.sent.length, 2, 'and it was asked again');
  });

  test('a template reads "not known", then re-renders with the answer', async function (assert) {
    realmUnderTest.allow.add(`read ${REALM}granted`);
    realmUnderTest.hold();
    let { canInvoke } = service;
    let granted = `${REALM}granted`;
    let denied = `${REALM}denied`;
    // Not awaited: `render` settles, and settling waits for the answers this
    // test is holding back so it can read what the template shows before them.
    let rendering = render(
      <template>
        <span data-test-granted>
          {{#if (canInvoke 'read' granted)}}yes{{else}}no{{/if}}
        </span>
        <span data-test-denied>
          {{#if (canInvoke 'read' denied)}}yes{{else}}no{{/if}}
        </span>
      </template>,
    );
    await waitUntil(() => realmUnderTest.sent.length === 1);
    assert
      .dom('[data-test-granted]')
      .hasText('no', 'nothing is shown before the realm has answered');
    realmUnderTest.release!();
    await rendering;
    assert
      .dom('[data-test-granted]')
      .hasText('yes', 'the answer lands and the template re-reads it');
    assert.dom('[data-test-denied]').hasText('no');
    assert.strictEqual(
      realmUnderTest.sent.length,
      1,
      'both reads in the render went out together',
    );
  });
});
