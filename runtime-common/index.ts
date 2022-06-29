export interface CardJSON {
  data: {
    attributes?: Record<string, any>;
    // TODO add relationships
    meta: {
      adoptsFrom: {
        module: string;
        name: string;
      };
    };
  };
  // TODO add included
}

export { Deferred } from "./deferred";

export interface ResourceObject {
  type: string;
  attributes?: Record<string, any>;
  relationships?: Record<string, any>;
  meta?: Record<string, any>;
}

export interface ResourceObjectWithId extends ResourceObject {
  id: string;
}

export interface DirectoryEntryRelationship {
  links: {
    related: string;
  };
  meta: {
    kind: "directory" | "file";
  };
}
export const protocolRelativeBaseOrigin = "//cardstack.com";
export const baseOrigin = `http:${protocolRelativeBaseOrigin}`;

export const executableExtensions = [".js", ".gjs", ".ts", ".gts"];

/* Any new externally consumed modules should be added here,
 * along with the exports from the modules that are consumed.
 * These exports are paired with the host/app/app.ts which is
 * responsible for loading the external modules and making them
 * available in the window.RUNTIME_SPIKE_EXTERNALS Map. Any changes
 * to the externals below should also be reflected in the
 * host/app/app.ts file.
 */

export const externalsMap: Map<string, string[]> = new Map([
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

export function isCardJSON(json: any): json is CardJSON {
  if (typeof json !== "object" || !("data" in json)) {
    return false;
  }
  let { data } = json;
  if (typeof data !== "object") {
    return false;
  }

  let { meta, attributes } = data;
  if (
    typeof meta !== "object" ||
    ("attributes" in data && typeof attributes !== "object")
  ) {
    return false;
  }

  if (!("adoptsFrom" in meta)) {
    return false;
  }

  let { adoptsFrom } = meta;
  if (typeof adoptsFrom !== "object") {
    return false;
  }
  if (!("module" in adoptsFrom) || !("name" in adoptsFrom)) {
    return false;
  }

  let { module, name } = adoptsFrom;
  return typeof module === "string" && typeof name === "string";
}

export { Realm, Kind } from "./realm";
