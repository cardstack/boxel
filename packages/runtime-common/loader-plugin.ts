import type * as Babel from '@babel/core';
import type { types as t } from '@babel/core';
import type { NodePath } from '@babel/traverse';

// The own property an exported class or function carries to name the module
// that declares it, as `{ module, name }`. A module that only re-exports a
// binding marks nothing, so the mark names the declarer whichever module
// exposing the binding is loaded first. Non-enumerable and keyed by a symbol,
// so nothing that lists a class's own keys sees it.
export const MODULE_PROVENANCE = Symbol.for('module-provenance');

export interface ModuleProvenance {
  module: string;
  name: string;
}

// Read through `hasOwnProperty`: a subclass inherits its parent's statics,
// and with them the parent's mark, which does not name the subclass.
export function moduleProvenanceOf(
  value: unknown,
): ModuleProvenance | undefined {
  if (
    typeof value === 'function' &&
    Object.prototype.hasOwnProperty.call(value, MODULE_PROVENANCE)
  ) {
    return (value as unknown as Record<symbol, ModuleProvenance>)[
      MODULE_PROVENANCE
    ];
  }
  return undefined;
}

export interface ModuleProvenanceOptions {
  // The module the marks name. Without it a mark names `import.meta.url`,
  // which is how a module names itself; a build that puts the module in a
  // chunk, where `import.meta.url` is the chunk's, names it here instead.
  moduleIdentifier?: string;
}

// Marks each class or function a module declares and exports with the module
// and the name it is exported under. Runs on `Program` exit, after the
// TypeScript transform has removed type-only exports.
//
// Only a binding this module declares is marked. `import { X } from './y';
// export { X }` and `export { X } from './y'` mark nothing: `./y` declares X,
// and marks it itself. A binding exported under more than one name is marked
// with the name that sorts first, which is the first key of the module's
// namespace.
//
// The mark is set only when the value has none yet, so when a declaration
// holds a value another module declared (`export const A = ImportedClass`),
// the declarer's mark — set as it was evaluated, which is first — stands.
export function moduleProvenancePlugin(
  babel: typeof Babel,
  options: ModuleProvenanceOptions = {},
) {
  return {
    visitor: {
      Program: {
        exit(path: NodePath<t.Program>) {
          markDeclaredExports(babel, path, options);
        },
      },
    },
  };
}

function markDeclaredExports(
  babel: typeof Babel,
  program: NodePath<t.Program>,
  options: ModuleProvenanceOptions,
) {
  let t = babel.types;
  // local binding → every name it is exported under
  let exposedNames = new Map<string, string[]>();
  let record = (local: string, exposed: string) => {
    let names = exposedNames.get(local) ?? [];
    names.push(exposed);
    exposedNames.set(local, names);
  };

  for (let statement of program.node.body) {
    if (t.isExportNamedDeclaration(statement)) {
      if (statement.source || statement.exportKind === 'type') {
        continue;
      }
      if (statement.declaration) {
        for (let name of Object.keys(
          t.getOuterBindingIdentifiers(statement.declaration),
        )) {
          record(name, name);
        }
      }
      for (let specifier of statement.specifiers) {
        if (
          !t.isExportSpecifier(specifier) ||
          specifier.exportKind === 'type'
        ) {
          continue;
        }
        record(
          specifier.local.name,
          t.isIdentifier(specifier.exported)
            ? specifier.exported.name
            : specifier.exported.value,
        );
      }
    } else if (t.isExportDefaultDeclaration(statement)) {
      let declaration = statement.declaration;
      if (
        (t.isClassDeclaration(declaration) ||
          t.isFunctionDeclaration(declaration)) &&
        declaration.id
      ) {
        record(declaration.id.name, 'default');
      } else if (t.isIdentifier(declaration)) {
        record(declaration.name, 'default');
      }
    }
  }

  let marks: [local: string, exposed: string][] = [];
  for (let [local, names] of exposedNames) {
    if (isDeclaredHere(program, local)) {
      marks.push([local, [...names].sort()[0]]);
    }
  }
  if (marks.length === 0) {
    return;
  }

  let helper = program.scope.generateUidIdentifier('markModuleProvenance');
  let moduleExpression =
    options.moduleIdentifier !== undefined
      ? JSON.stringify(options.moduleIdentifier)
      : 'import.meta.url';
  let source = `
    function ${helper.name}(value, name) {
      let key = Symbol.for(${JSON.stringify(MODULE_PROVENANCE.description)});
      if (
        typeof value === 'function' &&
        Object.isExtensible(value) &&
        !Object.prototype.hasOwnProperty.call(value, key)
      ) {
        Object.defineProperty(value, key, {
          value: Object.freeze({ module: ${moduleExpression}, name }),
        });
      }
    }
    ${marks
      .map(
        ([local, exposed]) =>
          `${helper.name}(${local}, ${JSON.stringify(exposed)});`,
      )
      .join('\n')}
  `;
  program.pushContainer(
    'body',
    babel.template.statements.ast(source, { sourceType: 'module' }),
  );
}

// A value binding declared at the top level of this module: not an import,
// not a type, and not a TypeScript `declare`, none of which exist at runtime.
function isDeclaredHere(program: NodePath<t.Program>, name: string): boolean {
  let binding = program.scope.getBinding(name);
  if (!binding || binding.kind === 'module' || binding.path.removed) {
    return false;
  }
  let declaration = binding.path;
  if (declaration.isVariableDeclarator()) {
    let parent = declaration.parentPath;
    return !(parent?.isVariableDeclaration() && parent.node.declare);
  }
  return (
    (declaration.isClassDeclaration() || declaration.isFunctionDeclaration()) &&
    !declaration.node.declare
  );
}

export function loaderPlugin(babel: typeof Babel) {
  let t = babel.types;

  function isPathLike(value: string): boolean {
    return (
      value.startsWith('./') ||
      value.startsWith('../') ||
      value.startsWith('/') ||
      value.includes('://')
    ); // Also handle absolute URLs
  }

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
      // Last, so the marks name what remains exported once the TypeScript
      // transform has removed what was only a type.
      Program: {
        exit(path: NodePath<t.Program>) {
          markDeclaredExports(babel, path, {});
        },
      },
    },
  };
}
