import type * as Babel from '@babel/core';
import type { types as t } from '@babel/core';
import type { NodePath } from '@babel/traverse';

const externals = new Map([
  ['@glimmer/component', ['default']],
  ['@ember/component', ['setComponentTemplate', 'default']],
  ['@ember/template-factory', ['createTemplateFactory']],
]);

export function generateExternalStub(moduleName: string): Response {
  let names = externals.get(moduleName);
  if (!names) {
    return new Response(`unknown external module ${moduleName}`, {
      status: 404,
    });
  }
  let src = [`const m = window.require('${moduleName}');`];

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

export function externalsPlugin(babel: typeof Babel) {
  let t = babel.types;
  return {
    visitor: {
      ImportDeclaration(path: NodePath<t.ImportDeclaration>) {
        if (externals.has(path.node.source.value)) {
          path.node.source.value = `http://externals/${path.node.source.value}`;
        }
      },
    },
  };
}
