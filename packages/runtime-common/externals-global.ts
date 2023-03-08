/* eslint-disable @typescript-eslint/no-empty-function */

import { Loader } from './loader';

// Note: even though cards are only run in the host context (via fastboot), we
// still use these stubs because we deserialize cards in the server which means
// that the card module is imported, and these externals are seen by the
// card-api that the card modules depend on. Might be worth auditing all the
// places where server deserialization happens to see if its really necessary.

import * as runtime from './index';
import * as boxelUI from '@cardstack/boxel-ui';
import * as flat from 'flat';
import * as lodash from 'lodash';
import * as dateFns from 'date-fns';

export function shimExternals(loader: Loader = Loader.getLoader()) {
  loader.shimModule('@cardstack/runtime-common', runtime);
  loader.shimModule('@cardstack/boxel-ui', boxelUI);
  // import * as boxelPickHelper from "@cardstack/boxel-ui/helpers/pick";
  loader.shimModule('@cardstack/boxel-ui/helpers/pick', {
    default() {},
  });
  // import * as boxelTruthHelpers from "@cardstack/boxel-ui/helpers/truth-helpers";
  loader.shimModule('@cardstack/boxel-ui/helpers/truth-helpers', {
    eq() {},
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
  });
  // import * as emberConcurrency from 'ember-concurrency';
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
}

shimExternals();
