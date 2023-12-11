import * as emberComponent from '@ember/component';
import * as emberComponentTemplateOnly from '@ember/component/template-only';
import * as emberDestroyable from '@ember/destroyable';
import * as emberHelper from '@ember/helper';
import * as emberModifier from '@ember/modifier';
import * as emberObject from '@ember/object';
import * as emberObjectInternals from '@ember/object/internals';
import * as emberTemplate from '@ember/template';
//@ts-expect-error
import * as emberTemplateFactory from '@ember/template-factory';
import * as glimmerComponent from '@glimmer/component';
//@ts-ignore no types available
import * as glimmerTracking from '@glimmer/tracking';

import * as dateFns from 'date-fns';
import * as emberConcurrency from 'ember-concurrency';
//@ts-ignore no types available
import * as emberConcurrencyAsyncArrowRuntime from 'ember-concurrency/-private/async-arrow-runtime';
//@ts-ignore no types available
import * as emberModifier2 from 'ember-modifier';
import * as emberResources from 'ember-resources';
import * as ethers from 'ethers';
import * as flat from 'flat';
import * as lodash from 'lodash';
import * as marked from 'marked';
import * as tracked from 'tracked-built-ins';

import * as boxelUiComponents from '@cardstack/boxel-ui/components';
import * as boxelUiHelpers from '@cardstack/boxel-ui/helpers';
import * as boxelUiIcons from '@cardstack/boxel-ui/icons';

import * as runtime from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';

export function shimExternals(loader: Loader) {
  loader.shimModule('@cardstack/runtime-common', runtime);
  loader.shimModule('@cardstack/boxel-ui/components', boxelUiComponents);
  loader.shimModule('@cardstack/boxel-ui/helpers', boxelUiHelpers);
  loader.shimModule('@cardstack/boxel-ui/icons', boxelUiIcons);
  loader.shimModule('@glimmer/component', glimmerComponent);
  loader.shimModule('@ember/component', emberComponent);
  loader.shimModule(
    '@ember/component/template-only',
    emberComponentTemplateOnly,
  );
  loader.shimModule('@ember/template-factory', emberTemplateFactory);
  loader.shimModule('@ember/template', emberTemplate);
  loader.shimModule('@glimmer/tracking', glimmerTracking);
  loader.shimModule('@ember/object', emberObject);
  loader.shimModule('@ember/object/internals', emberObjectInternals);
  loader.shimModule('@ember/helper', emberHelper);
  loader.shimModule('@ember/modifier', emberModifier);
  loader.shimModule('ember-resources', emberResources);
  loader.shimModule('ember-concurrency', emberConcurrency);
  loader.shimModule(
    'ember-concurrency/-private/async-arrow-runtime',
    emberConcurrencyAsyncArrowRuntime,
  );
  loader.shimModule('ember-modifier', emberModifier2);
  loader.shimModule('flat', flat);
  loader.shimModule('lodash', lodash);
  loader.shimModule('tracked-built-ins', tracked);
  loader.shimModule('date-fns', dateFns);
  loader.shimModule('@ember/destroyable', emberDestroyable);
  loader.shimModule('marked', marked);
  loader.shimModule('ethers', ethers);
  loader.shimModule('ember-source/types', { default: class {} });
  loader.shimModule('ember-source/types/preview', { default: class {} });
}
