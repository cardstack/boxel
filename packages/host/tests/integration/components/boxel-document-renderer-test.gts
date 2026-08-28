import { waitFor } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import {
  rri,
  type CardDocument,
  type LooseSingleCardDocument,
} from '@cardstack/runtime-common';

import BoxelDocumentRenderer from '@cardstack/host/components/boxel-document-renderer';
import { htmlComponent } from '@cardstack/host/lib/html-component';
import type SandboxRuntimeProcess from '@cardstack/host/lib/sandbox-runtime-process';

import { renderComponent } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

import type { Format } from '@cardstack/base/card-api';

module('Integration | Component | boxel-document-renderer', function (hooks) {
  setupRenderingTest(hooks);

  let restorePrerenderedComponentForURL: (() => void) | undefined;

  hooks.afterEach(function () {
    restorePrerenderedComponentForURL?.();
    restorePrerenderedComponentForURL = undefined;
  });

  test('RP-2.10, RP-6.3: a fitted document uses indexed HTML with Base geometry and creates no iframe', async function (assert) {
    let execution = getService('boxel-execution');
    let requested: Array<{ cardId: string; format: Format | undefined }> = [];
    let original = execution.prerenderedComponentForURL.bind(execution);
    execution.prerenderedComponentForURL = async (cardId, format) => {
      requested.push({ cardId, format });
      return htmlComponent(
        '<article data-test-fitted-prerender>Indexed fitted card</article>',
      );
    };
    restorePrerenderedComponentForURL = () => {
      execution.prerenderedComponentForURL = original;
    };
    let cardURL = 'https://realm.example/Example/fitted-proof';

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <BoxelDocumentRenderer @cardURL={{cardURL}} @format='fitted' />
        </template>
      },
    );

    await waitFor('[data-boxel-execution="prerender"]');
    assert.deepEqual(requested, [{ cardId: cardURL, format: 'fitted' }]);
    assert.dom('[data-test-fitted-prerender]').hasText('Indexed fitted card');
    assert.dom('iframe').doesNotExist('fitted composition starts no child');
    let boundary = document.querySelector<HTMLElement>(
      '[data-boxel-execution="prerender"]',
    );
    let style = boundary ? getComputedStyle(boundary) : undefined;
    assert.strictEqual(style?.containerName, 'fitted-card');
    assert.strictEqual(style?.containerType, 'size');
    assert.strictEqual(style?.overflow, 'hidden');
    assert.strictEqual(style?.minHeight, '40px');
    assert.strictEqual(style?.maxHeight, '600px');
  });

  test('RP-20.6: a document-first Sandbox write is constrained and persisted without materializing a Host card instance', async function (assert) {
    let cardId = rri('https://realm.example/Journal/document-first-write');
    let initialDocument: LooseSingleCardDocument = {
      data: {
        id: cardId,
        type: 'card',
        attributes: {
          headline: 'First Light',
          entries: ['Entry 1'],
        },
        meta: {
          adoptsFrom: {
            module: rri('https://realm.example/journal'),
            name: 'Journal',
          },
        },
      },
    };
    let received:
      | ((document: LooseSingleCardDocument) => void | Promise<void>)
      | undefined;
    let stubProcess = {
      setChildWriteReceiver: (
        receiver: (document: LooseSingleCardDocument) => void | Promise<void>,
      ) => {
        received = receiver;
        return () => {
          received = undefined;
        };
      },
    } as unknown as SandboxRuntimeProcess;
    let cardService = getService('card-service');
    let originalFetchJSON = cardService.fetchJSON.bind(cardService);
    let writes: Array<{ url: string; init: RequestInit }> = [];
    cardService.fetchJSON = async (url, init) => {
      writes.push({ url: String(url), init: init ?? {} });
      return {
        ...structuredClone(initialDocument),
        data: {
          ...structuredClone(initialDocument.data),
          attributes: {
            headline: 'Written From The Child',
            entries: ['Entry 1'],
          },
        },
      } as CardDocument;
    };

    let execution = getService('boxel-execution');
    let disconnect = execution.connectSandboxDocumentSync(
      initialDocument,
      stubProcess,
    );
    try {
      assert.ok(received, 'the iframe receives one bounded write channel');
      let proposal = structuredClone(initialDocument);
      proposal.data!.attributes = {
        headline: 'Written From The Child',
        entries: ['Entry 1'],
      };
      await received!(proposal);

      assert.strictEqual(writes.length, 1, 'one proposal makes one PATCH');
      assert.strictEqual(writes[0]!.url, cardId);
      assert.strictEqual(writes[0]!.init.method, 'PATCH');
      assert.strictEqual(
        new Headers(writes[0]!.init.headers).get('Content-Type'),
        'application/vnd.card+json',
        'the ordinary authenticated card endpoint receives Card JSON',
      );
      assert.strictEqual(
        JSON.parse(String(writes[0]!.init.body)).data.attributes.headline,
        'Written From The Child',
        'the proposal carries the child editor value',
      );

      let foreign = structuredClone(proposal);
      foreign.data!.id = 'https://realm.example/Journal/not-authorized';
      await assert.rejects(
        Promise.resolve(received!(foreign)),
        /does not match/,
        'the same channel cannot write any other card',
      );
      assert.strictEqual(
        writes.length,
        1,
        'identity rejection happens before persistence',
      );
    } finally {
      cardService.fetchJSON = originalFetchJSON;
      disconnect();
    }
    assert.notOk(received, 'teardown removes the write capability');
  });
});
