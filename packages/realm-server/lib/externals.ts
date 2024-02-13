/* eslint-disable @typescript-eslint/no-empty-function */
import { Loader } from '@cardstack/runtime-common/loader';

import * as runtime from '@cardstack/runtime-common';
import * as flat from 'flat';
import * as lodash from 'lodash';
import * as dateFns from 'date-fns';
import * as ethers from 'ethers';

export function shimExternals(loader: Loader) {
  loader.shimModule('@cardstack/runtime-common', runtime);
  loader.shimModule('@cardstack/boxel-ui/components', {
    Button() {},
  });
  loader.shimModule('@cardstack/boxel-ui/helpers', {
    cssVar() {},
    eq() {},
  });
  loader.shimModule('@cardstack/boxel-ui/icons', {
    default() {},
  });
  // import * as glimmerComponent from "@glimmer/component";
  loader.shimModule('@glimmer/component', {
    default: class {},
  });
  // import * as emberComponent from "ember-source/dist/packages/@ember/component";
  loader.shimModule('@ember/component', {
    default: class {},
    setComponentTemplate() {},
  });
  // import * as emberComponentTemplateOnly from "ember-source/dist/packages/@ember/component/template-only";
  loader.shimModule('@ember/component/template-only', { default() {} });
  // import * as emberTemplateFactory from "ember-source/dist/packages/@ember/template-factory";
  loader.shimModule('@ember/template-factory', {
    createTemplateFactory() {},
  });
  // import * as emberTemplate from "ember-source/dist/packages/@ember/template";
  loader.shimModule('@ember/template', {
    htmlSafe(html: string) {
      return html;
    },
  });
  // import * as cssUrl from 'ember-css-url';
  loader.shimModule('ember-css-url', {
    default: () => {},
  });
  // import * as glimmerTracking from "@glimmer/tracking";
  loader.shimModule('@glimmer/tracking', {
    tracked() {},
  });
  // import * as emberObject from "ember-source/dist/packages/@ember/object";
  loader.shimModule('@ember/object', {
    action() {},
    get() {},
  });
  // import * as emberObjectInternals from "ember-source/dist/packages/@ember/object/internals";
  loader.shimModule('@ember/object/internals', {
    guidFor() {},
  });
  // import * as emberHelper from "ember-source/dist/packages/@ember/helper";
  loader.shimModule('@ember/helper', {
    get() {},
    fn() {},
    concat() {},
  });
  // import * as emberModifier from "ember-source/dist/packages/@ember/modifier";
  loader.shimModule('@ember/modifier', {
    on() {},
  });
  // import * as emberResources from 'ember-resources';
  loader.shimModule('ember-resources', {
    Resource: class {},
    useResource() {},
  });
  // import * as emberConcurrency from 'ember-concurrency';
  loader.shimModule('ember-concurrency', {
    task() {},
    restartableTask() {},
  });
  // import * as emberConcurrencyAsyncArrowRuntime from 'ember-concurrency/-private/async-arrow-runtime';
  loader.shimModule('ember-concurrency/-private/async-arrow-runtime', {
    default: () => {},
    buildTask: () => {},
  });
  // import * as emberModifier from 'ember-modifier';
  loader.shimModule('ember-modifier', {
    default: class {},
    modifier: () => {},
  });
  loader.shimModule('flat', flat);
  // import * as tracked from "tracked-built-ins";
  loader.shimModule('tracked-built-ins', {
    // TODO replace with actual TrackedWeakMap when we add real glimmer
    // implementations
    TrackedWeakMap: WeakMap,
  });
  loader.shimModule('lodash', lodash);
  loader.shimModule('date-fns', dateFns);
  loader.shimModule('ember-resources', { Resource: class {} });
  loader.shimModule('@ember/destroyable', {});
  loader.shimModule('marked', { marked: () => {} });
  loader.shimModule('ethers', ethers);
}
