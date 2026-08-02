import { click, settled, waitFor, waitUntil } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm, rri } from '@cardstack/runtime-common';

import config from '@cardstack/host/config/environment';

import type EnvironmentService from '@cardstack/host/services/environment-service';
import type MonacoService from '@cardstack/host/services/monaco-service';
import type RealmSandboxService from '@cardstack/host/services/realm-sandbox';

import {
  setupAcceptanceTestRealm,
  setupAuthEndpoints,
  setupLocalIndexing,
  setupOnSave,
  setupRealmCacheTeardown,
  setupUserSubscription,
  SYSTEM_CARD_FIXTURE_CONTENTS,
  setMonacoContent,
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
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <span data-test-live-preview-embedded>EMBEDDED VERSION ONE</span>
    </template>
  };
  static edit = class Edit extends Component<typeof this> {
    <template>
      <form data-test-live-preview-edit>EDIT VERSION ONE</form>
    </template>
  };
}
`;

const iframeLivePreviewSource = `
const sandboxDocument = document;
${livePreviewSource.split('LivePreview').join('IframeLivePreview')}
void sandboxDocument;
`;

const compileBrokenLivePreviewSource = livePreviewSource.replace(
  '<strong>VERSION ONE</strong>',
  '<strong>{{</strong>',
);

const renderBrokenLivePreviewSource = livePreviewSource
  .replace(
    '    <template>',
    `    get brokenPreview() {
      throw new Error('BROKEN SANDBOX PREVIEW RENDER');
    }

    <template>`,
  )
  .replace('VERSION ONE', '{{this.brokenPreview}}');

const repairedLivePreviewSource = livePreviewSource.replace(
  'VERSION ONE',
  'VERSION TWO',
);

const wideLivePreviewSource = livePreviewSource.replace(
  'export class LivePreview extends CardDef {',
  `export class LivePreview extends CardDef {
  static prefersWideFormat = true;`,
);

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
    test(`[HMR-01] a Monaco keystroke hot reloads the ${sourceKind} sandbox without replacing its renderer boundary`, async function (assert) {
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
      let realmSandbox = getService('realm-sandbox') as RealmSandboxService;
      let initialCommitCount =
        realmSandbox.metricsSnapshot().codePreviewCommitsPrepared;
      let initialAcknowledgementCount =
        realmSandbox.metricsSnapshot().codePreviewAcknowledgementsRecognized;
      let editorBecameReadOnly = false;
      let readOnlyIndicatorAppeared = false;
      let previewLoadingAppeared = false;
      let stablePreviewNode: Element | undefined;
      let editorObserver = new MutationObserver((records) => {
        editorBecameReadOnly ||= Boolean(
          document.querySelector('.monaco-container.readonly'),
        );
        readOnlyIndicatorAppeared ||= Boolean(
          document.querySelector('[data-test-realm-indicator-not-writable]'),
        );
        for (let record of records) {
          for (let node of record.addedNodes) {
            if (
              node instanceof Element &&
              (node.matches('[data-card-sandbox-loading]') ||
                node.querySelector('[data-card-sandbox-loading]'))
            ) {
              previewLoadingAppeared = true;
            }
          }
        }
      });
      editorObserver.observe(document.body, {
        attributes: true,
        attributeFilter: ['class'],
        childList: true,
        subtree: true,
      });
      if (sourceKind === 'ordinary') {
        await waitUntil(() => {
          return (
            Boolean(document.querySelector('[data-test-live-preview]')) ||
            Object.keys(realmSandbox.metricsSnapshot().compartmentErrors)
              .length > 0
          );
        });
        let compartmentErrors =
          realmSandbox.metricsSnapshot().compartmentErrors;
        if (Object.keys(compartmentErrors).length > 0) {
          throw new Error(
            `SES preview evaluation failed: ${JSON.stringify(compartmentErrors)}`,
          );
        }
        await waitFor('[data-test-live-preview]');
        let stableBoundary = document.querySelector('.realm-sandbox-render')!;
        let stableAuthoredNode = document.querySelector(
          '[data-test-live-preview]',
        )!;
        stablePreviewNode = stableAuthoredNode;
        assert.dom('[data-test-live-preview]').hasText('VERSION ONE');

        // The observer is installed before the initial sandbox is ready so it
        // can also catch writable-state flashes. Loading is expected only for
        // that first render; the assertion below covers the HMR/persistence
        // interval that starts here.
        previewLoadingAppeared = false;

        typeAtEndOfMarker('VERSION ONE', '!');

        await waitUntil(
          () =>
            document
              .querySelector('[data-test-live-preview]')
              ?.textContent?.trim() === 'VERSION ONE!',
        );
        assert.strictEqual(
          document.querySelector('.realm-sandbox-render'),
          stableBoundary,
          'the SES renderer boundary stayed mounted during the atomic template swap',
        );
        assert.strictEqual(
          document.querySelector('[data-test-live-preview]'),
          stableAuthoredNode,
          'the authored preview DOM stayed mounted during the hot update',
        );
        assert
          .dom('[data-realm-sandbox-template-island]')
          .hasAttribute(
            'data-realm-sandbox-island-update',
            'adopted',
            'the replacement program adopted the serialized island',
          );
        assert
          .dom('[data-card-sandbox-diagnostics]')
          .hasAttribute('data-card-sandbox-tier', 'compartment');

        // The local draft update above is only the first half of HMR. Wait
        // through autosave, the +source response, realm indexing, and the
        // matching SSE acknowledgement before asserting identity again.
        await settled();
        assert.strictEqual(
          document.querySelector('.realm-sandbox-render'),
          stableBoundary,
          'the SES renderer boundary survived persistence and indexing',
        );
        assert.strictEqual(
          document.querySelector('[data-test-live-preview]'),
          stableAuthoredNode,
          'the authored preview DOM survived persistence and indexing',
        );
      } else {
        await waitFor('[data-card-sandbox-code-preview-loader="dedicated"]');
        let frameBoundary = document.querySelector(
          '[data-card-sandbox-code-preview-loader="dedicated"]',
        )!;
        let stableBoundary = frameBoundary.querySelector('iframe')!;
        stablePreviewNode = stableBoundary;
        let initialPublishedRevision = Number(
          frameBoundary.getAttribute('data-card-sandbox-draft-revision'),
        );
        assert.ok(initialPublishedRevision >= 0, 'initial draft was published');
        await waitUntil(
          () =>
            Number(
              document
                .querySelector(
                  '[data-card-sandbox-code-preview-loader="dedicated"]',
                )
                ?.getAttribute('data-card-sandbox-applied-draft-revision'),
            ) >= initialPublishedRevision,
        );
        let initialAppliedRevision = Number(
          frameBoundary.getAttribute(
            'data-card-sandbox-applied-draft-revision',
          ),
        );
        assert.ok(
          initialAppliedRevision >= initialPublishedRevision,
          'the child confirmed the initial draft generation',
        );

        previewLoadingAppeared = false;

        typeAtEndOfMarker('VERSION ONE', '!');

        await waitUntil(() => {
          let boundary = document.querySelector(
            '[data-card-sandbox-code-preview-loader="dedicated"]',
          );
          return (
            Number(
              boundary?.getAttribute(
                'data-card-sandbox-applied-draft-revision',
              ),
            ) > initialAppliedRevision
          );
        });
        frameBoundary = document.querySelector(
          '[data-card-sandbox-code-preview-loader="dedicated"]',
        )!;
        assert.strictEqual(
          frameBoundary.querySelector('iframe'),
          stableBoundary,
          'the browser-runtime preview reused its detached iframe boundary',
        );

        await settled();
        frameBoundary = document.querySelector(
          '[data-card-sandbox-code-preview-loader="dedicated"]',
        )!;
        assert.strictEqual(
          frameBoundary.querySelector('iframe'),
          stableBoundary,
          'the browser-runtime iframe survived persistence and indexing',
        );
      }
      editorObserver.disconnect();
      assert.false(
        editorBecameReadOnly,
        'the writable Monaco editor never flips to a transient read-only state',
      );
      assert.false(
        readOnlyIndicatorAppeared,
        'the read-only workspace indicator never flashes during persistence',
      );
      assert.true(
        stablePreviewNode?.isConnected,
        'the original preview node remains connected after persistence',
      );
      assert.false(
        previewLoadingAppeared,
        'the persisted acknowledgement never replaces the preview with loading UI',
      );
      assert.true(
        realmSandbox.metricsSnapshot().codePreviewCommitsPrepared >
          initialCommitCount,
        'the autosave registered the exact Monaco revision',
      );
      assert.true(
        realmSandbox.metricsSnapshot().codePreviewAcknowledgementsRecognized >
          initialAcknowledgementCount,
        'the matching realm event was consumed as an acknowledgement',
      );
    });
  }

  test('[HMR-02] opaque presentation metadata follows the current valid draft before persistence', async function (assert) {
    let environment = getService('environment-service') as EnvironmentService;
    environment.autoSaveDelayMs = 1_000;
    setPlaygroundSelections({
      [`${testRealmURL}live-preview-compartment/LivePreview`]: {
        cardId: rri(`${testRealmURL}LivePreview/sample`),
        format: 'isolated',
      },
    });

    await visitOperatorMode({
      stacks: [],
      submode: 'code',
      codePath: `${testRealmURL}live-preview-compartment.gts`,
      codeSelection: 'LivePreview',
      moduleInspector: 'preview',
      cardPreviewFormat: 'isolated',
    });

    await waitFor('[data-test-editor]');
    await waitFor('[data-test-live-preview]');
    let realmSandbox = getService('realm-sandbox') as RealmSandboxService;
    let initialCommitCount =
      realmSandbox.metricsSnapshot().codePreviewCommitsPrepared;
    assert
      .dom('[data-test-playground-panel] .playground-panel-content')
      .hasAttribute('style', 'max-width: 50rem;');

    setMonacoContent(wideLivePreviewSource);

    await waitUntil(
      () =>
        document
          .querySelector(
            '[data-test-playground-panel] .playground-panel-content',
          )
          ?.getAttribute('style') === 'max-width: 100%;',
    );
    assert.strictEqual(
      realmSandbox.metricsSnapshot().codePreviewCommitsPrepared,
      initialCommitCount,
      'the explicit metadata boundary updates from the local draft without waiting for save/index acknowledgement',
    );
    assert
      .dom('[data-test-live-preview]')
      .hasText('VERSION ONE', 'the authored preview stays mounted');

    setMonacoContent(livePreviewSource);
    await waitUntil(
      () =>
        document
          .querySelector(
            '[data-test-playground-panel] .playground-panel-content',
          )
          ?.getAttribute('style') === 'max-width: 50rem;',
    );
  });

  test('[NAV-07][IFR-01][IFR-02] two SES format islands stay warm and iframe format updates keep the child document', async function (assert) {
    setPlaygroundSelections({
      [`${testRealmURL}live-preview-compartment/LivePreview`]: {
        cardId: rri(`${testRealmURL}LivePreview/sample`),
        format: 'isolated',
      },
    });
    await visitOperatorMode({
      stacks: [],
      submode: 'code',
      codePath: `${testRealmURL}live-preview-compartment.gts`,
      codeSelection: 'LivePreview',
      moduleInspector: 'preview',
      cardPreviewFormat: 'isolated',
    });
    await waitFor('[data-test-live-preview]');
    let isolatedNode = document.querySelector('[data-test-live-preview]')!;

    await click('[data-test-format-chooser="embedded"]');
    if (
      !document.querySelector(
        '[data-realm-sandbox-render-slot-active="true"] [data-test-live-preview-embedded]',
      )
    ) {
      let slots = [...document.querySelectorAll('.realm-sandbox-render-slot')]
        .map((slot) => ({
          active: slot.getAttribute('data-realm-sandbox-render-slot-active'),
          format: slot
            .querySelector('[data-boxel-card-format]')
            ?.getAttribute('data-boxel-card-format'),
          hidden: slot.hasAttribute('hidden'),
          text: slot.textContent?.trim(),
        }))
        .slice(0, 3);
      throw new Error(
        `Embedded sandbox format did not activate: ${JSON.stringify({
          embeddedChooserClass: document
            .querySelector('[data-test-format-chooser="embedded"]')
            ?.getAttribute('class'),
          loading: Boolean(
            document.querySelector('[data-card-sandbox-loading]'),
          ),
          syntaxError: document
            .querySelector('[data-test-syntax-error]')
            ?.textContent?.trim(),
          slots,
        })}`,
      );
    }
    await waitFor(
      '[data-realm-sandbox-render-slot-active="true"] [data-test-live-preview-embedded]',
    );
    let embeddedNode = document.querySelector(
      '[data-test-live-preview-embedded]',
    )!;
    assert.true(
      isolatedNode.isConnected,
      'the first SES format remains mounted in the two-slot LRU',
    );

    await click('[data-test-format-chooser="isolated"]');
    await waitFor(
      '[data-realm-sandbox-render-slot-active="true"] [data-test-live-preview]',
    );
    assert.strictEqual(
      document.querySelector(
        '[data-realm-sandbox-render-slot-active="true"] [data-test-live-preview]',
      ),
      isolatedNode,
      'returning to the recent format reactivates its authored DOM',
    );
    assert.true(
      embeddedNode.isConnected,
      'the second SES format remains warm for the next switch',
    );

    setPlaygroundSelections({
      [`${testRealmURL}live-preview-iframe/IframeLivePreview`]: {
        cardId: rri(`${testRealmURL}IframeLivePreview/sample`),
        format: 'isolated',
      },
    });
    await visitOperatorMode({
      stacks: [],
      submode: 'code',
      codePath: `${testRealmURL}live-preview-iframe.gts`,
      codeSelection: 'IframeLivePreview',
      moduleInspector: 'preview',
      cardPreviewFormat: 'isolated',
    });
    await waitFor('[data-card-sandbox-code-preview-loader="dedicated"]');
    let iframe = document.querySelector(
      '[data-card-sandbox-code-preview-loader="dedicated"] iframe',
    )! as HTMLIFrameElement;
    let iframeURL = iframe.src;

    await click('[data-test-format-chooser="embedded"]');
    await waitFor(
      '[data-card-sandbox-code-preview-loader="dedicated"][data-boxel-card-format="embedded"]',
    );
    assert.strictEqual(
      document.querySelector(
        '[data-card-sandbox-code-preview-loader="dedicated"] iframe',
      ),
      iframe,
      'the iframe browsing context survives a format switch',
    );
    assert.strictEqual(
      iframe.src,
      iframeURL,
      'format is a MessageChannel update rather than iframe URL identity',
    );

    await click('[data-test-format-chooser="edit"]');
    await waitFor(
      '[data-card-sandbox-code-preview-loader="dedicated"][data-boxel-card-format="edit"]',
    );
    assert.strictEqual(
      document.querySelector(
        '[data-card-sandbox-code-preview-loader="dedicated"] iframe',
      ),
      iframe,
      'a browser-dependent custom edit template keeps the iframe browsing context',
    );
    assert.strictEqual(
      iframe.src,
      iframeURL,
      'custom edit is also selected through the persistent presentation protocol',
    );
  });

  for (let [failureKind, brokenSource] of [
    ['compile', compileBrokenLivePreviewSource],
    ['render', renderBrokenLivePreviewSource],
  ] as const) {
    test(`[HMR-05] a sandbox ${failureKind} failure uses the standard code-mode error surface and recovers`, async function (assert) {
      setPlaygroundSelections({
        [`${testRealmURL}live-preview-compartment/LivePreview`]: {
          cardId: rri(`${testRealmURL}LivePreview/sample`),
          format: 'isolated',
        },
      });

      await visitOperatorMode({
        stacks: [],
        submode: 'code',
        codePath: `${testRealmURL}live-preview-compartment.gts`,
        codeSelection: 'LivePreview',
        moduleInspector: 'preview',
        cardPreviewFormat: 'isolated',
      });

      await waitFor('[data-test-editor]');
      await waitFor('[data-test-live-preview]');
      setMonacoContent(brokenSource);

      await waitFor('[data-test-syntax-error]');
      assert
        .dom('[data-test-syntax-error]')
        .includesText(
          'Unable to render the current preview',
          'the sandbox error is explicit instead of leaving a blank preview column',
        );
      assert
        .dom('[data-test-live-preview]')
        .hasText(
          'VERSION ONE',
          'the realm-backed last-known-good preview remains visible',
        );
      assert
        .dom('[data-test-send-error-to-ai-assistant]')
        .exists('the standard Fix with AI action is available');
      assert
        .dom('[data-test-editor]')
        .exists('Monaco remains mounted while the preview is broken');

      setMonacoContent(repairedLivePreviewSource);
      await waitFor('[data-test-live-preview]');
      assert
        .dom('[data-test-live-preview]')
        .hasText(
          'VERSION TWO',
          'a valid later generation restores the preview',
        );
      assert
        .dom('[data-test-syntax-error]')
        .doesNotExist(
          'the sandbox error clears only after a successful render',
        );

      // Do not let this test leave the shared cached realm on the deliberately
      // broken server generation. The next acceptance row opens this card in
      // Interact mode, so recovery includes autosave, indexing, and the
      // matching realm acknowledgement—not only the optimistic local render.
      await settled();
      assert
        .dom('[data-test-live-preview]')
        .hasText(
          'VERSION TWO',
          'the repaired preview survives persistence and acknowledgement',
        );
    });
  }

  test('[HMR-06] Reload Card deliberately remounts the selected sandbox preview', async function (assert) {
    let cardId = `${testRealmURL}LivePreview/sample`;

    await visitOperatorMode({
      stacks: [[{ id: cardId, format: 'isolated' }]],
      submode: 'interact',
    });

    await waitFor('[data-test-live-preview]');
    let originalPreview = document.querySelector('[data-test-live-preview]');
    assert.ok(originalPreview, 'the original sandboxed preview rendered');

    await click(
      `[data-test-stack-card="${cardId}"] [data-test-more-options-button]`,
    );
    assert
      .dom('[data-test-boxel-menu-item-text="Reload Card"]')
      .exists('the sandboxed card menu exposes an explicit reload action');
    await click('[data-test-boxel-menu-item-text="Reload Card"]');

    await waitUntil(
      () =>
        document.querySelector('[data-test-live-preview]') !== originalPreview,
    );
    assert
      .dom('[data-test-live-preview]')
      .hasText('VERSION ONE', 'reload uses the current draft source');
    assert.false(
      originalPreview?.isConnected,
      'the old authored component DOM was deliberately remounted',
    );
  });
});
