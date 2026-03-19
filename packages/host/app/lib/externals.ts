import * as emberComponent from '@ember/component';
import * as emberComponentTemplateOnly from '@ember/component/template-only';
import * as emberDestroyable from '@ember/destroyable';
import * as emberHelper from '@ember/helper';
import * as emberModifier from '@ember/modifier';
import * as emberObject from '@ember/object';
import * as emberObjectInternals from '@ember/object/internals';
import * as emberService from '@ember/service';

import * as emberTemplate from '@ember/template';
import * as emberTemplateFactory from '@ember/template-factory';
import * as emberTestHelpers from '@ember/test-helpers';
import * as glimmerComponent from '@glimmer/component';
import * as glimmerTracking from '@glimmer/tracking';

import * as viewTransitions from '@cardstack/view-transitions';
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
import * as lodash from 'lodash';
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

import * as hostTestHelpers from '@cardstack/host/tests/helpers';
import * as hostTestHelpersAdapter from '@cardstack/host/tests/helpers/adapter';
import * as hostTestHelpersMockMatrix from '@cardstack/host/tests/helpers/mock-matrix';
import * as hostTestHelpersSetup from '@cardstack/host/tests/helpers/setup';

import { shimHostCommands } from '../commands';

export function shimExternals(virtualNetwork: VirtualNetwork) {
  // Always shim qunit. In test environments, use window.QUnit so realm-loaded
  // test modules register on the same instance the runner will execute. In
  // non-test environments (code mode, card rendering), use a no-op stub so
  // realm cards that colocate test imports don't fail to load — the no-op
  // module() means test callbacks are never invoked outside of test runs.
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
  virtualNetwork.shimModule('@glimmer/component', glimmerComponent);
  virtualNetwork.shimModule('@ember/component', emberComponent);
  virtualNetwork.shimModule(
    '@ember/component/template-only',
    emberComponentTemplateOnly,
  );

  virtualNetwork.shimModule('ember-animated', emberAnimated);
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
  virtualNetwork.shimModule('ember-animated/easings/cosine', eaEasingsCosine);
  virtualNetwork.shimModule('ember-animated/easings/linear', eaEasingsLinear);
  virtualNetwork.shimModule(
    'ember-animated/transitions/fade',
    eaTransitionsFade,
  );
  virtualNetwork.shimModule(
    'ember-animated/transitions/move-over',
    eaTransitionsMoveOver,
  );

  virtualNetwork.shimModule('@cardstack/view-transitions', viewTransitions);

  virtualNetwork.shimModule('ember-css-url', cssUrl);
  virtualNetwork.shimModule('@ember/template-factory', emberTemplateFactory);
  virtualNetwork.shimModule('@ember/template', emberTemplate);
  virtualNetwork.shimModule('@glimmer/tracking', glimmerTracking);
  virtualNetwork.shimModule('@ember/object', emberObject);
  virtualNetwork.shimModule('@ember/object/internals', emberObjectInternals);
  virtualNetwork.shimModule('@ember/service', emberService);
  virtualNetwork.shimModule('@ember/test-helpers', emberTestHelpers);
  virtualNetwork.shimModule(
    '@universal-ember/test-support',
    universalEmberTestSupport,
  );
  virtualNetwork.shimModule('@ember/helper', emberHelper);
  virtualNetwork.shimModule('@ember/modifier', emberModifier);
  virtualNetwork.shimModule(
    'ember-modify-based-class-resource',
    emberModifyClassBasedResource,
  );
  virtualNetwork.shimModule('ember-resources', emberResources);
  virtualNetwork.shimModule('ember-concurrency', emberConcurrency);
  virtualNetwork.shimModule(
    'ember-concurrency/-private/async-arrow-runtime',
    emberConcurrencyAsyncArrowRuntime,
  );

  virtualNetwork.shimModule('ember-modifier', emberModifier2);
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
  virtualNetwork.shimModule('flat', flat);
  virtualNetwork.shimModule('lodash', lodash);
  virtualNetwork.shimModule('tracked-built-ins', tracked);
  virtualNetwork.shimModule('date-fns', dateFns);
  virtualNetwork.shimModule('@ember/destroyable', emberDestroyable);
  virtualNetwork.shimModule('rsvp', rsvp);
  virtualNetwork.shimAsyncModule({
    id: 'ethers',
    resolve: () => import('ethers'),
  });
  virtualNetwork.shimModule('ember-source/types', { default: class {} });
  virtualNetwork.shimModule('ember-source/types/preview', {
    default: class {},
  });
  virtualNetwork.shimModule('super-fast-md5', superFastMD5);
  virtualNetwork.shimModule('matrix-js-sdk', matrixJsSDK);
  virtualNetwork.shimAsyncModule({
    id: 'uuid',
    resolve: () => import('uuid'),
  });
  virtualNetwork.shimModule('awesome-phonenumber', awesomePhoneNumber);

  // Test-only modules so realm cards that colocate tests (importing from
  // @cardstack/host/tests/helpers etc.) can resolve in environments where the
  // host test modules are present. When missing, we throw on access so the
  // error is visible instead of silently hiding it.
  const missingShim = (moduleId: string) =>
    new Proxy(
      {},
      {
        get: () => {
          throw new Error(
            `Missing shim for ${moduleId}. This module is not available in the current environment.`,
          );
        },
      },
    );
  virtualNetwork.shimModule(
    '@cardstack/host/tests/helpers',
    hostTestHelpers ?? missingShim('@cardstack/host/tests/helpers'),
  );
  virtualNetwork.shimModule(
    '@cardstack/host/tests/helpers/mock-matrix',
    hostTestHelpersMockMatrix ??
      missingShim('@cardstack/host/tests/helpers/mock-matrix'),
  );
  virtualNetwork.shimModule(
    '@cardstack/host/tests/helpers/setup',
    hostTestHelpersSetup ?? missingShim('@cardstack/host/tests/helpers/setup'),
  );
  virtualNetwork.shimModule(
    '@cardstack/host/tests/helpers/adapter',
    hostTestHelpersAdapter ??
      missingShim('@cardstack/host/tests/helpers/adapter'),
  );

  // Some realm modules use host-only types or helpers. Provide a safe shim so
  // imports resolve even when the host module isn't present in the build.
  virtualNetwork.shimModule('@cardstack/host/services/store', {
    default: class {},
  });

  shimHostCommands(virtualNetwork);
}
