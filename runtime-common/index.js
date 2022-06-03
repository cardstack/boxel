/* Any new externally consumed modules should be added here,
 * along with the exports from the modules that are consumed.
 * These exports are paired with the host/app/app.ts which is
 * responsible for loading the external modules and making them
 * available in the window.RUNTIME_SPIKE_EXTERNALS Map. Any changes
 * to the externals below should also be reflected in the
 * host/app/app.ts file.
 */

export const externalsMap = new Map([
  ["@glimmer/component", ["default"]],
  ["@ember/component", ["setComponentTemplate", "default"]],
  ["@ember/component/template-only", ["default"]],
  ["@ember/template-factory", ["createTemplateFactory"]],
  ["@glimmer/tracking", ["tracked"]],
  ["@ember/object", ["action", "get"]],
  ["@ember/helper", ["get", "fn"]],
  ["@ember/modifier", ["on"]],
  [
    "runtime-spike/lib/card-api",
    [
      "contains",
      "containsMany",
      "field",
      "Component",
      "Card",
      "prepareToRender",
    ],
  ],
  ["runtime-spike/lib/string", ["default"]],
  ["runtime-spike/lib/text-area", ["default"]],
  ["runtime-spike/lib/date", ["default"]],
  ["runtime-spike/lib/datetime", ["default"]],
  ["runtime-spike/lib/integer", ["default"]],
]);
