import { Loader } from '@cardstack/runtime-common/loader';

import * as runtime from '@cardstack/runtime-common';
import * as boxelMotion from '@cardstack/boxel-motion';
import * as boxelUI from '@cardstack/boxel-ui';
import * as boxelSvgJar from '@cardstack/boxel-ui/helpers/svg-jar';
import * as boxelPickHelper from '@cardstack/boxel-ui/helpers/pick';
import * as boxelTruthHelpers from '@cardstack/boxel-ui/helpers/truth-helpers';
import * as glimmerComponent from '@glimmer/component';
import * as emberComponent from '@ember/component';
import * as emberComponentTemplateOnly from '@ember/component/template-only';
//@ts-ignore no types available
import * as emberTemplateFactory from '@ember/template-factory';
import * as glimmerTracking from '@glimmer/tracking';
import * as emberObject from '@ember/object';
import * as emberObjectInternals from '@ember/object/internals';
import * as emberHelper from '@ember/helper';
import * as emberModifier from '@ember/modifier';
import * as emberResources from 'ember-resources';
import * as emberConcurrency from 'ember-concurrency';
//@ts-ignore no types available
import * as emberConcurrencyAsyncArrowRuntime from 'ember-concurrency/-private/async-arrow-runtime';
import * as emberModifier2 from 'ember-modifier';
import * as flat from 'flat';
import * as lodash from 'lodash';
import * as tracked from 'tracked-built-ins';
import * as dateFns from 'date-fns';
import * as emberResourcesCore from 'ember-resources/core';
import * as emberDestroyable from '@ember/destroyable';
import * as marked from 'marked';

export function shimExternals(loader: Loader = Loader.getLoader()) {
  loader.shimModule('@cardstack/runtime-common', runtime);
  loader.shimModule('@cardstack/boxel-motion', boxelMotion);
  loader.shimModule('@cardstack/boxel-ui', boxelUI);
  loader.shimModule('@cardstack/boxel-ui/helpers/svg-jar', boxelSvgJar);
  loader.shimModule('@cardstack/boxel-ui/helpers/pick', boxelPickHelper);
  loader.shimModule(
    '@cardstack/boxel-ui/helpers/truth-helpers',
    boxelTruthHelpers
  );
  loader.shimModule('@glimmer/component', glimmerComponent);
  loader.shimModule('@ember/component', emberComponent);
  loader.shimModule(
    '@ember/component/template-only',
    emberComponentTemplateOnly
  );
  loader.shimModule('@ember/template-factory', emberTemplateFactory);
  loader.shimModule('@glimmer/tracking', glimmerTracking);
  loader.shimModule('@ember/object', emberObject);
  loader.shimModule('@ember/object/internals', emberObjectInternals);
  loader.shimModule('@ember/helper', emberHelper);
  loader.shimModule('@ember/modifier', emberModifier);
  loader.shimModule('ember-resources', emberResources);
  loader.shimModule('ember-concurrency', emberConcurrency);
  loader.shimModule(
    'ember-concurrency/-private/async-arrow-runtime',
    emberConcurrencyAsyncArrowRuntime
  );
  loader.shimModule('ember-modifier', emberModifier2);
  loader.shimModule('flat', flat);
  loader.shimModule('lodash', lodash);
  loader.shimModule('tracked-built-ins', tracked);
  loader.shimModule('date-fns', dateFns);
  loader.shimModule('ember-resources/core', emberResourcesCore);
  loader.shimModule('@ember/destroyable', emberDestroyable);
  loader.shimModule('marked', marked);
}

shimExternals();
