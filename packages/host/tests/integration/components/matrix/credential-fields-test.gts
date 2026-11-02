import { click, render, waitUntil } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import type { Loader } from '@cardstack/runtime-common/loader';

import CredentialFieldsFrame, {
  FRAME_WAIT_LIMITS,
} from '@cardstack/host/components/matrix/credential-fields';
import ProfileSettingsModal from '@cardstack/host/components/operator-mode/profile/profile-settings-modal';
import {
  CredentialFields,
  type CredentialForm,
} from '@cardstack/host/lib/credential-fields';

import {
  testRealmURL,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupRealmCacheTeardown,
  withCachedRealmSetup,
} from '../../../helpers';
import { setupMockMatrix } from '../../../helpers/mock-matrix';
import { setupRenderingTest } from '../../../helpers/setup';

import type { CardDef } from '@cardstack/base/card-api';

// A card's code runs in the app page, so whatever it can reach there, any
// card can. This card does what a card harvesting passwords would: it reads
// every input on the page, and every frame's document, and reports what it
// found. The password fields live in a frame on the secure origin, so it must
// find no password input and no readable frame.
const snoopingCardSource = `
  import { on } from '@ember/modifier';
  import { tracked } from '@glimmer/tracking';
  import { CardDef, Component } from '@cardstack/base/card-api';

  class Isolated extends Component<typeof Snoop> {
    @tracked found = '';

    snoop = () => {
      let inputs = [...document.querySelectorAll('input, textarea')].map(
        (input) => ({
          type: input.getAttribute('type') ?? input.tagName.toLowerCase(),
          name: input.getAttribute('name'),
          value: input.value,
        }),
      );
      let frames = [...document.querySelectorAll('iframe')].map((frame) => {
        let result = {
          form: frame.dataset.testCredentialFieldsFrame ?? null,
          src: frame.src,
          contentDocument: frame.contentDocument === null ? 'null' : 'readable',
        };
        try {
          result.inputs = frame.contentWindow.document.querySelectorAll('input').length;
        } catch (e) {
          result.error = e.name;
        }
        return result;
      });
      this.found = JSON.stringify({ inputs, frames });
    };

    <template>
      <button data-test-snoop {{on 'click' this.snoop}}>Snoop</button>
      <pre data-test-snooped>{{this.found}}</pre>
    </template>
  }

  export class Snoop extends CardDef {
    static isolated = Isolated;
  }
`;

interface Snooped {
  inputs: { type: string; name: string | null; value: string }[];
  frames: {
    form: string | null;
    src: string;
    contentDocument: string;
    inputs?: number;
    error?: string;
  }[];
}

function snooped(): Snooped {
  return JSON.parse(
    document.querySelector('[data-test-snooped]')!.textContent ?? '',
  );
}

const noop = () => {};

module('Integration | credential fields', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);

  let loader: Loader;
  hooks.beforeEach(function () {
    loader = getService('loader-service').loader;
  });

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });

  setupRealmCacheTeardown(hooks);

  hooks.beforeEach(async function () {
    await withCachedRealmSetup(async () =>
      setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: { 'snoop.gts': snoopingCardSource },
      }),
    );
  });

  async function snoopingCard() {
    let { Snoop } = (await loader.import(`${testRealmURL}snoop`)) as {
      Snoop: typeof CardDef;
    };
    let card = new Snoop();
    return (card.constructor as typeof CardDef).getComponent(card);
  }

  function assertNothingToRead(assert: Assert, form: string, found: Snooped) {
    assert.deepEqual(
      found.inputs.filter((input) => input.type === 'password'),
      [],
      'the card finds no password input on the page',
    );
    let frames = found.frames.filter((frame) => frame.form === form);
    assert.strictEqual(frames.length, 1, 'the card finds the frame');
    for (let frame of frames) {
      assert.strictEqual(
        frame.contentDocument,
        'null',
        "the frame's document is not exposed to the card",
      );
      assert.strictEqual(
        frame.error,
        'SecurityError',
        "reading the frame's document throws",
      );
      assert.strictEqual(
        frame.inputs,
        undefined,
        "the frame's inputs are out of reach",
      );
    }
  }

  function assertFrameShown(assert: Assert, form: string) {
    let frame = document.querySelector<HTMLIFrameElement>(
      `[data-test-credential-fields-frame="${form}"]`,
    );
    assert.ok(frame, `the ${form} fields' frame is rendered`);
    assert.ok(
      document.querySelector<HTMLElement>(
        `[data-test-credential-fields="${form}"]`,
      )!.style.height,
      `the ${form} fields loaded from the secure origin and reported their height`,
    );
  }

  // A filter in front of a deployed secure origin refuses a query string
  // naming a loopback origin, so a host app on this machine gets the frame
  // only when what the frame is told rides in the fragment, which is never
  // sent. The test page is on this machine.
  test('the frame is told its form and the page origin in the fragment, not the query', async function (assert) {
    let fields = new CredentialFields();
    await render(
      <template>
        <CredentialFieldsFrame @form='confirm-password' @fields={{fields}} />
      </template>,
    );

    assertFrameShown(assert, 'confirm-password');
    let src = new URL(
      document.querySelector<HTMLIFrameElement>(
        '[data-test-credential-fields-frame="confirm-password"]',
      )!.src,
    );
    assert.strictEqual(src.search, '', 'the frame URL has no query');
    let params = new URLSearchParams(src.hash.slice(1));
    assert.strictEqual(params.get('form'), 'confirm-password', 'the form');
    assert.strictEqual(
      params.get('origin'),
      window.location.origin,
      "the page's origin",
    );
  });

  test('a stylesheet the page loads after the fields were styled restyles them', async function (assert) {
    let fields = new CredentialFields();
    await render(
      <template>
        <CredentialFieldsFrame @form='change-password' @fields={{fields}} />
      </template>,
    );
    assertFrameShown(assert, 'change-password');
    let element = document.querySelector<HTMLElement>(
      '[data-test-credential-fields="change-password"]',
    )!;
    let before = parseFloat(element.style.height);

    let url = URL.createObjectURL(
      new Blob(['.credential-fields { --boxel-form-control-height: 120px; }'], {
        type: 'text/css',
      }),
    );
    let link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = url;
    document.head.append(link);
    try {
      await waitUntil(() => parseFloat(element.style.height) > before + 100, {
        timeout: 10000,
        timeoutMessage: 'the fields were not restyled',
      });
      assert.ok(true, 'the fields took the taller controls');
    } finally {
      link.remove();
      URL.revokeObjectURL(url);
    }
  });

  test('a frame that never says it is ready is loaded once more', async function (assert) {
    let limits = { ...FRAME_WAIT_LIMITS };
    FRAME_WAIT_LIMITS.readyMs = 200;
    FRAME_WAIT_LIMITS.loadMs = 500;
    // The frame refuses to start for a form it does not know, so it never
    // says it is ready.
    let form = 'no-such-form' as CredentialForm;
    let fields = new CredentialFields();
    try {
      let rendering = render(
        <template>
          <CredentialFieldsFrame @form={{form}} @fields={{fields}} />
        </template>,
      );
      let frame = await waitUntil(() =>
        document.querySelector<HTMLIFrameElement>(
          '[data-test-credential-fields-frame="no-such-form"]',
        ),
      );
      let src = frame!.src;
      let loaded: string[] = [];
      frame!.addEventListener('load', () => loaded.push(frame!.src));
      await rendering;
      await waitUntil(
        () => loaded.includes('about:blank') && loaded.at(-1) === src,
        { timeout: 10000, timeoutMessage: 'the frame was not loaded again' },
      );
      assert.deepEqual(
        loaded.slice(-2),
        ['about:blank', src],
        'the frame was emptied and loaded again',
      );
      assert.strictEqual(frame!.src, src, 'it is back at its own page');
    } finally {
      Object.assign(FRAME_WAIT_LIMITS, limits);
    }
  });

  test('a card on the page cannot read the change-password fields', async function (assert) {
    await getService('matrix-service').ready;
    let CardComponent = await snoopingCard();
    await render(
      <template>
        <ProfileSettingsModal @toggleProfileSettings={{noop}} />
        <CardComponent @format='isolated' />
      </template>,
    );
    await click('[data-test-change-password-button]');

    assertFrameShown(assert, 'change-password');
    assert
      .dom('[data-test-current-password-field]')
      .doesNotExist('the current password input is not in the app page');
    assert
      .dom('[data-test-profile-settings-save-button]')
      .isDisabled('saving waits on fields the app cannot read');

    await click('[data-test-snoop]');
    assertNothingToRead(assert, 'change-password', snooped());
  });
});
