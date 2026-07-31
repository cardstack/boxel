import { waitFor, waitUntil } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm, rri } from '@cardstack/runtime-common';

import config from '@cardstack/host/config/environment';

import type EnvironmentService from '@cardstack/host/services/environment-service';
import type MonacoService from '@cardstack/host/services/monaco-service';

import {
  setupAcceptanceTestRealm,
  setupAuthEndpoints,
  setupLocalIndexing,
  setupOnSave,
  setupRealmCacheTeardown,
  setupUserSubscription,
  SYSTEM_CARD_FIXTURE_CONTENTS,
  testRealmURL,
  visitOperatorMode,
  withCachedRealmSetup,
  realmConfigCardJSON,
} from '../../helpers';
import { CardsGrid, setupBaseRealm } from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setPlaygroundSelections } from '../../helpers/playground';
import { setupApplicationTest } from '../../helpers/setup';

const livePreviewSource = `
import { CardDef, Component } from '@cardstack/base/card-api';

export class LivePreview extends CardDef {
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <article data-test-live-preview>
        <strong>VERSION ONE</strong>
      </article>
    </template>
  };
}
`;

const iframeLivePreviewSource = `
const sandboxDocument = document;
${livePreviewSource.split('LivePreview').join('IframeLivePreview')}
void sandboxDocument;
`;

function typeAtEndOfMarker(marker: string, text: string) {
  let monaco = getService('monaco-service') as MonacoService;
  let editor = monaco.editor;
  let model = editor?.getModel();
  if (!editor || !model) {
    throw new Error('Monaco editor is not ready');
  }
  let offset = model.getValue().indexOf(marker);
  if (offset === -1) {
    throw new Error(`Could not find ${marker} in Monaco`);
  }
  editor.setPosition(model.getPositionAt(offset + marker.length));
  editor.trigger('sandbox-live-reload-test', 'type', { text });
}

module('Acceptance | code submode | sandbox live reload', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupOnSave(hooks);
  setupRealmCacheTeardown(hooks);
  setupBaseRealm(hooks);

  let originalIframeOrigin: string | undefined;

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [baseRealm.url, testRealmURL],
  });

  hooks.beforeEach(async function () {
    originalIframeOrigin = config.realmSandboxIframeOrigin;
    // Testem disables application autoboot, so its second browsing context
    // cannot run the child route. Point the frame at an inert origin and test
    // the host-side revision boundary here; the child protocol is exercised by
    // the staging-backed browser preview.
    config.realmSandboxIframeOrigin = 'https://127.0.0.1:1';
    mockMatrixUtils.setRealmPermissions({
      [testRealmURL]: ['read', 'write'],
    });
    await mockMatrixUtils.createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'sandbox-live-reload',
    });
    setupUserSubscription();
    setupAuthEndpoints();

    await withCachedRealmSetup(async () => {
      await setupAcceptanceTestRealm({
        mockMatrixUtils,
        contents: {
          ...SYSTEM_CARD_FIXTURE_CONTENTS,
          'index.json': new CardsGrid(),
          'realm.json': realmConfigCardJSON({ name: 'Hot Reload Test Realm' }),
          'live-preview-compartment.gts': livePreviewSource,
          'live-preview-iframe.gts': iframeLivePreviewSource,
          'live-preview-compartment-entry.json': {
            data: {
              type: 'card',
              attributes: {
                specType: 'card',
                ref: {
                  module: `${testRealmURL}live-preview-compartment`,
                  name: 'LivePreview',
                },
              },
              meta: {
                adoptsFrom: {
                  module: `${baseRealm.url}spec`,
                  name: 'Spec',
                },
              },
            },
          },
          'live-preview-iframe-entry.json': {
            data: {
              type: 'card',
              attributes: {
                specType: 'card',
                ref: {
                  module: `${testRealmURL}live-preview-iframe`,
                  name: 'IframeLivePreview',
                },
              },
              meta: {
                adoptsFrom: {
                  module: `${baseRealm.url}spec`,
                  name: 'Spec',
                },
              },
            },
          },
          'LivePreview/sample.json': {
            data: {
              attributes: {},
              meta: {
                adoptsFrom: {
                  module: `${testRealmURL}live-preview-compartment`,
                  name: 'LivePreview',
                },
              },
            },
          },
          'IframeLivePreview/sample.json': {
            data: {
              attributes: {},
              meta: {
                adoptsFrom: {
                  module: `${testRealmURL}live-preview-iframe`,
                  name: 'IframeLivePreview',
                },
              },
            },
          },
        },
      });
    });
  });

  hooks.afterEach(function () {
    config.realmSandboxIframeOrigin = originalIframeOrigin;
  });

  for (let sourceKind of ['ordinary', 'browser-runtime'] as const) {
    test(`a Monaco keystroke publishes the ${sourceKind} draft to its mounted iframe`, async function (assert) {
      let environment = getService('environment-service') as EnvironmentService;
      environment.autoSaveDelayMs = 1_000;

      let tier = sourceKind === 'ordinary' ? 'compartment' : 'iframe';

      setPlaygroundSelections({
        [`${testRealmURL}live-preview-${tier}/${tier === 'iframe' ? 'IframeLivePreview' : 'LivePreview'}`]:
          {
            cardId: rri(
              `${testRealmURL}${tier === 'iframe' ? 'IframeLivePreview' : 'LivePreview'}/sample`,
            ),
            format: 'isolated',
          },
      });

      await visitOperatorMode({
        stacks: [],
        submode: 'code',
        codePath: `${testRealmURL}live-preview-${tier}.gts`,
        codeSelection: tier === 'iframe' ? 'IframeLivePreview' : 'LivePreview',
        moduleInspector: 'preview',
        cardPreviewFormat: 'isolated',
      });

      await waitFor('[data-test-editor]');
      await waitFor('[data-card-sandbox-code-preview-loader="dedicated"]');
      let frameBoundary = document.querySelector(
        '[data-card-sandbox-code-preview-loader="dedicated"]',
      )!;
      let stableBoundary = frameBoundary.querySelector('iframe')!;
      let initialRevision = Number(
        frameBoundary.getAttribute('data-card-sandbox-draft-revision'),
      );
      assert.ok(initialRevision >= 0, 'initial draft was published');

      typeAtEndOfMarker('VERSION ONE', '!');

      await waitUntil(() => {
        let boundary = document.querySelector(
          '[data-card-sandbox-code-preview-loader="dedicated"]',
        );
        return (
          Number(boundary?.getAttribute('data-card-sandbox-draft-revision')) >
          initialRevision
        );
      });
      frameBoundary = document.querySelector(
        '[data-card-sandbox-code-preview-loader="dedicated"]',
      )!;
      assert.strictEqual(
        frameBoundary.querySelector('iframe'),
        stableBoundary,
        'the host reused the same detached iframe boundary',
      );
    });
  }
});
