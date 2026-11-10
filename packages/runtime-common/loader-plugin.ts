import type * as Babel from '@babel/core';
import type { types as t } from '@babel/core';
import type { NodePath } from '@babel/traverse';

// Whether a module specifier is resolved against the importing module's URL
// (a relative path or an absolute URL) rather than looked up as written (a
// bare specifier). The `import()` rewrite below and the Loader's
// `import.meta.resolve` both decide with this, so the two resolve a specifier
// the same way.
export function isPathLike(value: string): boolean {
  return (
    value.startsWith('./') ||
    value.startsWith('../') ||
    value.startsWith('/') ||
    value.includes('://')
  );
}

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

    let processedFirstArg: t.Expression;

    // If it's a string literal and looks like a path/URL, wrap in new URL()
    if (t.isStringLiteral(firstArg) && isPathLike(firstArg.value)) {
      const urlConstructor = t.newExpression(t.identifier('URL'), [
        firstArg,
        t.memberExpression(
          t.metaProperty(t.identifier('import'), t.identifier('meta')),
          t.identifier('url'),
        ),
      ]);

      processedFirstArg = t.memberExpression(
        urlConstructor,
        t.identifier('href'),
      );
    } else {
      // For module specifiers or non-string literals, use as-is
      processedFirstArg = firstArg;
    }

    return t.callExpression(
      t.memberExpression(
        t.memberExpression(
          t.metaProperty(t.identifier('import'), t.identifier('meta')),
          t.identifier('loader'),
        ),
        t.identifier('import'),
      ),
      [
        processedFirstArg,
        ...args.slice(1).filter((arg) => t.isExpression(arg)),
      ], // Filter out non-Expression arguments
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
          // for URL like arguments
          // import('./x') => import.meta.loader.import(new URL('./x', import.meta.url).href)
          // for module specifiers
          // import('lodash') => import.meta.loader.import('lodash')
          path.replaceWith(createLoaderImportCall(path.node.arguments));
        }
      },
    },
  };
}
