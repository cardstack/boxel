import Application from '@ember/application';
import Resolver from 'ember-resolver';
import loadInitializers from 'ember-load-initializers';
import config from 'runtime-spike/config/environment';
import './lib/glint-embroider-workaround';

/* The following modules are made available to cards as external modules.
 * This is paired with the worker/src/externals.ts file which is responsible
 * for compiling the external module stubs into the cards, which consumes the
 * modules in the window.RUNTIME_SPIKE_EXTERNALS Map. Any changes to the
 * window.RUNTIME_SPIKE_EXTERNALS Map should also be reflected in the in the
 * runtime-common/index.js file.
 */

// TODO eventually we should replace this with
//   import "@cardstack/runtime-common/external-globals";
// when our common external-globals can support glimmer
(window as any).RUNTIME_SPIKE_EXTERNALS = new Map();
import * as glimmerComponent from '@glimmer/component';
(window as any).RUNTIME_SPIKE_EXTERNALS.set(
  '@glimmer/component',
  glimmerComponent
);
import * as emberComponent from '@ember/component';
(window as any).RUNTIME_SPIKE_EXTERNALS.set('@ember/component', emberComponent);
import * as emberComponentTemplateOnly from '@ember/component/template-only';
(window as any).RUNTIME_SPIKE_EXTERNALS.set(
  '@ember/component/template-only',
  emberComponentTemplateOnly
);
//@ts-ignore no types available
import * as emberTemplateFactory from '@ember/template-factory';
(window as any).RUNTIME_SPIKE_EXTERNALS.set(
  '@ember/template-factory',
  emberTemplateFactory
);
import * as glimmerTracking from '@glimmer/tracking';
(window as any).RUNTIME_SPIKE_EXTERNALS.set(
  '@glimmer/tracking',
  glimmerTracking
);
import * as emberObject from '@ember/object';
(window as any).RUNTIME_SPIKE_EXTERNALS.set('@ember/object', emberObject);
import * as emberHelper from '@ember/helper';
(window as any).RUNTIME_SPIKE_EXTERNALS.set('@ember/helper', emberHelper);
import * as emberModifier from '@ember/modifier';
(window as any).RUNTIME_SPIKE_EXTERNALS.set('@ember/modifier', emberModifier);
import * as emberDestroyable from '@ember/destroyable';
(window as any).RUNTIME_SPIKE_EXTERNALS.set(
  '@ember/destroyable',
  emberDestroyable
);
import * as lodash from 'lodash';
(window as any).RUNTIME_SPIKE_EXTERNALS.set('lodash', lodash);
import * as tracked from 'tracked-built-ins';
(window as any).RUNTIME_SPIKE_EXTERNALS.set('tracked-built-ins', tracked);
import * as dateFns from 'date-fns';
(window as any).RUNTIME_SPIKE_EXTERNALS.set('date-fns', dateFns);

export default class App extends Application {
  modulePrefix = config.modulePrefix;
  podModulePrefix = config.podModulePrefix;
  Resolver = Resolver;
}

loadInitializers(App, config.modulePrefix);
