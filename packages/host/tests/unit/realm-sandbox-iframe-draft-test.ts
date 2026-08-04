import { getService } from '@universal-ember/test-support';
import { setupTest } from 'ember-qunit';
import { module, test } from 'qunit';

import { rri } from '@cardstack/runtime-common';

import { codePreviewModuleKey } from '@cardstack/host/lib/code-preview-sandbox';
import {
  opaqueRealmCardState,
  opaqueRealmCardTypeState,
  type OpaqueRealmCardState,
  type OpaqueRealmCardTypeState,
} from '@cardstack/host/lib/realm-sandbox-boundary';

import { isExecutableModuleResponse } from '@cardstack/host/services/realm-sandbox';
import type RealmSandboxService from '@cardstack/host/services/realm-sandbox';
import type { RealmIframeSandboxRender } from '@cardstack/host/services/realm-sandbox';

import type { BaseDef } from '@cardstack/base/card-api';

module('Unit | realm sandbox iframe draft', function (hooks) {
  setupTest(hooks);

  test('counts each mounted iframe Code preview loader once', function (assert) {
    let service = getService('realm-sandbox') as RealmSandboxService;
    let token = {};

    assert.strictEqual(service.metricsSnapshot().activeCodePreviewLoaders, 0);
    service.registerIframeCodePreviewLoader(token);
    service.registerIframeCodePreviewLoader(token);
    assert.strictEqual(
      service.metricsSnapshot().activeCodePreviewLoaders,
      1,
      'modifier revalidation does not double-count the child Loader',
    );

    service.releaseIframeCodePreviewLoader(token);
    assert.strictEqual(service.metricsSnapshot().activeCodePreviewLoaders, 0);
  });

  test('counts iframe MessageChannel lifetimes idempotently', function (assert) {
    let service = getService('realm-sandbox') as RealmSandboxService;
    let token = {};

    assert.strictEqual(service.metricsSnapshot().activeIframeConnections, 0);
    service.registerIframeConnection(token);
    service.registerIframeConnection(token);
    assert.strictEqual(
      service.metricsSnapshot().activeIframeConnections,
      1,
      'modifier revalidation does not double-count the MessageChannel',
    );

    service.releaseIframeConnection(token);
    service.releaseIframeConnection(token);
    assert.strictEqual(service.metricsSnapshot().activeIframeConnections, 0);
  });

  test('applies iframe type presentation to the opaque Host boundary', function (assert) {
    let service = getService('realm-sandbox') as RealmSandboxService;
    let typeState: OpaqueRealmCardTypeState & { icon: null } = {
      typeRef: {
        module: rri('https://realm.example/wide-card.gts'),
        name: 'WideCard',
      },
      definitionKind: 'card',
      ancestorTypes: [],
      displayName: 'WideCard',
      fields: {},
      hasCustomEditTemplate: false,
      hasCustomIsolatedTemplate: true,
      authoredTemplateFormats: ['isolated'],
      headerColor: null,
      prefersWideFormat: false,
      icon: null,
    };
    class OpaqueCard {}
    Object.defineProperty(OpaqueCard, opaqueRealmCardTypeState, {
      value: typeState,
    });
    let card = new OpaqueCard() as unknown as BaseDef;
    let state: OpaqueRealmCardState = {
      typeRef: typeState.typeRef,
      principal: 'https://realm.example/',
      document: { data: {} } as OpaqueRealmCardState['document'],
      snapshot: {},
      presentation: {
        displayName: 'WideCard',
        headerColor: null,
        prefersWideFormat: false,
      },
    };
    Object.defineProperty(card, opaqueRealmCardState, { value: state });
    let internal = service as unknown as {
      applyIframeTypePresentation(
        card: BaseDef,
        presentation: {
          displayName: string;
          headerColor: string | null;
          prefersWideFormat: boolean;
        },
      ): void;
    };

    internal.applyIframeTypePresentation(card, {
      displayName: 'Wide Surface Card',
      headerColor: '#123456',
      prefersWideFormat: true,
    });

    assert.strictEqual(typeState.displayName, 'Wide Surface Card');
    assert.strictEqual(typeState.headerColor, '#123456');
    assert.true(typeState.prefersWideFormat);
    assert.deepEqual(
      state.presentation,
      {
        displayName: 'Wide Surface Card',
        headerColor: '#123456',
        prefersWideFormat: true,
      },
      'the same inert presentation consumed by CardContainer is synchronized',
    );
  });

  test('serves the private Monaco buffer only for its exact module URL', async function (assert) {
    let sandbox = {
      rootModuleURL: 'https://realm.example/cards/article.gts',
      principal: 'https://realm.example/',
      draft: {
        sourceURL: 'https://realm.example/cards/article.gts',
        source: 'export const title = "Unsaved draft";',
        revision: 7,
      },
    } as RealmIframeSandboxRender;
    let service = getService('realm-sandbox') as RealmSandboxService;

    let response = await service.fetchForIframe(
      sandbox,
      'https://realm.example/cards/article.gts?preview-cache-bust=7',
    );

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body, sandbox.draft!.source);
    assert.deepEqual(response.headers, [
      ['content-type', 'application/vnd.card+source'],
    ]);
    assert.strictEqual(
      response.url,
      'https://realm.example/cards/article.gts?preview-cache-bust=7',
      'the child Loader keeps the requested module identity',
    );
  });

  test('denies an undeclared cross-realm read before authenticated fetch', async function (assert) {
    let sandbox = {
      rootModuleURL: 'https://realm-a.example/cards/article.gts',
      principal: 'https://realm-a.example/',
    } as RealmIframeSandboxRender;
    let service = getService('realm-sandbox') as RealmSandboxService;

    await assert.rejects(
      service.fetchForIframe(
        sandbox,
        'https://realm-b.example/private/notes.json',
      ),
      /denied undeclared module read/,
      'the child cannot turn the host broker into a cross-realm credential proxy',
    );
  });

  test('allows only a declared cross-realm module dependency', function (assert) {
    let rootModuleURL = 'https://realm-a.example/cards/article.gts';
    let dependencyURL = 'https://realm-b.example/shared/nav.gts';
    let sandbox = {
      rootModuleURL,
      principal: 'https://realm-a.example/',
    } as RealmIframeSandboxRender;
    let service = getService('realm-sandbox') as RealmSandboxService;
    let internal = service as unknown as {
      moduleDependencies: Map<string, string[]>;
      isIframeFetchAllowed(
        sandbox: RealmIframeSandboxRender,
        targetURL: string,
      ): boolean;
    };
    internal.moduleDependencies.set(codePreviewModuleKey(rootModuleURL), [
      dependencyURL,
    ]);
    assert.true(
      internal.isIframeFetchAllowed(sandbox, dependencyURL),
      'the explicitly imported dependency is readable',
    );
    assert.false(
      internal.isIframeFetchAllowed(
        sandbox,
        'https://realm-b.example/private/notes.json',
      ),
      'another resource in that realm does not inherit the module grant',
    );
  });

  test('recognizes extensionless JavaScript module responses', function (assert) {
    assert.true(
      isExecutableModuleResponse(
        'https://esm.sh/leaflet@1.9.4',
        'application/javascript; charset=utf-8',
      ),
      'a CDN package entry point is executable based on its MIME type',
    );
    assert.false(
      isExecutableModuleResponse(
        'https://cdn.example/assets/map-theme',
        'text/css',
      ),
      'an extensionless asset does not become executable',
    );
  });

  test('an authorized extensionless module grants only its parsed transitive imports', async function (assert) {
    let rootModuleURL = 'https://realm-a.example/cards/map.gts';
    let packageURL = 'https://esm.sh/leaflet@1.9.4';
    let transitiveURL = 'https://esm.sh/leaflet@1.9.4/es2022/leaflet.mjs';
    let sandbox = {
      rootModuleURL,
      principal: 'https://realm-a.example/',
    } as RealmIframeSandboxRender;
    let service = getService('realm-sandbox') as RealmSandboxService;
    let internal = service as unknown as {
      moduleDependencies: Map<string, string[]>;
      recordModuleSourceClassification(
        moduleIdentifier: string,
        source: string,
      ): Promise<void>;
      isIframeFetchAllowed(
        sandbox: RealmIframeSandboxRender,
        targetURL: string,
      ): boolean;
    };
    internal.moduleDependencies.set(codePreviewModuleKey(rootModuleURL), [
      packageURL,
    ]);

    await internal.recordModuleSourceClassification(
      packageURL,
      'export * from "/leaflet@1.9.4/es2022/leaflet.mjs";',
    );

    assert.true(
      internal.isIframeFetchAllowed(sandbox, transitiveURL),
      'the exact static dependency parsed from the authorized module is readable',
    );
    assert.false(
      internal.isIframeFetchAllowed(
        sandbox,
        'https://esm.sh/leaflet@1.9.4/es2022/private.mjs',
      ),
      'a sibling CDN module does not inherit authority',
    );
  });
});
