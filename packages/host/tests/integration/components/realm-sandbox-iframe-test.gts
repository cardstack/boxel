import { settled, waitUntil } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

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
    class AuthorityState {
      @tracked canWrite = true;
    }
    let authority = new AuthorityState();
    let receivedTypePresentation:
      | {
          displayName: string;
          headerColor: string | null;
          prefersWideFormat: boolean;
        }
      | undefined;
    let receivedCardUpdates: LooseSingleCardDocument[] = [];
    let finishPersistence: (() => void) | undefined;
    let persistence = new Promise<void>((resolve) => {
      finishPersistence = resolve;
    });
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
            @canWrite={{authority.canWrite}}
            @onCardDocumentUpdate={{this.onCardDocumentUpdate}}
          />
        </template>

        onCardDocumentUpdate = async (document: LooseSingleCardDocument) => {
          receivedCardUpdates.push(document);
          await persistence;
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

    let permissionUpdates: unknown[] = [];
    transferredPort?.addEventListener('message', (event) => {
      if (event.data.type === 'permissions') {
        permissionUpdates.push(event.data);
      }
    });
    transferredPort?.start();
    authority.canWrite = false;
    await settled();
    await waitUntil(() => permissionUpdates.length === 1);
    assert.strictEqual(
      connectCount,
      1,
      'permission settlement does not replace or close the capability port',
    );
    assert.deepEqual(permissionUpdates, [
      {
        protocol: realmIframeSandboxProtocol,
        type: 'permissions',
        canWrite: false,
      },
    ]);
    authority.canWrite = true;
    await settled();
    await waitUntil(() => permissionUpdates.length === 2);
    assert.deepEqual(
      permissionUpdates[1],
      {
        protocol: realmIframeSandboxProtocol,
        type: 'permissions',
        canWrite: true,
      },
      'write authority can settle without remounting the renderer',
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
    let updateResults: unknown[] = [];
    transferredPort?.addEventListener('message', (event) => {
      if (event.data.type === 'card-update-result') {
        updateResults.push(event.data);
      }
    });
    transferredPort?.postMessage({
      protocol: realmIframeSandboxProtocol,
      type: 'card-update',
      revision: 1,
      document: updateDocument,
    });
    let secondUpdateDocument = structuredClone(updateDocument);
    secondUpdateDocument.data.attributes = {
      title: 'Second iframe update',
    };
    transferredPort?.postMessage({
      protocol: realmIframeSandboxProtocol,
      type: 'card-update',
      revision: 2,
      document: secondUpdateDocument,
    });
    await waitUntil(
      () =>
        document
          .querySelector('[data-card-sandbox-frame-status]')
          ?.getAttribute('data-card-sandbox-received-update-revision') === '2',
    );
    assert
      .dom('[data-card-sandbox-frame-status]')
      .hasAttribute(
        'data-card-sandbox-received-update-revision',
        '2',
        'the Host records the latest receipt before persistence settles',
      );
    assert
      .dom('[data-card-sandbox-frame-status]')
      .hasAttribute(
        'data-card-sandbox-persisted-update-revision',
        '-1',
        'receipt is not mislabeled as persistence',
      );
    assert.strictEqual(
      updateResults.length,
      0,
      'the child receives no acknowledgements before persistence settles',
    );
    finishPersistence?.();
    await waitUntil(() => updateResults.length === 2);
    assert.deepEqual(
      receivedCardUpdates,
      [updateDocument, secondUpdateDocument],
      'the Host persists rapid data-only updates in emitted order',
    );
    assert.deepEqual(updateResults, [
      {
        protocol: realmIframeSandboxProtocol,
        type: 'card-update-result',
        revision: 1,
      },
      {
        protocol: realmIframeSandboxProtocol,
        type: 'card-update-result',
        revision: 2,
      },
    ]);
    assert
      .dom('[data-card-sandbox-frame-status]')
      .hasAttribute(
        'data-card-sandbox-persisted-update-revision',
        '2',
        'the latest successful update is explicitly marked persisted',
      );
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
    assert
      .dom('[data-card-sandbox-frame-status]')
      .hasAttribute(
        'data-card-sandbox-persisted-update-revision',
        '-1',
        'a rejected write is never marked persisted',
      );
  });
});
