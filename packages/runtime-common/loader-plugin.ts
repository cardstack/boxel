import type * as Babel from '@babel/core';
import type { types as t } from '@babel/core';
import type { NodePath, Binding } from '@babel/traverse';

// The own property an exported class carries to name the module that declares
// it, as `{ module, name }`. A module that only re-exports a class marks
// nothing, so the mark names the declarer whichever module exposing the class
// is loaded first. Non-enumerable and keyed by a symbol, so nothing that lists
// a class's own keys sees it.
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

// Marks a value that transpilation did not, such as a class in a module the
// loader was handed as a shim. A value that already has a mark keeps it.
export function markModuleProvenance(
  value: Function,
  provenance: ModuleProvenance,
): void {
  if (
    Object.isExtensible(value) &&
    !Object.prototype.hasOwnProperty.call(value, MODULE_PROVENANCE)
  ) {
    Object.defineProperty(value, MODULE_PROVENANCE, {
      value: Object.freeze({ ...provenance }),
    });
  }
}

export interface ModuleProvenanceOptions {
  // For a build that puts modules in chunks, where `import.meta` describes the
  // chunk: the directory the modules come from, and the prefix the loader
  // serves them under. A module at `<moduleRoot>/a/b.gts` is marked as
  // `<modulePrefix>a/b`. Without these, a mark names the module the loader
  // evaluated it as.
  moduleRoot?: string;
  modulePrefix?: string;
}

// The class nodes this plugin has marked: each one's block, and the name its
// mark carries.
const markedClasses = new WeakMap<
  t.Class,
  { block: t.StaticBlock; name: string }
>();

// Gives each class a module declares and exports a static block that marks it
// with the module and the name it is exported under. Only classes: card and
// field definitions are classes, and they are what the loader is asked to
// identify. The block is the class's first member, so the mark is in place
// before any other static code of the class runs.
//
// Only a class this module declares is marked. `import { X } from './y';
// export { X }` and `export { X } from './y'` mark nothing: `./y` declares X,
// and marks it itself. A class exported under more than one name is marked
// with the name that sorts first, which is the first key of the module's
// namespace.
export function moduleProvenancePlugin(
  babel: typeof Babel,
  options: ModuleProvenanceOptions = {},
) {
  let t = babel.types;

  function moduleExpression(filename: string | undefined): t.Expression {
    let { moduleRoot, modulePrefix } = options;
    if (moduleRoot !== undefined && modulePrefix !== undefined && filename) {
      let root = moduleRoot.replace(/\\/g, '/').replace(/\/$/, '');
      let file = filename.replace(/\\/g, '/');
      if (file.startsWith(`${root}/`)) {
        let name = file
          .slice(root.length + 1)
          .split('?')[0]
          .replace(/\.(gts|gjs|ts|js)$/, '');
        return t.stringLiteral(`${modulePrefix}${name}`);
      }
    }
    // The loader puts the identifier it serves the module under on
    // `import.meta`; `import.meta.url` covers a module evaluated without it.
    return babel.template.expression.ast(
      'import.meta.moduleIdentifier ?? import.meta.url',
    );
  }

  function markStatement(module: t.Expression, name: string): t.Statement {
    return t.expressionStatement(
      t.callExpression(
        t.memberExpression(
          t.identifier('Object'),
          t.identifier('defineProperty'),
        ),
        [
          t.thisExpression(),
          t.callExpression(
            t.memberExpression(t.identifier('Symbol'), t.identifier('for')),
            [t.stringLiteral(MODULE_PROVENANCE.description!)],
          ),
          t.objectExpression([
            t.objectProperty(
              t.identifier('value'),
              t.callExpression(
                t.memberExpression(
                  t.identifier('Object'),
                  t.identifier('freeze'),
                ),
                [
                  t.objectExpression([
                    t.objectProperty(t.identifier('module'), module),
                    t.objectProperty(
                      t.identifier('name'),
                      t.stringLiteral(name),
                    ),
                  ]),
                ],
              ),
            ),
          ]),
        ],
      ),
    );
  }

  function mark(
    cls: NodePath<t.Class>,
    name: string,
    filename: string | undefined,
  ) {
    let existing = markedClasses.get(cls.node);
    if (existing) {
      if (name < existing.name) {
        existing.block.body = [markStatement(moduleExpression(filename), name)];
        existing.name = name;
      }
      return;
    }
    let block = t.staticBlock([
      markStatement(moduleExpression(filename), name),
    ]);
    cls.get('body').unshiftContainer('body', block);
    markedClasses.set(cls.node, { block, name });
  }

  // The class a module-level binding holds, when this module declares it:
  // `class X {}` or `const X = class {}`. Not an import, and not a TypeScript
  // `declare`, which has nothing behind it at runtime.
  function declaredClass(binding: Binding | undefined) {
    if (!binding || binding.kind === 'module' || binding.path.removed) {
      return undefined;
    }
    let declaration = binding.path;
    if (declaration.isClassDeclaration()) {
      return declaration.node.declare ? undefined : declaration;
    }
    if (declaration.isVariableDeclarator()) {
      let parent = declaration.parentPath;
      if (parent?.isVariableDeclaration() && parent.node.declare) {
        return undefined;
      }
      let init = declaration.get('init');
      return init.isClassExpression() ? init : undefined;
    }
    return undefined;
  }

  return {
    visitor: {
      ExportNamedDeclaration(
        path: NodePath<t.ExportNamedDeclaration>,
        state: { filename?: string },
      ) {
        if (path.node.source || path.node.exportKind === 'type') {
          return;
        }
        let declaration = path.get('declaration');
        if (
          declaration.isClassDeclaration() ||
          declaration.isVariableDeclaration()
        ) {
          for (let name of Object.keys(
            t.getOuterBindingIdentifiers(declaration.node),
          )) {
            let cls = declaredClass(path.scope.getBinding(name));
            if (cls) {
              mark(cls, name, state.filename);
            }
          }
        }
        for (let specifier of path.node.specifiers) {
          if (
            !t.isExportSpecifier(specifier) ||
            specifier.exportKind === 'type'
          ) {
            continue;
          }
          let cls = declaredClass(path.scope.getBinding(specifier.local.name));
          if (cls) {
            mark(
              cls,
              t.isIdentifier(specifier.exported)
                ? specifier.exported.name
                : specifier.exported.value,
              state.filename,
            );
          }
        }
      },
      ExportDefaultDeclaration(
        path: NodePath<t.ExportDefaultDeclaration>,
        state: { filename?: string },
      ) {
        let declaration = path.get('declaration');
        if (
          declaration.isClassDeclaration() ||
          declaration.isClassExpression()
        ) {
          if (!(declaration.node as t.ClassDeclaration).declare) {
            mark(declaration, 'default', state.filename);
          }
        } else if (declaration.isIdentifier()) {
          let cls = declaredClass(path.scope.getBinding(declaration.node.name));
          if (cls) {
            mark(cls, 'default', state.filename);
          }
        }
      },
    },
  };
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
    },
  };
}
