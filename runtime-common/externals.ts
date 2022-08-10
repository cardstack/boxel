import type * as Babel from "@babel/core";
import type { types as t } from "@babel/core";
import type { NodePath } from "@babel/traverse";
import { baseRealm, externalsMap } from "@cardstack/runtime-common";
import { Loader } from "./loader";

export function externalsPlugin(_babel: typeof Babel) {
  // let t = babel.types;
  return {
    visitor: {
      Program: {
        exit(path: NodePath<t.Program>) {
          let externalsURL = new URL(
            "/externals/",
            Loader.resolve(baseRealm.url)
          ).href;
          for (let topLevelPath of path.get("body")) {
            if (topLevelPath.isImportDeclaration()) {
              if (externalsMap.has(topLevelPath.node.source.value)) {
                // rewrite the external to use the /externals route of the base
                // realm that the realm was configured to talk to
                topLevelPath.node.source.value = `${externalsURL}${topLevelPath.node.source.value}`;
              } else if (topLevelPath.node.source.value.startsWith("http")) {
                // resolve the import path using the loader
                topLevelPath.node.source.value = Loader.resolve(
                  topLevelPath.node.source.value
                ).href;
              }
            }
          }
        },
      },
    },
  };
}
