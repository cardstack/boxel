import type * as Babel from '@babel/core';
import type { types as t } from '@babel/core';
import type { NodePath } from '@babel/traverse';
import { externalsMap } from '@cardstack/runtime-common';

export function generateExternalStub(moduleName: string): Response {
  let names = externalsMap.get(moduleName);
  if (!names) {
    return new Response(`unknown external module ${moduleName}`, {
      status: 404,
    });
  }
  let src = [`const m = window.RUNTIME_SPIKE_EXTERNALS.get('${moduleName}');`];

  for (let name of names) {
    if (name === 'default') {
      src.push(`export default m.default;`);
    } else {
      src.push(`export const ${name} = m.${name};`);
    }
  }

  return new Response(src.join('\n'), {
    headers: { 'content-type': 'text/javascript' },
  });
}

export function externalsPlugin(_babel: typeof Babel) {
  // let t = babel.types;
  return {
    visitor: {
      Program: {
        exit(path: NodePath<t.Program>) {
          for (let topLevelPath of path.get('body')) {
            if (
              topLevelPath.isImportDeclaration() &&
              externalsMap.has(topLevelPath.node.source.value)
            ) {
              topLevelPath.node.source.value = `http://externals/${topLevelPath.node.source.value}`;
            }
          }
        },
      },
    },
  };
}
