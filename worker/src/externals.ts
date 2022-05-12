import type * as Babel from '@babel/core';
import type { types as t } from '@babel/core';
import type { NodePath } from '@babel/traverse';

/* Any new externally consumed modules should be added here,
 * along with the exports from the modules that are consumed.
 * These exports are paired with the host/app/app.ts which is
 * responsible for loading the external modules and making them
 * available in the window.RUNTIME_SPIKE_EXTERNALS Map. Any changes
 * to the externals below should also be reflected in the
 * host/app/app.ts file.
 */

const externals = new Map([
  ['@glimmer/component', ['default']],
  ['@ember/component', ['setComponentTemplate', 'default']],
  ['@ember/component/template-only', ['default']],
  ['@ember/template-factory', ['createTemplateFactory']],
  ['@glimmer/tracking', ['tracked']],
  ['@ember/object', ['action', 'get']],
  ['@ember/modifier', ['on']],
  [
    'runtime-spike/lib/card-api',
    [
      'contains',
      'containsMany',
      'field',
      'Component',
      'Card',
      'prepareToRender',
    ],
  ],
  ['runtime-spike/lib/string', ['default']],
  ['runtime-spike/lib/text-area', ['default']],
  ['runtime-spike/lib/date', ['default']],
  ['runtime-spike/lib/datetime', ['default']],
  ['runtime-spike/lib/integer', ['default']],
]);

export function generateExternalStub(moduleName: string): Response {
  let names = externals.get(moduleName);
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
              externals.has(topLevelPath.node.source.value)
            ) {
              topLevelPath.node.source.value = `http://externals/${topLevelPath.node.source.value}`;
            }
          }
        },
      },
    },
  };
}
