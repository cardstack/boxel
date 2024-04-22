/* eslint-disable @typescript-eslint/no-empty-function */
import * as runtime from '@cardstack/runtime-common';
import * as flat from 'flat';
import * as lodash from 'lodash';
import * as dateFns from 'date-fns';
import * as ethers from 'ethers';
import { VirtualNetwork } from '@cardstack/runtime-common';

export function shimExternals(virtualNetwork: VirtualNetwork) {
  virtualNetwork.shimModule('@cardstack/runtime-common', runtime);
  virtualNetwork.shimModule('@cardstack/boxel-ui/components', {
    Button() {},
  });
  virtualNetwork.shimModule('@cardstack/boxel-ui/helpers', {
    cssVar() {},
    eq() {},
  });
  virtualNetwork.shimModule('@cardstack/boxel-ui/icons', {
    default() {},
  });
  // import * as glimmerComponent from "@glimmer/component";
  virtualNetwork.shimModule('@glimmer/component', {
    default: class {},
  });
  // import * as emberComponent from "ember-source/dist/packages/@ember/component";
  virtualNetwork.shimModule('@ember/component', {
    default: class {},
    setComponentTemplate() {},
  });
  // import * as emberComponentTemplateOnly from "ember-source/dist/packages/@ember/component/template-only";
  virtualNetwork.shimModule('@ember/component/template-only', { default() {} });
  // import * as emberTemplateFactory from "ember-source/dist/packages/@ember/template-factory";
  virtualNetwork.shimModule('@ember/template-factory', {
    createTemplateFactory() {},
  });
  // import * as emberTemplate from "ember-source/dist/packages/@ember/template";
  virtualNetwork.shimModule('@ember/template', {
    htmlSafe(html: string) {
      return html;
    },
  });
  // import * as cssUrl from 'ember-css-url';
  virtualNetwork.shimModule('ember-css-url', {
    default: () => {},
  });
  // import * as glimmerTracking from "@glimmer/tracking";
  virtualNetwork.shimModule('@glimmer/tracking', {
    tracked() {},
  });
  // import * as emberObject from "ember-source/dist/packages/@ember/object";
  virtualNetwork.shimModule('@ember/object', {
    action() {},
    get() {},
  });
  // import * as emberObjectInternals from "ember-source/dist/packages/@ember/object/internals";
  virtualNetwork.shimModule('@ember/object/internals', {
    guidFor() {},
  });
  // import * as emberHelper from "ember-source/dist/packages/@ember/helper";
  virtualNetwork.shimModule('@ember/helper', {
    get() {},
    fn() {},
    concat() {},
  });
  // import * as emberModifier from "ember-source/dist/packages/@ember/modifier";
  virtualNetwork.shimModule('@ember/modifier', {
    on() {},
  });
  // import * as emberResources from 'ember-resources';
  virtualNetwork.shimModule('ember-resources', {
    Resource: class {},
    useResource() {},
  });
  // import * as emberConcurrency from 'ember-concurrency';
  virtualNetwork.shimModule('ember-concurrency', {
    task() {},
    restartableTask() {},
  });
  virtualNetwork.shimModule('ember-provide-consume-context', {
    consume() {
      return () => {};
    },
    provide() {
      return () => {};
    },
  });
  // import * as emberConcurrencyAsyncArrowRuntime from 'ember-concurrency/-private/async-arrow-runtime';
  virtualNetwork.shimModule('ember-concurrency/-private/async-arrow-runtime', {
    default: () => {},
    buildTask: () => {},
  });
  // import * as emberModifier from 'ember-modifier';
  virtualNetwork.shimModule('ember-modifier', {
    default: class {},
    modifier: () => {},
  });
  virtualNetwork.shimModule('flat', flat);
  // import * as tracked from "tracked-built-ins";
  virtualNetwork.shimModule('tracked-built-ins', {
    // TODO replace with actual TrackedWeakMap when we add real glimmer
    // implementations
    TrackedWeakMap: WeakMap,
  });
  virtualNetwork.shimModule('lodash', lodash);
  virtualNetwork.shimModule('date-fns', dateFns);
  virtualNetwork.shimModule('ember-resources', { Resource: class {} });
  virtualNetwork.shimModule('@ember/destroyable', {});
  virtualNetwork.shimModule('marked', { marked: () => {} });
  virtualNetwork.shimModule('ethers', ethers);
  virtualNetwork.shimModule('super-fast-md5', { md5: (_data: string) => {} });
}
