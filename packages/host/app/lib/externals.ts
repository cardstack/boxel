import * as emberComponent from '@ember/component';
import * as emberComponentTemplateOnly from '@ember/component/template-only';
import * as emberDestroyable from '@ember/destroyable';
import * as emberHelper from '@ember/helper';
import * as emberModifier from '@ember/modifier';
import * as emberObject from '@ember/object';
import * as emberObjectInternals from '@ember/object/internals';
import * as emberRunloop from '@ember/runloop';
import * as emberService from '@ember/service';

import * as emberTemplate from '@ember/template';
import * as emberTemplateFactory from '@ember/template-factory';
import * as emberTestHelpers from '@ember/test-helpers';
import * as glimmerComponent from '@glimmer/component';
import * as glimmerTracking from '@glimmer/tracking';
// @ts-ignore - no types for @glimmer/validator
import * as glimmerValidator from '@glimmer/validator';

import * as viewTransitions from '@cardstack/view-transitions';
import * as floatingUiDom from '@floating-ui/dom';
import * as awesomePhoneNumber from 'awesome-phonenumber';
import * as dateFns from 'date-fns';
import * as emberAnimated from 'ember-animated';
import * as eaEasingsCosine from 'ember-animated/easings/cosine';
import * as eaEasingsLinear from 'ember-animated/easings/linear';
import * as eaMotionsAdjustColor from 'ember-animated/motions/adjust-color';
import * as eaMotionsAdjustCss from 'ember-animated/motions/adjust-css';
import * as eaMotionsBoxShadow from 'ember-animated/motions/box-shadow';
import * as eaMotionsCompensateForScale from 'ember-animated/motions/compensate-for-scale';
import * as eaMotionsFollow from 'ember-animated/motions/follow';
import * as eaMotionsMove from 'ember-animated/motions/move';
import * as eaMotionsMoveSvg from 'ember-animated/motions/move-svg';
import * as eaMotionsOpacity from 'ember-animated/motions/opacity';
import * as eaMotionsResize from 'ember-animated/motions/resize';
import * as eaMotionsScale from 'ember-animated/motions/scale';
import * as eaTransitionsFade from 'ember-animated/transitions/fade';
import * as eaTransitionsMoveOver from 'ember-animated/transitions/move-over';
import * as emberConcurrency from 'ember-concurrency';
import * as emberConcurrencyAsyncArrowRuntime from 'ember-concurrency/-private/async-arrow-runtime';
import * as cssUrl from 'ember-css-url';
import * as emberModifier2 from 'ember-modifier';
import * as emberModifyClassBasedResource from 'ember-modify-based-class-resource';
import * as emberProvideConsumeContext from 'ember-provide-consume-context';
import * as emberProvideConsumeContextContextConsumer from 'ember-provide-consume-context/components/context-consumer';
import * as emberProvideConsumeContextContextProvider from 'ember-provide-consume-context/components/context-provider';
import * as emberResources from 'ember-resources';
import * as flat from 'flat';
import * as glimmerMotion from 'glimmer-motion';
import * as glimmerMotionLayoutGroup from 'glimmer-motion/layout-group';
import * as glimmerMotionMotionConfig from 'glimmer-motion/motion-config';
import * as glimmerMotionPresence from 'glimmer-motion/presence';
import * as glimmerMotionReorderGroup from 'glimmer-motion/reorder/group';
import * as glimmerMotionReorderItem from 'glimmer-motion/reorder/item';
import * as lodash from 'lodash-es';
import * as matrixJsSDK from 'matrix-js-sdk';
import * as rsvp from 'rsvp';
import * as superFastMD5 from 'super-fast-md5';
import * as tracked from 'tracked-built-ins';

import * as boxelUiComponents from '@cardstack/boxel-ui/components';
import * as boxelUiHelpers from '@cardstack/boxel-ui/helpers';
import * as boxelUiIcons from '@cardstack/boxel-ui/icons';
import * as boxelUiModifiers from '@cardstack/boxel-ui/modifiers';

import * as runtime from '@cardstack/runtime-common';
import type { VirtualNetwork } from '@cardstack/runtime-common';
import {
  PACKAGES_FAKE_ORIGIN,
  fallbackShim,
} from '@cardstack/runtime-common/package-shim-handler';

import * as pdfjsLoader from '../lib/pdfjs-loader';
import * as signedCapture from '../lib/signed-capture';
import * as threeLoader from '../lib/three-loader';
import { shimHostTools } from '../tools';

export function shimExternals(virtualNetwork: VirtualNetwork) {
  // Always shim qunit on the virtual network. In non-test environments (code
  // mode, card rendering), this no-op stub prevents realm cards that co-locate
  // test imports from failing to load — test callbacks are never invoked.
  // In live-test runs, loadRealmTests() overrides this at the realm loader
  // level via loader.shimModule('qunit', QUnit), so the real QUnit instance
  // is used there and this network-level shim is never reached.
  const windowQUnit = (globalThis as any).QUnit;
  virtualNetwork.shimModule(
    'qunit',
    windowQUnit || { module: () => {}, test: () => {}, config: {} },
  );

  virtualNetwork.shimModule('@cardstack/runtime-common', runtime);
  virtualNetwork.shimModule(
    '@cardstack/boxel-ui/components',
    boxelUiComponents,
  );
  virtualNetwork.shimModule('@cardstack/boxel-ui/helpers', boxelUiHelpers);
  virtualNetwork.shimModule('@cardstack/boxel-ui/icons', boxelUiIcons);
  virtualNetwork.shimModule('@cardstack/boxel-ui/modifiers', boxelUiModifiers);
  // Spec cards published for boxel-ui components use the bare specifier
  // `@cardstack/boxel-ui/components` in their `ref.module`. The
  // VirtualNetwork needs a prefix mapping to translate that into the
  // fake-packages URL form the rest of the runtime already accepts
  // (see `isGloballyPublicDependency` in runtime-common/realm.ts).
  // The shimModule calls above register the JS module; this registers
  // the prefix so CodeRef.moduleHref resolves.
  //
  // Registered as a package namespace rather than a realm: the content behind
  // it is this bundle's own, so carrying a Host package's name is correct.
  // `addRealmMapping` refuses those names precisely so a realm cannot.
  virtualNetwork.addPackageMapping(
    '@cardstack/boxel-ui/',
    `${PACKAGES_FAKE_ORIGIN}@cardstack/boxel-ui/`,
  );
  virtualNetwork.shimModule('@glimmer/component', glimmerComponent);
  virtualNetwork.shimModule('@glimmer/tracking', glimmerTracking);
  virtualNetwork.shimModule('@glimmer/validator', glimmerValidator);
  virtualNetwork.shimModule('@ember/component', emberComponent);
  virtualNetwork.shimModule(
    '@ember/component/template-only',
    emberComponentTemplateOnly,
  );
  virtualNetwork.shimModule('@ember/destroyable', emberDestroyable);
  virtualNetwork.shimModule('@ember/helper', emberHelper);
  virtualNetwork.shimModule('@ember/modifier', emberModifier);
  virtualNetwork.shimModule('@ember/object', emberObject);
  virtualNetwork.shimModule('@ember/object/internals', emberObjectInternals);
  virtualNetwork.shimModule('@ember/runloop', emberRunloop);
  virtualNetwork.shimModule('@ember/service', emberService);
  virtualNetwork.shimModule('@ember/template', emberTemplate);
  virtualNetwork.shimModule('@ember/template-factory', emberTemplateFactory);
  virtualNetwork.shimModule('@cardstack/view-transitions', viewTransitions);
  virtualNetwork.shimModule('awesome-phonenumber', awesomePhoneNumber);
  virtualNetwork.shimModule('date-fns', dateFns);
  virtualNetwork.shimModule('ember-animated', emberAnimated);
  virtualNetwork.shimModule('ember-animated/easings/cosine', eaEasingsCosine);
  virtualNetwork.shimModule('ember-animated/easings/linear', eaEasingsLinear);
  virtualNetwork.shimModule(
    'ember-animated/motions/adjust-color',
    eaMotionsAdjustColor,
  );
  virtualNetwork.shimModule(
    'ember-animated/motions/adjust-css',
    eaMotionsAdjustCss,
  );
  virtualNetwork.shimModule(
    'ember-animated/motions/box-shadow',
    eaMotionsBoxShadow,
  );
  virtualNetwork.shimModule(
    'ember-animated/motions/compensate-for-scale',
    eaMotionsCompensateForScale,
  );
  virtualNetwork.shimModule('ember-animated/motions/follow', eaMotionsFollow);
  virtualNetwork.shimModule('ember-animated/motions/move', eaMotionsMove);
  virtualNetwork.shimModule(
    'ember-animated/motions/move-svg',
    eaMotionsMoveSvg,
  );
  virtualNetwork.shimModule('ember-animated/motions/opacity', eaMotionsOpacity);
  virtualNetwork.shimModule('ember-animated/motions/resize', eaMotionsResize);
  virtualNetwork.shimModule('ember-animated/motions/scale', eaMotionsScale);
  virtualNetwork.shimModule(
    'ember-animated/transitions/fade',
    eaTransitionsFade,
  );
  virtualNetwork.shimModule(
    'ember-animated/transitions/move-over',
    eaTransitionsMoveOver,
  );
  virtualNetwork.shimModule('ember-concurrency', emberConcurrency);
  virtualNetwork.shimModule(
    'ember-concurrency/-private/async-arrow-runtime',
    emberConcurrencyAsyncArrowRuntime,
  );
  virtualNetwork.shimModule('ember-css-url', cssUrl);
  virtualNetwork.shimModule('ember-modifier', emberModifier2);
  virtualNetwork.shimModule(
    'ember-modify-based-class-resource',
    emberModifyClassBasedResource,
  );
  virtualNetwork.shimModule(
    'ember-provide-consume-context',
    emberProvideConsumeContext,
  );
  virtualNetwork.shimModule(
    'ember-provide-consume-context/components/context-consumer',
    emberProvideConsumeContextContextConsumer,
  );
  virtualNetwork.shimModule(
    'ember-provide-consume-context/components/context-provider',
    emberProvideConsumeContextContextProvider,
  );
  virtualNetwork.shimModule('ember-resources', emberResources);
  virtualNetwork.shimModule('ember-source/types', { default: class {} });
  virtualNetwork.shimModule('ember-source/types/preview', {
    default: class {},
  });
  virtualNetwork.shimModule('flat', flat);
  virtualNetwork.shimModule('@floating-ui/dom', floatingUiDom);
  virtualNetwork.shimModule('lodash', lodash);
  virtualNetwork.shimModule('lodash-es', lodash);
  virtualNetwork.shimModule('matrix-js-sdk', matrixJsSDK);
  virtualNetwork.shimModule('rsvp', rsvp);
  virtualNetwork.shimModule('super-fast-md5', superFastMD5);
  virtualNetwork.shimModule('tracked-built-ins', tracked);
  // BXL is card-facing: any card module may `import { expression, fx, jq }
  // from '@cardstack/bxl'` for computeVia formulas. The async shim keeps the
  // library out of the host's initial chunk graph — it loads only when a card
  // that uses it loads. `expression()` evaluates synchronously (computeVia
  // cannot await), so the resolver folds in the lazy formula families
  // (statistical, Bessel, engineering/financial, validation) before serving
  // the module: cards get the full Excel-function surface without knowing
  // about chunking.
  virtualNetwork.shimAsyncModule({
    id: '@cardstack/bxl',
    resolve: async () => {
      let bxl = await import('@cardstack/bxl');
      await bxl.loadAllFormulaExtensions();
      return bxl;
    },
  });
  // glimmer-motion and Choreo hand cards the host's own module objects, so
  // cards and host share one copy of each library's module-global state (the
  // drag lock, the layout scheduler, the Choreo registry).
  //
  // The shim set is the libraries' curated card-facing API, not their whole
  // npm surface: each package root and `/test-support`, glimmer-motion's
  // component entries, Choreo's `/choreo` and `/steps`, and Film (`/film`,
  // which the packages reach through their `./*` pattern, plus its component
  // entries). Their other `./*` subpaths stay unshimmed, and `boxel parse`
  // aliases exactly these ids, so a card importing one of those subpaths
  // fails to type-check rather than failing to load. motion-dom isn't
  // shimmed either: cards reach it through glimmer-motion's curated
  // re-exports.
  //
  // glimmer-motion's entry points are sync shims, which put it in the initial
  // bundle: it is the animation library host UI is moving to, so the bundle
  // carries it either way. Choreo's shims are async and keep it out of the
  // initial bundle until a card imports it. Switch them to sync if host UI
  // starts importing Choreo.
  virtualNetwork.shimModule('glimmer-motion', glimmerMotion);
  virtualNetwork.shimModule(
    'glimmer-motion/layout-group',
    glimmerMotionLayoutGroup,
  );
  virtualNetwork.shimModule(
    'glimmer-motion/motion-config',
    glimmerMotionMotionConfig,
  );
  virtualNetwork.shimModule('glimmer-motion/presence', glimmerMotionPresence);
  virtualNetwork.shimModule(
    'glimmer-motion/reorder/group',
    glimmerMotionReorderGroup,
  );
  virtualNetwork.shimModule(
    'glimmer-motion/reorder/item',
    glimmerMotionReorderItem,
  );
  // Card tests are its only consumers, so it loads on demand like Choreo.
  virtualNetwork.shimAsyncModule({
    id: 'glimmer-motion/test-support',
    resolve: () => import('glimmer-motion/test-support'),
  });
  virtualNetwork.shimAsyncModule({
    id: '@cardstack/choreo',
    resolve: () => import('@cardstack/choreo'),
  });
  virtualNetwork.shimAsyncModule({
    id: '@cardstack/choreo/choreo',
    resolve: () => import('@cardstack/choreo/choreo'),
  });
  virtualNetwork.shimAsyncModule({
    id: '@cardstack/choreo/steps',
    resolve: () => import('@cardstack/choreo/steps'),
  });
  virtualNetwork.shimAsyncModule({
    id: '@cardstack/choreo/test-support',
    resolve: () => import('@cardstack/choreo/test-support'),
  });
  virtualNetwork.shimAsyncModule({
    id: '@cardstack/choreo/film',
    resolve: () => import('@cardstack/choreo/film'),
  });
  virtualNetwork.shimAsyncModule({
    id: '@cardstack/choreo/film/clip',
    resolve: () => import('@cardstack/choreo/film/clip'),
  });
  virtualNetwork.shimAsyncModule({
    id: '@cardstack/choreo/film/film',
    resolve: () => import('@cardstack/choreo/film/film'),
  });
  virtualNetwork.shimAsyncModule({
    id: '@cardstack/choreo/film/graph/adjust',
    resolve: () => import('@cardstack/choreo/film/graph/adjust'),
  });
  virtualNetwork.shimAsyncModule({
    id: '@cardstack/choreo/film/graph/host',
    resolve: () => import('@cardstack/choreo/film/graph/host'),
  });
  virtualNetwork.shimAsyncModule({
    id: '@cardstack/choreo/film/graph/nodes',
    resolve: () => import('@cardstack/choreo/film/graph/nodes'),
  });
  virtualNetwork.shimAsyncModule({
    id: '@cardstack/choreo/film/joins',
    resolve: () => import('@cardstack/choreo/film/joins'),
  });
  virtualNetwork.shimAsyncModule({
    id: '@cardstack/choreo/film/overlays',
    resolve: () => import('@cardstack/choreo/film/overlays'),
  });
  virtualNetwork.shimAsyncModule({
    id: '@cardstack/choreo/film/picture',
    resolve: () => import('@cardstack/choreo/film/picture'),
  });
  virtualNetwork.shimAsyncModule({
    id: '@cardstack/choreo/film/plate',
    resolve: () => import('@cardstack/choreo/film/plate'),
  });
  virtualNetwork.shimAsyncModule({
    id: '@cardstack/choreo/film/player',
    resolve: () => import('@cardstack/choreo/film/player'),
  });
  virtualNetwork.shimAsyncModule({
    id: '@cardstack/choreo/film/rail',
    resolve: () => import('@cardstack/choreo/film/rail'),
  });
  virtualNetwork.shimAsyncModule({
    id: '@cardstack/choreo/film/titles',
    resolve: () => import('@cardstack/choreo/film/titles'),
  });
  // choreo-player, the headless transport that drives Choreo runs from an
  // external clock: a card that composes runs into one timeline, such as the
  // gallery's feature reel, seeks them through it.
  virtualNetwork.shimAsyncModule({
    id: '@cardstack/choreo-player',
    resolve: () => import('@cardstack/choreo-player'),
  });
  virtualNetwork.shimAsyncModule({
    id: 'ethers',
    resolve: () => import('ethers'),
  });
  // The PDF family's capture-only poster component rasterizes page 1 with
  // pdf.js. Vendored (not fetched from a CDN inside the render) so realm
  // indexing never depends on public-network reachability from the
  // prerender, and lazy so the engine's chunk loads only when a capture
  // render asks for it — the wrapper also wires a same-origin worker asset
  // (see `../lib/pdfjs`).
  //
  // Two shims on purpose. The async shim serves card code that statically
  // imports `pdfjs-dist` (the proven consumption shape for async shims —
  // fflate, ethers). The sync loader shim is what the capture component
  // uses: it needs the engine only at capture time, and a static import of
  // this zero-cost function keeps the chunk load at the call, on the
  // loader path static imports already exercise.
  virtualNetwork.shimAsyncModule({
    id: 'pdfjs-dist',
    resolve: () => import('../lib/pdfjs.js'),
  });
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/lib/pdfjs-loader',
    pdfjsLoader,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/lib/signed-capture',
    signedCapture,
  );
  // The 3D families' capture-only still renders with the host's vendored
  // three.js through the same sync-shim shape as the pdf.js loader: a static
  // import of a zero-cost function whose call performs the lazy chunk load.
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/lib/three-loader',
    threeLoader,
  );
  virtualNetwork.shimAsyncModule({
    id: 'uuid',
    resolve: () => import('uuid'),
  });
  virtualNetwork.shimAsyncModule({
    id: 'yaml',
    resolve: () => import('yaml'),
  });
  virtualNetwork.shimAsyncModule({
    id: 'fflate',
    resolve: () => import('fflate'),
  });
  virtualNetwork.shimAsyncModule({
    id: '@cardstack/runtime-common/constants',
    resolve: () => import('@cardstack/runtime-common/constants'),
  });
  virtualNetwork.shimAsyncModule({
    id: '@cardstack/runtime-common/marked-sync',
    resolve: () => import('@cardstack/runtime-common/marked-sync'),
  });
  virtualNetwork.shimAsyncModule({
    id: '@cardstack/runtime-common/bfm-card-references',
    resolve: () => import('@cardstack/runtime-common/bfm-card-references'),
  });
  virtualNetwork.shimAsyncModule({
    id: '@cardstack/runtime-common/helpers/ai',
    resolve: () => import('@cardstack/runtime-common/helpers/ai'),
  });
  virtualNetwork.shimAsyncModule({
    id: '@cardstack/runtime-common/helpers/card-directory-name',
    resolve: () =>
      import('@cardstack/runtime-common/helpers/card-directory-name'),
  });

  shimModulesForLiveTests(virtualNetwork);

  // Some realm modules use host-only types or helpers. Provide a safe shim so
  // imports resolve even when the host module isn't present in the build.
  // Wrapped in `fallbackShim` so the strict-namespace check in the shim
  // handler doesn't throw on names this stub doesn't expose — callers that
  // reach beyond `default` here are expected to no-op in non-host envs.
  virtualNetwork.shimModule(
    '@cardstack/host/services/store',
    fallbackShim({ default: class {} }),
  );

  shimHostTools(virtualNetwork);
}

// Shims test-only module IDs into the virtual network as empty fallbacks so
// realm cards that co-locate test imports (e.g. *.test.gts) can load in any
// environment without crashing. These are never actually called in production
// — they just prevent import resolution errors.
//
// Each fallback is wrapped in `fallbackShim` so the strict-namespace check
// in the shim handler doesn't throw `ReferenceError` on the names a card's
// test code references (e.g. `setupCardTest`, `mockMatrixForTesting`). The
// fallback's only job here is to keep import resolution from failing; the
// names that get accessed return `undefined` in non-test envs, which is the
// pre-strict-check behavior callers depend on.
//
// In live-test runs, live-test.js overrides these at the *realm loader* level
// (via loader.shimModule) with the real implementations before importing test
// modules. The loader-level shim takes precedence over this network-level
// fallback, so the real helpers are used during test execution.
export function shimModulesForLiveTests(virtualNetwork: VirtualNetwork) {
  virtualNetwork.shimModule('@ember/test-helpers', emberTestHelpers);
  virtualNetwork.shimModule('@cardstack/host/tests/helpers', fallbackShim());
  virtualNetwork.shimModule(
    '@cardstack/host/tests/helpers/mock-matrix',
    fallbackShim(),
  );
  virtualNetwork.shimModule(
    '@cardstack/host/tests/helpers/setup',
    fallbackShim(),
  );
  virtualNetwork.shimModule(
    '@cardstack/host/tests/helpers/adapter',
    fallbackShim(),
  );
  virtualNetwork.shimModule(
    '@cardstack/host/tests/helpers/render-component',
    fallbackShim(),
  );
  virtualNetwork.shimModule(
    '@cardstack/host/tests/helpers/base-realm',
    fallbackShim(),
  );
  virtualNetwork.shimModule('@universal-ember/test-support', fallbackShim());
  virtualNetwork.shimModule('@ember/owner', fallbackShim());
  virtualNetwork.shimModule(
    '@cardstack/host/config/environment',
    fallbackShim(),
  );
}
