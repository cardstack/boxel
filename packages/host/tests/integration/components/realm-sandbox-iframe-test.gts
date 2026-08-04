import { settled } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { module, test } from 'qunit';

import RealmSandboxIframe from '@cardstack/host/components/realm-sandbox-iframe';
import { realmIframeSandboxProtocol } from '@cardstack/host/lib/realm-iframe-sandbox-protocol';

import type { RealmIframeSandboxRender } from '@cardstack/host/services/realm-sandbox';

import { renderComponent } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

module('Integration | realm sandbox iframe', function (hooks) {
  setupRenderingTest(hooks);

  test('waits for readiness and applies inert child type presentation', async function (assert) {
    let receivedTypePresentation:
      | {
          displayName: string;
          headerColor: string | null;
          prefersWideFormat: boolean;
        }
      | undefined;
    let sandbox = {
      cardID: 'https://realm.example/BrowserCanvas/sample',
      document: { data: { type: 'card', attributes: {} } },
      format: 'isolated',
      principal: 'https://realm.example/',
      rootModuleURL: 'https://realm.example/browser-canvas.gts',
      targetOrigin: 'https://iframe.example',
      url: 'about:blank',
      accessibleTitle: 'Browser Canvas sandboxed card',
      presentation: { format: 'isolated', displayContainer: true },
      onTypePresentation: (presentation: typeof receivedTypePresentation) => {
        receivedTypePresentation = presentation;
      },
    } as unknown as RealmIframeSandboxRender;

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><RealmSandboxIframe @sandbox={{sandbox}} /></template>
      },
    );

    let iframe = document.querySelector(
      '.realm-sandbox-iframe iframe',
    ) as HTMLIFrameElement;
    let bootstrapID = new URL(iframe.src).searchParams.get('bootstrapID');
    assert.ok(bootstrapID, 'the frame receives a per-render bootstrap ID');
    let transferredPort: MessagePort | undefined;
    let connectCount = 0;
    Object.defineProperty(iframe.contentWindow, 'postMessage', {
      configurable: true,
      value: (
        message: { protocol?: string; type?: string },
        targetOrigin: string,
        transfer: Transferable[],
      ) => {
        assert.strictEqual(targetOrigin, sandbox.targetOrigin);
        assert.strictEqual(message.protocol, realmIframeSandboxProtocol);
        assert.strictEqual(message.type, 'connect');
        connectCount++;
        transferredPort = transfer[0] as MessagePort;
      },
    });

    iframe.dispatchEvent(new Event('load'));
    assert.strictEqual(
      connectCount,
      0,
      'load alone cannot consume the one-use port before the child listens',
    );

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: sandbox.targetOrigin,
        data: {
          protocol: realmIframeSandboxProtocol,
          type: 'listening',
          bootstrapID: 'a-sibling-frame-bootstrap-id',
        },
      }),
    );
    assert.strictEqual(
      connectCount,
      0,
      'a sibling frame on the same sandbox origin cannot consume this port',
    );

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: sandbox.targetOrigin,
        data: {
          protocol: realmIframeSandboxProtocol,
          type: 'listening',
          bootstrapID,
        },
      }),
    );
    assert.strictEqual(connectCount, 1, 'readiness transfers exactly one port');

    transferredPort?.postMessage({
      protocol: realmIframeSandboxProtocol,
      type: 'ready',
      cardID: sandbox.cardID,
      typePresentation: {
        displayName: 'Wide iframe card',
        headerColor: '#123456',
        prefersWideFormat: true,
      },
    });
    await settled();
    assert
      .dom('[data-card-sandbox-frame-status]')
      .hasAttribute('data-card-sandbox-frame-status', 'ready');
    assert.dom('[data-card-sandbox-loading]').doesNotExist();
    assert.deepEqual(
      receivedTypePresentation,
      {
        displayName: 'Wide iframe card',
        headerColor: '#123456',
        prefersWideFormat: true,
      },
      'the child publishes only inert type presentation to its Host container',
    );
  });
});
