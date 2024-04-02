import * as emberComponent from '@ember/component';
import * as emberComponentTemplateOnly from '@ember/component/template-only';
import * as emberDestroyable from '@ember/destroyable';
import * as emberHelper from '@ember/helper';
import * as emberModifier from '@ember/modifier';
import * as emberObject from '@ember/object';
import * as emberObjectInternals from '@ember/object/internals';
import * as emberTemplate from '@ember/template';
import * as emberTemplateFactory from '@ember/template-factory';
import * as glimmerComponent from '@glimmer/component';
import * as glimmerTracking from '@glimmer/tracking';

import * as dateFns from 'date-fns';
import * as emberConcurrency from 'ember-concurrency';
//@ts-expect-error no types available
import * as emberConcurrencyAsyncArrowRuntime from 'ember-concurrency/-private/async-arrow-runtime';
import * as cssUrl from 'ember-css-url';
import * as emberModifier2 from 'ember-modifier';
import * as emberResources from 'ember-resources';
import * as ethers from 'ethers';
import * as flat from 'flat';
import * as lodash from 'lodash';
import * as tracked from 'tracked-built-ins';

import * as boxelUiComponents from '@cardstack/boxel-ui/components';
import * as boxelUiHelpers from '@cardstack/boxel-ui/helpers';
import * as boxelUiIcons from '@cardstack/boxel-ui/icons';

import * as runtime from '@cardstack/runtime-common';
import { VirtualNetwork } from '@cardstack/runtime-common';

export function shimExternals(virtualNetwork: VirtualNetwork) {
  virtualNetwork.shimModule('@cardstack/runtime-common', runtime);
  virtualNetwork.shimModule(
    '@cardstack/boxel-ui/components',
    boxelUiComponents,
  );
  virtualNetwork.shimModule('@cardstack/boxel-ui/helpers', boxelUiHelpers);
  virtualNetwork.shimModule('@cardstack/boxel-ui/icons', boxelUiIcons);
  virtualNetwork.shimModule('@glimmer/component', glimmerComponent);
  virtualNetwork.shimModule('@ember/component', emberComponent);
  virtualNetwork.shimModule(
    '@ember/component/template-only',
    emberComponentTemplateOnly,
  );
  virtualNetwork.shimModule('ember-css-url', cssUrl);
  virtualNetwork.shimModule('@ember/template-factory', emberTemplateFactory);
  virtualNetwork.shimModule('@ember/template', emberTemplate);
  virtualNetwork.shimModule('@glimmer/tracking', glimmerTracking);
  virtualNetwork.shimModule('@ember/object', emberObject);
  virtualNetwork.shimModule('@ember/object/internals', emberObjectInternals);
  virtualNetwork.shimModule('@ember/helper', emberHelper);
  virtualNetwork.shimModule('@ember/modifier', emberModifier);
  virtualNetwork.shimModule('ember-resources', emberResources);
  virtualNetwork.shimModule('ember-concurrency', emberConcurrency);
  virtualNetwork.shimModule(
    'ember-concurrency/-private/async-arrow-runtime',
    emberConcurrencyAsyncArrowRuntime,
  );
  virtualNetwork.shimModule('ember-modifier', emberModifier2);
  virtualNetwork.shimModule('flat', flat);
  virtualNetwork.shimModule('lodash', lodash);
  virtualNetwork.shimModule('tracked-built-ins', tracked);
  virtualNetwork.shimModule('date-fns', dateFns);
  virtualNetwork.shimModule('@ember/destroyable', emberDestroyable);
  virtualNetwork.shimModule('ethers', ethers);
  virtualNetwork.shimModule('ember-source/types', { default: class {} });
  virtualNetwork.shimModule('ember-source/types/preview', {
    default: class {},
  });
}
