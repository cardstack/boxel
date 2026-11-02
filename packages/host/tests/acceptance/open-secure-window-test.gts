import { on } from '@ember/modifier';
import { click, waitFor } from '@ember/test-helpers';

import { CardDef, Component, getFields } from '@cardstack/base/card-api';
import { getService } from '@universal-ember/test-support';
import window from 'ember-window-mock';
import { module, test } from 'qunit';
import { TrackedObject } from 'tracked-built-ins';

import ENV from '@cardstack/host/config/environment';
import OpenSecureWindowTool from '@cardstack/host/tools/open-secure-window';

import {
  setupAcceptanceTestRealm,
  setupLocalIndexing,
  SYSTEM_CARD_FIXTURE_CONTENTS,
  testRealmURL,
  visitOperatorMode,
} from '../helpers';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

type OpenCall = { url: string; target?: string; features?: string };

// Records each `window.open` and answers it with a stand-in window, or with
// null, as a browser that blocks the popup does.
function stubWindowOpen() {
  let calls: OpenCall[] = [];
  let popups: { opener: unknown }[] = [];
  let state = { blocked: false };
  window.open = ((url?: string | URL, target?: string, features?: string) => {
    calls.push({ url: String(url), target, features });
    if (state.blocked) {
      return null;
    }
    let popup = { opener: window as unknown };
    popups.push(popup);
    return popup;
  }) as typeof window.open;
  return { calls, popups, state };
}

const OPERATION = 'forecast';
const REASON = 'Weather Station needs your forecast service key';

module('Acceptance | open the secure window', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
  });

  let secureOrigin = new URL(ENV.secureOriginURL);

  hooks.beforeEach(async function () {
    // A card that asks for a key the way any card does: through the tool
    // its context hands it, naming itself, the operation and a reason.
    class WeatherStation extends CardDef {
      static displayName = 'Weather Station';
      static isolated = class Isolated extends Component<typeof this> {
        result = new TrackedObject({ status: '' });
        open = async (mode: 'enter-key' | 'replace-key' | 'share-key') => {
          let tool = new OpenSecureWindowTool(this.args.context!.toolContext!);
          let result = await tool.execute(
            mode !== 'share-key'
              ? {
                  mode,
                  cardId: this.args.model.id,
                  operation: OPERATION,
                  reason: REASON,
                }
              : { mode, realm: testRealmURL, reason: REASON },
          );
          this.result.status = result.status ?? '';
        };
        enterKey = () => this.open('enter-key');
        shareKey = () => this.open('share-key');
        reconnect = () => this.open('replace-key');
        <template>
          <button data-test-enter-key {{on 'click' this.enterKey}}>
            Enter key
          </button>
          <button data-test-share-key {{on 'click' this.shareKey}}>
            Share key
          </button>
          <button data-test-reconnect {{on 'click' this.reconnect}}>
            Reconnect
          </button>
          <span data-test-status>{{this.result.status}}</span>
        </template>
      };
    }

    await setupAcceptanceTestRealm({
      mockMatrixUtils,
      contents: {
        ...SYSTEM_CARD_FIXTURE_CONTENTS,
        'weather-station.gts': { WeatherStation },
        'WeatherStation/home.json': {
          data: {
            attributes: {},
            meta: {
              adoptsFrom: {
                module: '../weather-station',
                name: 'WeatherStation',
              },
            },
          },
        },
      },
    });
  });

  async function visitWeatherStation() {
    await visitOperatorMode({
      stacks: [
        [{ id: `${testRealmURL}WeatherStation/home`, format: 'isolated' }],
      ],
    });
    await waitFor('[data-test-enter-key]');
  }

  test('a card opens the window to enter a key for its operation', async function (assert) {
    let { calls, popups } = stubWindowOpen();
    await visitWeatherStation();
    await click('[data-test-enter-key]');
    await waitFor('[data-test-status]:not(:empty)');

    assert.strictEqual(calls.length, 1, 'one window opened');
    let [{ url, target, features }] = calls;
    let opened = new URL(url);
    assert.strictEqual(
      opened.origin,
      secureOrigin.origin,
      'on the secure origin',
    );
    assert.strictEqual(
      opened.pathname,
      `${secureOrigin.pathname.replace(/\/+$/, '')}/enter-key`,
      'at the enter-key page',
    );
    assert.strictEqual(opened.search, '', 'nothing in the query string');
    let fragment = new URLSearchParams(opened.hash.slice(1));
    assert.deepEqual(
      [...fragment.keys()],
      ['card', 'operation', 'reason'],
      'the fragment names the card, the operation and the reason, and nothing else',
    );
    assert.strictEqual(
      fragment.get('card'),
      `${testRealmURL}WeatherStation/home`,
    );
    assert.strictEqual(fragment.get('operation'), OPERATION);
    assert.strictEqual(fragment.get('reason'), REASON);
    assert.notOk(
      /ticket|session|token|jwt/i.test(url),
      'the address carries no ticket, session or token',
    );
    assert.strictEqual(target, '_blank');
    assert.strictEqual(features, 'popup,width=640,height=720');
    assert.strictEqual(popups[0].opener, null, 'the opener is cut');

    assert.dom('[data-test-status]').hasText('opened');
    assert.dom('[data-test-secure-window-fallback]').doesNotExist();
  });

  test('a card opens the window to share a key into a realm', async function (assert) {
    let { calls } = stubWindowOpen();
    await visitWeatherStation();
    await click('[data-test-share-key]');
    await waitFor('[data-test-status]:not(:empty)');

    assert.strictEqual(calls.length, 1);
    let opened = new URL(calls[0].url);
    assert.true(
      opened.pathname.endsWith('/share-key'),
      'at the share-key page',
    );
    assert.strictEqual(opened.search, '');
    let fragment = new URLSearchParams(opened.hash.slice(1));
    assert.deepEqual([...fragment.keys()], ['realm', 'reason']);
    assert.strictEqual(fragment.get('realm'), testRealmURL);
    assert.dom('[data-test-status]').hasText('opened');
  });

  test('a card’s Reconnect opens the window to replace the key its operation sends', async function (assert) {
    let { calls, popups } = stubWindowOpen();
    await visitWeatherStation();
    await click('[data-test-reconnect]');
    await waitFor('[data-test-status]:not(:empty)');

    assert.strictEqual(calls.length, 1, 'one window opened');
    let opened = new URL(calls[0].url);
    assert.strictEqual(opened.origin, secureOrigin.origin);
    assert.strictEqual(
      opened.pathname,
      `${secureOrigin.pathname.replace(/\/+$/, '')}/replace-key`,
      'at the replace-key page',
    );
    assert.strictEqual(opened.search, '', 'nothing in the query string');
    let fragment = new URLSearchParams(opened.hash.slice(1));
    assert.deepEqual(
      Object.fromEntries(fragment),
      {
        card: `${testRealmURL}WeatherStation/home`,
        operation: OPERATION,
        reason: REASON,
      },
      'the card and operation name the key; the card never names one itself',
    );
    assert.strictEqual(popups[0].opener, null, 'the opener is cut');
    assert.dom('[data-test-status]').hasText('opened');
  });

  test('a blocked popup shows a button that opens the window', async function (assert) {
    let stub = stubWindowOpen();
    stub.state.blocked = true;
    await visitWeatherStation();
    await click('[data-test-enter-key]');
    await waitFor('[data-test-secure-window-fallback]');

    assert.dom('[data-test-status]').hasText('blocked');
    assert
      .dom('[data-test-secure-window-fallback]')
      .doesNotContainText(
        REASON,
        'the fallback shows nothing the caller wrote, since any card can raise it',
      );
    assert
      .dom('[data-test-secure-window-fallback-host]')
      .hasText(secureOrigin.host, 'the fallback names the address to check');

    stub.state.blocked = false;
    await click('[data-test-secure-window-fallback-open]');
    assert.strictEqual(stub.calls.length, 2, 'the button opens the window');
    assert.strictEqual(
      stub.calls[1].url,
      stub.calls[0].url,
      'at the address the card asked for',
    );
    assert.strictEqual(stub.calls[1].features, 'popup,width=640,height=720');
    assert.strictEqual(stub.popups[0].opener, null, 'the opener is cut');
    assert.dom('[data-test-secure-window-fallback]').doesNotExist();
  });

  test('the fallback can be dismissed without opening the window', async function (assert) {
    let stub = stubWindowOpen();
    stub.state.blocked = true;
    await visitWeatherStation();
    await click('[data-test-enter-key]');
    await waitFor('[data-test-secure-window-fallback]');
    await click('[data-test-secure-window-fallback-cancel]');
    assert.dom('[data-test-secure-window-fallback]').doesNotExist();
    assert.strictEqual(stub.calls.length, 1, 'nothing more was opened');
  });

  test('a key for an operation on a card type names the module, export and realm', async function (assert) {
    let { calls } = stubWindowOpen();
    await visitWeatherStation();
    let { toolContext } = getService('tool-service');
    let result = await new OpenSecureWindowTool(toolContext).execute({
      mode: 'enter-key',
      module: `${testRealmURL}weather-station`,
      name: 'WeatherStation',
      realm: testRealmURL,
      operation: OPERATION,
    });
    assert.strictEqual(result.status, 'opened');
    let plainFields = Object.keys(getFields(new CardDef()));
    assert.deepEqual(
      Object.keys(getFields(result)).filter((f) => !plainFields.includes(f)),
      ['status'],
      'the result holds only whether the window opened',
    );
    let fragment = new URLSearchParams(new URL(calls[0].url).hash.slice(1));
    assert.deepEqual(Object.fromEntries(fragment), {
      module: `${testRealmURL}weather-station`,
      name: 'WeatherStation',
      realm: testRealmURL,
      operation: OPERATION,
    });
  });

  test('approving opens the window for the one operation a card is blocked on', async function (assert) {
    let { calls } = stubWindowOpen();
    await visitWeatherStation();
    let { toolContext } = getService('tool-service');
    let tool = new OpenSecureWindowTool(toolContext);
    for (let mode of ['approve', 'review-changes']) {
      await tool.execute({
        mode,
        cardId: `${testRealmURL}WeatherStation/home`,
        operation: OPERATION,
      });
    }
    assert.deepEqual(
      calls.map(({ url }) => new URL(url).pathname.split('/').pop()),
      ['approve', 'review-changes'],
    );
    for (let { url } of calls) {
      let opened = new URL(url);
      assert.strictEqual(opened.search, '');
      assert.deepEqual(
        Object.fromEntries(new URLSearchParams(opened.hash.slice(1))),
        { card: `${testRealmURL}WeatherStation/home`, operation: OPERATION },
        'the card and its one operation, never the others it has',
      );
    }
    await assert.rejects(
      tool.execute({
        mode: 'approve',
        cardId: `${testRealmURL}WeatherStation/home`,
      }),
      /an approval names the operation/,
      'an approval names the operation it is blocked on',
    );
  });

  test('what the window is opened for must name things it can read', async function (assert) {
    let { calls } = stubWindowOpen();
    await visitWeatherStation();
    let { toolContext } = getService('tool-service');
    let tool = new OpenSecureWindowTool(toolContext);
    await assert.rejects(
      tool.execute({ mode: 'delete-key', realm: testRealmURL }),
      /mode must be one of "enter-key", "replace-key", "share-key", "swap-key", "connect", "approve", "review-changes"/,
      'an unsupported mode',
    );
    await assert.rejects(
      tool.execute({ mode: 'swap-key', realm: testRealmURL }),
      /share is required/,
      'a swap with no share',
    );
    await assert.rejects(
      tool.execute({ mode: 'share-key' }),
      /realm is required/,
      'a share with no realm',
    );
    await assert.rejects(
      tool.execute({
        mode: 'enter-key',
        cardId: 'javascript:alert(1)',
        operation: OPERATION,
      }),
      /cardId must be a URL or a prefix-form id/,
      'a card that is not a URL',
    );
    await assert.rejects(
      tool.execute({ mode: 'enter-key', operation: OPERATION }),
      /an operation needs the card/,
      'an operation with nothing it is on',
    );
    await assert.rejects(
      tool.execute({
        mode: 'replace-key',
        cardId: `${testRealmURL}WeatherStation/home`,
      }),
      /replace-key is for an operation/,
      'a replace with no operation, whose key the window could not find',
    );
    await assert.rejects(
      tool.execute({ mode: 'replace-key' }),
      /replace-key is for an operation/,
      'a replace with nothing it is for',
    );
    assert.strictEqual(calls.length, 0, 'no window opened');
  });
});
