import type * as Babel from '@babel/core';
import type { PluginObj, PluginPass, types as t } from '@babel/core';
import type { NodePath } from '@babel/traverse';

// Every exported class gets a static member keyed by this registered symbol,
// whose value is `[moduleIdentifier, exportedName]`.
export const exportIdentitySymbolKey = 'ident';

export interface Options {
  // Names the module being compiled. A function receives the on-disk filename
  // babel was given and returns the identifier to inline, or `null` to leave
  // every class in that file untagged.
  moduleIdentifier: string | ((filename: string) => string | null);
}

interface State extends PluginPass {
  opts: Options;
}

export function exportIdentityPlugin(babel: typeof Babel): PluginObj<State> {
  let t = babel.types;

  function identityMember(
    moduleIdentifier: string,
    exportedName: string,
  ): t.ClassProperty {
    return t.classProperty(
      t.callExpression(
        t.memberExpression(t.identifier('Symbol'), t.identifier('for')),
        [t.stringLiteral(exportIdentitySymbolKey)],
      ),
      t.arrayExpression([
        t.stringLiteral(moduleIdentifier),
        t.stringLiteral(exportedName),
      ]),
      null,
      null,
      true, // computed
      true, // static
    );
  }

  return {
    name: 'export-identity',
    visitor: {
      Program(program: NodePath<t.Program>, state: State) {
        let resolved = resolveModuleIdentifier(state);
        if (resolved === null) {
          return;
        }
        let moduleIdentifier: string = resolved;
        let exportedNames = collectLocalExports(program);

        function tag(
          classPath: NodePath<t.ClassDeclaration | t.ClassExpression>,
          exportedName: string | undefined,
        ) {
          // `declare class` has no runtime body to put the member in.
          if (
            exportedName === undefined ||
            (classPath.isClassDeclaration() && classPath.node.declare)
          ) {
            return;
          }
          classPath
            .get('body')
            .unshiftContainer(
              'body',
              identityMember(moduleIdentifier, exportedName),
            );
        }

        function tagDeclaration(
          declaration: NodePath<t.Node | null | undefined>,
          exportedNameOf: (localName: string) => string | undefined,
        ) {
          if (declaration.isClassDeclaration() && declaration.node.id) {
            tag(declaration, exportedNameOf(declaration.node.id.name));
          } else if (declaration.isVariableDeclaration()) {
            for (let declarator of declaration.get('declarations')) {
              let id = declarator.node.id;
              let init = declarator.get('init');
              if (id.type === 'Identifier' && init.isClassExpression()) {
                tag(init, exportedNameOf(id.name));
              }
            }
          }
        }

        for (let statement of program.get('body')) {
          if (statement.isExportDefaultDeclaration()) {
            let declaration = statement.get('declaration');
            if (
              declaration.isClassDeclaration() ||
              declaration.isClassExpression()
            ) {
              tag(declaration, 'default');
            }
          } else if (statement.isExportNamedDeclaration()) {
            // `export class Foo` and `export const Foo = class` export the
            // binding under its own name.
            tagDeclaration(statement.get('declaration'), (name) => name);
          } else {
            tagDeclaration(statement, (name) => exportedNames.get(name));
          }
        }
      },
    },
  };
}

function resolveModuleIdentifier(state: State): string | null {
  let { moduleIdentifier } = state.opts;
  if (typeof moduleIdentifier === 'string') {
    return moduleIdentifier;
  }
  if (typeof moduleIdentifier !== 'function') {
    throw new Error(
      `export-identity plugin requires a "moduleIdentifier" option`,
    );
  }
  let filename = state.filename;
  if (filename === undefined) {
    throw new Error(
      `export-identity plugin needs babel's "filename" option to compute the module identifier`,
    );
  }
  return moduleIdentifier(filename);
}

// Maps each local binding that a separate export statement exports
// (`export { Foo as Bar }`, `export default Foo`) to the first name it is
// exported under, in source order. Re-exports from other modules and
// type-only exports name no local runtime class, so they are skipped.
function collectLocalExports(
  program: NodePath<t.Program>,
): Map<string, string> {
  let exportedNames = new Map<string, string>();
  function record(localName: string, exportedName: string) {
    if (!exportedNames.has(localName)) {
      exportedNames.set(localName, exportedName);
    }
  }
  for (let statement of program.get('body')) {
    if (statement.isExportDefaultDeclaration()) {
      let declaration = statement.node.declaration;
      if (declaration.type === 'Identifier') {
        record(declaration.name, 'default');
      }
    } else if (
      statement.isExportNamedDeclaration() &&
      !statement.node.source &&
      statement.node.exportKind !== 'type'
    ) {
      for (let specifier of statement.node.specifiers) {
        if (
          specifier.type === 'ExportSpecifier' &&
          specifier.exportKind !== 'type'
        ) {
          record(
            specifier.local.name,
            specifier.exported.type === 'Identifier'
              ? specifier.exported.name
              : specifier.exported.value,
          );
        }
      }
    }
  }
  return exportedNames;
}
