import type * as Babel from "@babel/core";
import type { types as t } from "@babel/core";
import type { NodePath } from "@babel/traverse";
import { externalsMap, baseRealm } from "@cardstack/runtime-common";
import type { Realm } from "@cardstack/runtime-common/realm";

interface State {
  opts: Options;
  insideCard: boolean;
}

interface Options {
  realm: Realm;
}

export function externalsPlugin(_babel: typeof Babel) {
  // let t = babel.types;
  return {
    visitor: {
      Program: {
        exit(path: NodePath<t.Program>, state: State) {
          let {
            opts: { realm },
          } = state;
          let externalsURL = new URL("/externals/", realm.baseRealmURL);
          for (let topLevelPath of path.get("body")) {
            if (topLevelPath.isImportDeclaration()) {
              if (externalsMap.has(topLevelPath.node.source.value)) {
                // rewrite the external to use the /externals route of the base
                // realm that the realm was configured to talk to
                topLevelPath.node.source.value = `${externalsURL.href}${topLevelPath.node.source.value}`;
              } else if (
                topLevelPath.node.source.value.startsWith(baseRealm.url)
              ) {
                // rewrite the canonical base realm URL's to use the base realm
                // that the realm was configured to talk to
                topLevelPath.node.source.value = `${
                  realm.baseRealmURL
                }${topLevelPath.node.source.value.slice(baseRealm.url.length)}`;
              }
            }
          }
        },
      },
    },
  };
}
