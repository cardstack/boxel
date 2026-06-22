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

import { shimHostCommands } from '../commands';

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
  // VirtualNetwork needs a realm mapping to translate that into the
  // fake-packages URL form the rest of the runtime already accepts
  // (see `isGloballyPublicDependency` in runtime-common/realm.ts).
  // The shimModule calls above register the JS module; this registers
  // the realm prefix so CodeRef.moduleHref resolves.
  virtualNetwork.addRealmMapping(
    '@cardstack/boxel-ui/',
    `${PACKAGES_FAKE_ORIGIN}@cardstack/boxel-ui/`,
  );
  virtualNetwork.shimModule('@glimmer/component', glimmerComponent);
  virtualNetwork.shimModule('@glimmer/tracking', glimmerTracking);
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
  virtualNetwork.shimAsyncModule({
    id: 'ethers',
    resolve: () => import('ethers'),
  });
  virtualNetwork.shimAsyncModule({
    id: 'uuid',
    resolve: () => import('uuid'),
  });
  virtualNetwork.shimAsyncModule({
    id: 'yaml',
    resolve: () => import('yaml'),
  });
  virtualNetwork.shimAsyncModule({
    id: '@cardstack/runtime-common/marked-sync',
    resolve: () => import('@cardstack/runtime-common/marked-sync'),
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

  shimHostCommands(virtualNetwork);
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
