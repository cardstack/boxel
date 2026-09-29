import Service from '@ember/service';
import { render, settled, waitFor, waitUntil } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import {
  baseRealm,
  CAPABILITY_CHECK_CAP,
  type CapabilityCheck,
} from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common/loader';

import OperatorMode from '@cardstack/host/components/operator-mode/container';
import type CapabilitiesService from '@cardstack/host/services/capabilities';

import {
  SYSTEM_CARD_FIXTURE_CONTENTS,
  realmConfigCardJSON,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupOperatorModeStateCleanup,
} from '../helpers';
import { setupBaseRealm, CardDef } from '../helpers/base-realm';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { renderComponent } from '../helpers/render-component';
import { setupRenderingTest } from '../helpers/setup';

import type { CardDef as CardInstance } from '@cardstack/base/card-api';
import type { RealmEventContent } from '@cardstack/base/matrix-event';

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
  // What the fake message service was asked to deliver, per realm.
  listeners: new Map<string, ((event: RealmEventContent) => void)[]>(),
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

class FakeMessageService extends Service {
  subscribe(realmURL: string, cb: (event: RealmEventContent) => void) {
    let listeners = realmUnderTest.listeners.get(realmURL) ?? [];
    listeners.push(cb);
    realmUnderTest.listeners.set(realmURL, listeners);
    return () => {
      realmUnderTest.listeners.set(
        realmURL,
        (realmUnderTest.listeners.get(realmURL) ?? []).filter((l) => l !== cb),
      );
    };
  }
}

// An incremental index pass of `realmURL` that changed `invalidations`.
function indexed(realmURL: string, invalidations: string[]) {
  for (let listener of realmUnderTest.listeners.get(realmURL) ?? []) {
    listener({
      eventName: 'index',
      indexType: 'incremental',
      invalidations,
      realmURL,
    } as unknown as RealmEventContent);
  }
}

function cardAt(id: string): CardInstance {
  return { id } as unknown as CardInstance;
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
    realmUnderTest.listeners = new Map();
    this.owner.register('service:network', FakeNetwork);
    this.owner.register('service:realm', FakeRealm);
    this.owner.register('service:message-service', FakeMessageService);
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
      service.canInvoke('read', {} as CardInstance),
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

  test('a pair read while another request is in flight goes out as soon as that request is under way', async function (assert) {
    realmUnderTest.allow.add(`read ${REALM}a`);
    realmUnderTest.allow.add(`read ${REALM}b`);
    realmUnderTest.hold();
    service.canInvoke('read', cardAt(`${REALM}a`));
    await waitUntil(() => realmUnderTest.sent.length === 1);
    service.canInvoke('read', cardAt(`${REALM}b`));
    await waitUntil(() => realmUnderTest.sent.length === 2);
    assert.deepEqual(
      realmUnderTest.sent.map((request) =>
        request.checks.map((check) => check.target),
      ),
      [[`${REALM}a`], [`${REALM}b`]],
      'the second pair did not wait on a request that was never going to carry it',
    );
    realmUnderTest.release!();
    await settled();
    assert.true(service.canInvoke('read', cardAt(`${REALM}a`)));
    assert.true(service.canInvoke('read', cardAt(`${REALM}b`)));
  });

  test('a reply to a session that has ended is dropped', async function (assert) {
    realmUnderTest.allow.add(`read ${REALM}a`);
    realmUnderTest.hold();
    service.canInvoke('read', cardAt(`${REALM}a`));
    await waitUntil(() => realmUnderTest.sent.length === 1);
    service.resetState();
    // Whoever signs in next is not granted what the last session was.
    realmUnderTest.allow.delete(`read ${REALM}a`);
    realmUnderTest.release!();
    await settled();
    assert.strictEqual(
      service.canInvoke('read', cardAt(`${REALM}a`)),
      undefined,
      'the earlier session’s answer did not land in this one',
    );
    await settled();
    assert.strictEqual(realmUnderTest.sent.length, 2, 'this session asked');
    assert.false(
      service.canInvoke('read', cardAt(`${REALM}a`)),
      'and holds its own answer',
    );
  });

  test('an index event naming a card asks again about it, and about nothing else', async function (assert) {
    realmUnderTest.allow.add(`read ${REALM}a`);
    realmUnderTest.allow.add(`read ${REALM}b`);
    service.canInvoke('read', cardAt(`${REALM}a`));
    service.canInvoke('read', cardAt(`${REALM}b`));
    await settled();
    assert.true(service.canInvoke('read', cardAt(`${REALM}a`)));
    realmUnderTest.allow.delete(`read ${REALM}a`);
    realmUnderTest.hold();
    indexed(REALM, [`${REALM}a`]);
    await waitUntil(() => realmUnderTest.sent.length === 2);
    assert.deepEqual(
      realmUnderTest.sent[1].checks.map((check) => check.target),
      [`${REALM}a`],
      'only the card the pass changed is asked about again',
    );
    assert.true(
      service.canInvoke('read', cardAt(`${REALM}a`)),
      'the held answer is served until the new one lands, so nothing flickers',
    );
    realmUnderTest.release!();
    await settled();
    assert.false(
      service.canInvoke('read', cardAt(`${REALM}a`)),
      'and the new one replaces it',
    );
    assert.true(service.canInvoke('read', cardAt(`${REALM}b`)));
  });

  test('an index event that moves the realm’s config asks again about every pair in the realm', async function (assert) {
    service.canInvoke('read', cardAt(`${REALM}a`));
    service.canInvoke('delete', cardAt(`${REALM}b`));
    service.canInvoke('read', cardAt(`${OTHER}c`));
    await settled();
    indexed(REALM, [`${REALM}realm`]);
    await settled();
    assert.deepEqual(
      realmUnderTest.sent
        .slice(2)
        .map((request) => request.checks.map((check) => check.target)),
      [[`${REALM}a`, `${REALM}b`]],
      'the config can change the policy every answer in the realm rests on, and another realm’s answers are untouched',
    );
  });

  test('an answer past its age is asked again by the next read of it', async function (assert) {
    let realNow = Date.now;
    let now = realNow();
    Date.now = () => now;
    try {
      realmUnderTest.allow.add(`read ${REALM}a`);
      service.canInvoke('read', cardAt(`${REALM}a`));
      await settled();
      assert.true(service.canInvoke('read', cardAt(`${REALM}a`)));
      await settled();
      assert.strictEqual(
        realmUnderTest.sent.length,
        1,
        'a fresh answer is served without asking',
      );
      // Nothing this session can observe changed: a policy card in a realm it
      // cannot read, or its own permissions.
      realmUnderTest.allow.delete(`read ${REALM}a`);
      now += 5_000;
      assert.true(
        service.canInvoke('read', cardAt(`${REALM}a`)),
        'a stale answer is still served while it is asked again',
      );
      await settled();
      assert.strictEqual(realmUnderTest.sent.length, 2, 'and it was asked');
      assert.false(service.canInvoke('read', cardAt(`${REALM}a`)));
    } finally {
      Date.now = realNow;
    }
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

// A type target needs a class the loader produced, since that is what a card
// author holds and what `identifyCard` can name. So this module loads the base
// realm, and fakes only the capability request on the network it loads over.
module('Integration | canInvoke | a type target', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);

  test('a class asks whether a card of that type may be created', async function (assert) {
    let network = getService('network');
    let sent: Sent[] = [];
    let real = network.authedFetch;
    Object.defineProperty(network, 'authedFetch', {
      configurable: true,
      value: async (url: string, init?: RequestInit) => {
        if (!url.endsWith('_capabilities')) {
          return await real(url, init);
        }
        let { checks } = JSON.parse(String(init!.body)) as {
          checks: CapabilityCheck[];
        };
        sent.push({ url, checks });
        return new Response(
          JSON.stringify({
            checks: checks.map((check) => ({ ...check, allowed: true })),
          }),
          { headers: { 'content-type': 'application/json' } },
        );
      },
    });
    try {
      let service = getService(
        'capabilities',
      ) as unknown as CapabilitiesService;
      assert.strictEqual(
        service.canInvoke('create', CardDef, { realm: REALM }),
        undefined,
      );
      await settled();
      assert.strictEqual(sent.length, 1, 'one request');
      assert.strictEqual(
        sent[0].url,
        `${REALM}_capabilities`,
        'to the realm the card would be created in',
      );
      let [check] = sent[0].checks;
      assert.strictEqual(check.operation, 'create');
      assert.strictEqual(
        typeof check.target === 'object' ? check.target.name : undefined,
        'CardDef',
        'naming the type by its code ref rather than any card',
      );
      assert.true(service.canInvoke('create', CardDef, { realm: REALM }));
    } finally {
      delete (network as unknown as { authedFetch?: unknown }).authedFetch;
    }
  });
});

// The whole way a card reaches an answer: the operator-mode context providers,
// the service, the realm's own `_capabilities` route. The in-browser realm a
// host test runs dispatches the host's requests as its own, so no ACL judges
// them and permission is not what this pins: the realm-server suite does. What
// it pins is that the template reads the realm's answer. So the card asks one
// question the realm admits and one it refuses whoever asks — an operation its
// type does not carry — and shows each as one of three states, so a `false`
// cannot be mistaken for an answer that never arrived.
module(
  'Integration | canInvoke | a card in the operator-mode stack',
  function (hooks) {
    const REALM_URL = 'http://test-realm/test-gates/';
    let loader: Loader;

    setupRenderingTest(hooks);
    setupOperatorModeStateCleanup(hooks);
    hooks.beforeEach(function () {
      loader = getService('loader-service').loader;
    });
    setupLocalIndexing(hooks);

    let mockMatrixUtils = setupMockMatrix(hooks, {
      loggedInAs: '@testuser:localhost',
      activeRealms: [baseRealm.url, REALM_URL],
      autostart: true,
    });

    hooks.beforeEach(async function () {
      let cardApi: typeof import('@cardstack/base/card-api') =
        await loader.import('@cardstack/base/card-api');
      let { CardDef: Base, Component } = cardApi;

      class Gate extends Base {
        static displayName = 'Gate';
        static isolated = class Isolated extends Component<typeof this> {
          answer(operation: string) {
            let answer = this.args.context?.canInvoke?.(
              operation,
              this.args.model as InstanceType<typeof Base>,
            );
            return answer === undefined ? 'unknown' : answer ? 'yes' : 'no';
          }
          get read() {
            return this.answer('read');
          }
          get undeclared() {
            return this.answer('noSuchOperation');
          }
          <template>
            <span data-test-gate-read={{this.read}}>{{this.read}}</span>
            <span data-test-gate-undeclared={{this.undeclared}}>
              {{this.undeclared}}
            </span>
          </template>
        };
      }

      await setupIntegrationTestRealm({
        mockMatrixUtils,
        realmURL: REALM_URL,
        contents: {
          ...SYSTEM_CARD_FIXTURE_CONTENTS,
          'gate.gts': { Gate },
          'Gate/one.json': {
            data: {
              type: 'card',
              meta: { adoptsFrom: { module: '../gate', name: 'Gate' } },
            },
          },
          'realm.json': realmConfigCardJSON({ name: 'Gates' }),
        },
        startMatrix: false,
      });
      await mockMatrixUtils.start();
    });

    test('a card’s template reads the realm’s answer off its context', async function (assert) {
      getService('operator-mode-state-service').restore({
        stacks: [
          [{ type: 'card', id: `${REALM_URL}Gate/one`, format: 'isolated' }],
        ],
      });
      let noop = () => {};
      await renderComponent(
        class TestDriver extends GlimmerComponent {
          <template><OperatorMode @onClose={{noop}} /></template>
        },
      );
      await waitFor('[data-test-gate-read="yes"]');
      assert
        .dom('[data-test-gate-read]')
        .hasText('yes', 'the realm admits a read of the card');
      await waitFor('[data-test-gate-undeclared="no"]');
      assert
        .dom('[data-test-gate-undeclared]')
        .hasText(
          'no',
          'and refuses an operation its type does not carry, so the answer is the realm’s',
        );
    });
  },
);
