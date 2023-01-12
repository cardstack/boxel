/* The following modules are made available to cards as external modules.
 * This is paired with the worker/src/externals.ts file which is responsible
 * for compiling the external module stubs into the cards, which consumes the
 * modules in the globalThis.RUNTIME_SPIKE_EXTERNALS Map. Any changes to the
 * globalThis.RUNTIME_SPIKE_EXTERNALS Map should also be reflected in the in the
 * runtime-common/index.js file.
 */

// Note: even though cards are only run in the host context (via fastboot), we
// still use these stubs because we deserialize cards in the server which means
// that the card module is imported, and these externals are seen by the
// card-api that the card modules depend on. Might be worth auditing all the
// places where server deserialization happens to see if its really necessary.

(globalThis as any).RUNTIME_SPIKE_EXTERNALS = new Map();
import * as runtime from "./index";
(globalThis as any).RUNTIME_SPIKE_EXTERNALS.set(
  "@cardstack/runtime-common",
  runtime
);
import * as boxelUI from "@cardstack/boxel-ui";
(globalThis as any).RUNTIME_SPIKE_EXTERNALS.set("@cardstack/boxel-ui", boxelUI);
// import * as attachStyles from "@cardstack/boxel-ui/attach-styles";
(globalThis as any).RUNTIME_SPIKE_EXTERNALS.set(
  "@cardstack/boxel-ui/attach-styles",
  {
    attachStyles() {},
    initStyleSheet() {},
  }
);
// import * as boxelPickHelper from "@cardstack/boxel-ui/helpers/pick";
(globalThis as any).RUNTIME_SPIKE_EXTERNALS.set(
  "@cardstack/boxel-ui/helpers/pick",
  {
    default() {},
  }
);
// import * as boxelTruthHelpers from "@cardstack/boxel-ui/helpers/truth-helpers";
(globalThis as any).RUNTIME_SPIKE_EXTERNALS.set(
  "@cardstack/boxel-ui/helpers/truth-helpers",
  {
    eq() {},
  }
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
// import * as emberObjectInternals from "ember-source/dist/packages/@ember/object/internals";
(globalThis as any).RUNTIME_SPIKE_EXTERNALS.set("@ember/object/internals", {
  guidFor() {},
});
// import * as emberHelper from "ember-source/dist/packages/@ember/helper";
(globalThis as any).RUNTIME_SPIKE_EXTERNALS.set("@ember/helper", {
  get() {},
  fn() {},
  concat() {},
});
// import * as emberModifier from "ember-source/dist/packages/@ember/modifier";
(globalThis as any).RUNTIME_SPIKE_EXTERNALS.set("@ember/modifier", {
  on() {},
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
// import * as emberConcurrency from 'ember-concurrency';
(globalThis as any).RUNTIME_SPIKE_EXTERNALS.set("ember-modifier", {
  default: class {},
  modifier: () => {},
});
import * as flat from "flat";
(globalThis as any).RUNTIME_SPIKE_EXTERNALS.set("flat", flat);
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
