import { settled } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { module, test } from 'qunit';

import type {
  LooseSingleCardDocument,
  RealmResourceIdentifier,
} from '@cardstack/runtime-common';

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
    let receivedCardUpdate: LooseSingleCardDocument | undefined;
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
        <template>
          <RealmSandboxIframe
            @sandbox={{sandbox}}
            @canWrite={{true}}
            @onCardDocumentUpdate={{this.onCardDocumentUpdate}}
          />
        </template>

        onCardDocumentUpdate = async (document: LooseSingleCardDocument) => {
          receivedCardUpdate = document;
        };
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
        message: { protocol?: string; type?: string; canWrite?: boolean },
        targetOrigin: string,
        transfer: Transferable[],
      ) => {
        assert.strictEqual(targetOrigin, sandbox.targetOrigin);
        assert.strictEqual(message.protocol, realmIframeSandboxProtocol);
        assert.strictEqual(message.type, 'connect');
        assert.true(message.canWrite, 'write permission crosses as a boolean');
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

    let updateDocument: LooseSingleCardDocument = {
      data: {
        type: 'card' as const,
        id: sandbox.cardID,
        attributes: { title: 'Updated in the iframe' },
        meta: {
          adoptsFrom: {
            module: sandbox.rootModuleURL as RealmResourceIdentifier,
            name: 'BrowserCanvas',
          },
        },
      },
    };
    let updateResult: unknown;
    transferredPort?.addEventListener('message', (event) => {
      if (event.data.type === 'card-update-result') {
        updateResult = event.data;
      }
    });
    transferredPort?.start();
    transferredPort?.postMessage({
      protocol: realmIframeSandboxProtocol,
      type: 'card-update',
      revision: 1,
      document: updateDocument,
    });
    await settled();
    assert.deepEqual(
      receivedCardUpdate,
      updateDocument,
      'the Host receives a data-only update for a writable card',
    );
    assert.deepEqual(updateResult, {
      protocol: realmIframeSandboxProtocol,
      type: 'card-update-result',
      revision: 1,
    });
  });

  test('preserves read-only realm authority across the iframe boundary', async function (assert) {
    let updateAttempted = false;
    let sandbox = {
      cardID: 'https://realm.example/ReadOnlyCard/sample',
      document: {
        data: {
          type: 'card',
          id: 'https://realm.example/ReadOnlyCard/sample',
          attributes: { title: 'Original' },
        },
      },
      format: 'edit',
      principal: 'https://realm.example/',
      rootModuleURL: 'https://realm.example/read-only-card.gts',
      targetOrigin: 'https://iframe.example',
      url: 'about:blank',
      accessibleTitle: 'Read-only sandboxed card',
      presentation: { format: 'edit', displayContainer: true },
    } as unknown as RealmIframeSandboxRender;

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <RealmSandboxIframe
            @sandbox={{sandbox}}
            @canWrite={{false}}
            @onCardDocumentUpdate={{this.onCardDocumentUpdate}}
          />
        </template>

        onCardDocumentUpdate = async () => {
          updateAttempted = true;
        };
      },
    );

    let iframe = document.querySelector(
      '.realm-sandbox-iframe iframe',
    ) as HTMLIFrameElement;
    let bootstrapID = new URL(iframe.src).searchParams.get('bootstrapID');
    let transferredPort: MessagePort | undefined;
    Object.defineProperty(iframe.contentWindow, 'postMessage', {
      configurable: true,
      value: (
        message: { protocol?: string; type?: string; canWrite?: boolean },
        _targetOrigin: string,
        transfer: Transferable[],
      ) => {
        assert.false(
          message.canWrite,
          'read-only authority crosses as an explicit boolean',
        );
        transferredPort = transfer[0] as MessagePort;
      },
    });

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

    let updateResult: unknown;
    transferredPort?.addEventListener('message', (event) => {
      if (event.data.type === 'card-update-result') {
        updateResult = event.data;
      }
    });
    transferredPort?.start();
    transferredPort?.postMessage({
      protocol: realmIframeSandboxProtocol,
      type: 'card-update',
      revision: 1,
      document: {
        data: {
          type: 'card',
          id: sandbox.cardID,
          attributes: { title: 'Forbidden update' },
          meta: {
            adoptsFrom: {
              module: sandbox.rootModuleURL,
              name: 'ReadOnlyCard',
            },
          },
        },
      },
    });
    await settled();

    assert.false(
      updateAttempted,
      'the Host persistence callback is not called',
    );
    assert.deepEqual(updateResult, {
      protocol: realmIframeSandboxProtocol,
      type: 'card-update-result',
      revision: 1,
      error: 'This realm is read-only',
    });
    assert
      .dom('[data-card-sandbox-frame-status]')
      .hasAttribute('data-card-sandbox-can-write', 'false');
    assert
      .dom('[data-card-sandbox-frame-status]')
      .hasAttribute(
        'data-card-sandbox-update-error',
        'This realm is read-only',
      );
  });
});
