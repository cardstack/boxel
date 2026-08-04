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
import type {
  CardSandboxRenderFormat,
  CardSourceSandboxClassification,
} from '@cardstack/host/lib/realm-sandbox-source-policy';

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
      prefersFullSandbox: false,
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

  test('an authored full-sandbox preference only strengthens eligible format isolation', function (assert) {
    let moduleURL = 'https://realm.example/full-sandbox-card.gts';
    let service = getService('realm-sandbox') as RealmSandboxService;
    let typeState: OpaqueRealmCardTypeState = {
      typeRef: {
        module: rri(moduleURL),
        name: 'FullSandboxCard',
      },
      definitionKind: 'card',
      ancestorTypes: [],
      displayName: 'Full Sandbox Card',
      fields: {},
      hasCustomEditTemplate: true,
      hasCustomIsolatedTemplate: true,
      authoredTemplateFormats: ['isolated', 'fitted', 'edit'],
      headerColor: null,
      prefersFullSandbox: true,
      prefersWideFormat: false,
    };
    class OpaqueCard {}
    Object.defineProperty(OpaqueCard, opaqueRealmCardTypeState, {
      value: typeState,
    });
    let card = new OpaqueCard() as unknown as BaseDef;
    Object.defineProperty(card, opaqueRealmCardState, {
      value: {
        typeRef: typeState.typeRef,
        principal: 'https://realm.example/',
        document: { data: {} } as OpaqueRealmCardState['document'],
        snapshot: {},
        presentation: {
          headerColor: null,
          prefersWideFormat: false,
        },
      } satisfies OpaqueRealmCardState,
    });
    let internal = service as unknown as {
      moduleClassifications: Map<string, CardSourceSandboxClassification>;
      sandboxDecisionFor(
        card: BaseDef,
        format: CardSandboxRenderFormat,
      ): { tier: 'compartment' | 'iframe'; reason: string };
    };

    assert.deepEqual(internal.sandboxDecisionFor(card, 'isolated'), {
      tier: 'iframe',
      reason: 'author-preference:prefersFullSandbox',
    });
    assert.deepEqual(internal.sandboxDecisionFor(card, 'embedded'), {
      tier: 'iframe',
      reason: 'author-preference:prefersFullSandbox',
    });
    assert.deepEqual(internal.sandboxDecisionFor(card, 'edit'), {
      tier: 'iframe',
      reason: 'author-preference:prefersFullSandbox',
    });
    assert.deepEqual(
      internal.sandboxDecisionFor(card, 'fitted'),
      {
        tier: 'compartment',
        reason: 'ses-only-format:fitted',
      },
      'the preference does not create iframe pills or fitted-gallery tiles',
    );

    typeState.prefersFullSandbox = false;
    internal.moduleClassifications.set(moduleURL, {
      tier: 'iframe',
      reason: 'browser-runtime:three',
      imports: ['three'],
      signals: ['three'],
      propagatesToImporters: true,
    });
    assert.deepEqual(
      internal.sandboxDecisionFor(card, 'isolated'),
      {
        tier: 'iframe',
        reason: 'browser-runtime:three',
      },
      'turning the preference off cannot weaken a Host-required iframe',
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

  test('allows public image media without widening module or credential authority', async function (assert) {
    let sandbox = {
      rootModuleURL: 'https://realm-a.example/cards/article.gts',
      principal: 'https://realm-a.example/',
    } as RealmIframeSandboxRender;
    let service = getService('realm-sandbox') as RealmSandboxService;
    let publicFetches = 0;
    let authenticatedFetches = 0;
    let internal = service as unknown as {
      network: {
        realm: { realmOf(url: URL): undefined };
        fetch(url: URL): Promise<Response>;
        authedFetch(url: URL): Promise<Response>;
      };
    };
    internal.network = {
      realm: { realmOf: () => undefined },
      fetch: async () => {
        publicFetches++;
        return new Response(new Uint8Array([137, 80, 78, 71]), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        });
      },
      authedFetch: async () => {
        authenticatedFetches++;
        throw new Error('public media must not receive Realm credentials');
      },
    };

    let response = await service.fetchForIframe(
      sandbox,
      'https://cdn.example/poster.png',
      { headers: [['accept', 'image/*']] },
      'media',
    );

    assert.strictEqual(response.status, 200);
    assert.true(response.body instanceof ArrayBuffer);
    assert.strictEqual(publicFetches, 1);
    assert.strictEqual(authenticatedFetches, 0);
    await assert.rejects(
      service.fetchForIframe(sandbox, 'https://cdn.example/poster.png'),
      /denied undeclared module read/,
      'the same URL does not become an executable module dependency',
    );
  });

  test('rejects a non-image response from the private media capability', async function (assert) {
    let sandbox = {
      rootModuleURL: 'https://realm-a.example/cards/article.gts',
      principal: 'https://realm-a.example/',
    } as RealmIframeSandboxRender;
    let service = getService('realm-sandbox') as RealmSandboxService;
    let internal = service as unknown as {
      network: {
        realm: { realmOf(url: URL): undefined };
        fetch(url: URL): Promise<Response>;
        authedFetch(url: URL): Promise<Response>;
      };
    };
    let nonImage = async () =>
      new Response('export const stolen = true;', {
        status: 200,
        headers: { 'content-type': 'application/javascript' },
      });
    internal.network = {
      realm: { realmOf: () => undefined },
      fetch: nonImage,
      authedFetch: nonImage,
    };

    await assert.rejects(
      service.fetchForIframe(
        sandbox,
        'https://cdn.example/not-an-image.js',
        { headers: [['accept', 'image/*']] },
        'media',
      ),
      /media response was not an image/,
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

  test('routes only formats that use an unsafe renderer module to the iframe', function (assert) {
    let cardModuleURL = 'https://realm.example/cards/planet.gts';
    let rendererModuleURL = 'https://realm.example/cards/planet-3d.gts';
    let service = getService('realm-sandbox') as RealmSandboxService;
    let internal = service as unknown as {
      moduleClassifications: Map<string, CardSourceSandboxClassification>;
      moduleDependencies: Map<string, string[]>;
      moduleFormatOnlyImports: Map<
        string,
        {
          module: string;
          exports: string[];
          formats: CardSandboxRenderFormat[];
        }[]
      >;
      moduleSandboxDecision(
        moduleIdentifier: string,
        visited: Set<string>,
        format?: CardSandboxRenderFormat,
      ): { tier: 'compartment' | 'iframe'; reason: string };
    };
    internal.moduleClassifications.set(cardModuleURL, {
      tier: 'compartment',
      reason: 'default-user-card',
      imports: ['./planet-3d.gts'],
      signals: [],
      propagatesToImporters: false,
    });
    internal.moduleClassifications.set(rendererModuleURL, {
      tier: 'iframe',
      reason: 'browser-runtime:three',
      imports: ['three'],
      signals: ['three'],
      propagatesToImporters: true,
    });
    internal.moduleDependencies.set(codePreviewModuleKey(cardModuleURL), []);
    internal.moduleFormatOnlyImports.set(codePreviewModuleKey(cardModuleURL), [
      {
        module: rendererModuleURL,
        exports: ['PlanetScene'],
        formats: ['isolated', 'embedded', 'edit'],
      },
    ]);

    assert.deepEqual(
      internal.moduleSandboxDecision(cardModuleURL, new Set(), 'atom'),
      { tier: 'compartment', reason: 'default-user-card' },
      'the same card uses its safe atom renderer in SES',
    );
    assert.deepEqual(
      internal.moduleSandboxDecision(cardModuleURL, new Set(), 'fitted'),
      { tier: 'compartment', reason: 'default-user-card' },
      'the same card uses its safe fitted renderer in SES',
    );
    assert.deepEqual(
      internal.moduleSandboxDecision(cardModuleURL, new Set(), 'isolated'),
      {
        tier: 'iframe',
        reason: 'format-dependency:browser-runtime:three',
      },
      'the isolated renderer follows its independently classified module into the iframe',
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
