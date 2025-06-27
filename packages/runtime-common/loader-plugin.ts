import type * as Babel from '@babel/core';
import type { types as t } from '@babel/core';
import type { NodePath } from '@babel/traverse';

export function loaderPlugin(babel: typeof Babel) {
  let t = babel.types;

  function createLoaderImportCall(
    args: (t.Expression | t.SpreadElement | t.ArgumentPlaceholder)[],
  ): t.CallExpression {
    const firstArg = args[0];

    // Only process if first argument is an Expression (not SpreadElement or ArgumentPlaceholder)
    if (!t.isExpression(firstArg)) {
      throw new Error(
        'Dynamic import with spread or placeholder arguments is not supported',
      );
    }

    // Always wrap in new URL() - it handles both relative and absolute URLs
    const urlConstructor = t.newExpression(t.identifier('URL'), [
      firstArg,
      t.memberExpression(
        t.metaProperty(t.identifier('import'), t.identifier('meta')),
        t.identifier('url'),
      ),
    ]);

    const hrefAccess = t.memberExpression(urlConstructor, t.identifier('href'));

    return t.callExpression(
      t.memberExpression(
        t.memberExpression(
          t.metaProperty(t.identifier('import'), t.identifier('meta')),
          t.identifier('loader'),
        ),
        t.identifier('import'),
      ),
      [hrefAccess, ...args.slice(1).filter((arg) => t.isExpression(arg))], // Filter out non-Expression arguments
    );
  }

  return {
    visitor: {
      CallExpression(path: NodePath<t.CallExpression>) {
        let callee = path.get('callee');
        if (callee.node.type === 'Identifier' && callee.node.name === 'fetch') {
          // fetch() => import.meta.loader.fetch()
          callee.replaceWith(
            t.memberExpression(
              t.memberExpression(
                t.metaProperty(t.identifier('import'), t.identifier('meta')),
                t.identifier('loader'),
              ),
              t.identifier('fetch'),
            ),
          );
        } else if (callee.node.type === 'Import') {
          // import('./x') => import.meta.loader.import(new URL('./x', import.meta.url).href)
          path.replaceWith(createLoaderImportCall(path.node.arguments));
        }
      },
    },
  };
}
