/* The following modules are made available to cards as external modules.
 * This is paired with the worker/src/externals.ts file which is responsible
 * for compiling the external module stubs into the cards, which consumes the
 * modules in the globalThis.RUNTIME_SPIKE_EXTERNALS Map. Any changes to the
 * globalThis.RUNTIME_SPIKE_EXTERNALS Map should also be reflected in the in the
 * runtime-common/index.js file.
 */

(globalThis as any).RUNTIME_SPIKE_EXTERNALS = new Map();
import * as runtime from "@cardstack/runtime-common";
(globalThis as any).RUNTIME_SPIKE_EXTERNALS.set(
  "@cardstack/runtime-common",
  runtime
);
// import * as glimmerComponent from "@glimmer/component";
(globalThis as any).RUNTIME_SPIKE_EXTERNALS.set("@glimmer/component", {
  default: class {},
});
// import * as emberComponent from "ember-source/dist/packages/@ember/component";
(globalThis as any).RUNTIME_SPIKE_EXTERNALS.set("@ember/component", {
  default: class {},
  setComponentTemplate() {},
});
// import * as emberComponentTemplateOnly from "ember-source/dist/packages/@ember/component/template-only";
(globalThis as any).RUNTIME_SPIKE_EXTERNALS.set(
  "@ember/component/template-only",
  { default() {} }
);
// import * as emberTemplateFactory from "ember-source/dist/packages/@ember/template-factory";
(globalThis as any).RUNTIME_SPIKE_EXTERNALS.set("@ember/template-factory", {
  createTemplateFactory() {},
});
// import * as glimmerTracking from "@glimmer/tracking";
(globalThis as any).RUNTIME_SPIKE_EXTERNALS.set("@glimmer/tracking", {
  tracked() {},
});
// import * as emberObject from "ember-source/dist/packages/@ember/object";
(globalThis as any).RUNTIME_SPIKE_EXTERNALS.set("@ember/object", {
  action() {},
  get() {},
});
// import * as emberHelper from "ember-source/dist/packages/@ember/helper";
(globalThis as any).RUNTIME_SPIKE_EXTERNALS.set("@ember/helper", {
  get() {},
  fn() {},
});
// import * as emberModifier from "ember-source/dist/packages/@ember/modifier";
(globalThis as any).RUNTIME_SPIKE_EXTERNALS.set("@ember/modifier", {
  on() {},
});
// import * as emberDestroyable from "ember-source/dist/packages/@ember/destroyable";
(globalThis as any).RUNTIME_SPIKE_EXTERNALS.set("@ember/destroyable", {
  registerDestructor() {},
});
// import * as emberResources from 'ember-resources';
(globalThis as any).RUNTIME_SPIKE_EXTERNALS.set("ember-resources", {
  Resource: class {},
  useResource() {},
});
// import * as emberConcurrency from 'ember-concurrency';
(globalThis as any).RUNTIME_SPIKE_EXTERNALS.set("ember-concurrency", {
  task() {},
  restartableTask() {},
});
// import * as emberConcurrencyTS from 'ember-concurrency-ts';
(globalThis as any).RUNTIME_SPIKE_EXTERNALS.set("ember-concurrency-ts", {
  taskFor() {},
});
// import * as tracked from "tracked-built-ins";
(globalThis as any).RUNTIME_SPIKE_EXTERNALS.set("tracked-built-ins", {
  // TODO replace with actual TrackedWeakMap when we add real glimmer
  // implementations
  TrackedWeakMap: WeakMap,
});
import * as lodash from "lodash";
(globalThis as any).RUNTIME_SPIKE_EXTERNALS.set("lodash", lodash);
import * as dateFns from "date-fns";
(globalThis as any).RUNTIME_SPIKE_EXTERNALS.set("date-fns", dateFns);
