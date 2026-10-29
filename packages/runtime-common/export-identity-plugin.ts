import type * as Babel from '@babel/core';
import type { PluginObj, PluginPass, types as t } from '@babel/core';
import type { NodePath } from '@babel/traverse';

// Every exported class gets a static member keyed by this registered symbol,
// whose value is `[moduleIdentifier, exportedName]`.
//
// A class written in the module gets the member in its body. A definition the
// module gets from a function call has no body in the module to put it in, so
// the module marks it by wrapping the call in `markDefinition` — `export const
// Status = markDefinition(enumField(StringField, ...))` — and it is tagged by a
// statement after the binding, once the call has returned it.
export const exportIdentitySymbolKey = 'ident';

// The one specifier `markDefinition` is recognized by. Importing it by any
// other spelling of a base module is a compile error.
export const markDefinitionModule = '@cardstack/base/mark-definition';
const markDefinitionName = 'markDefinition';
const otherBaseSpelling =
  /^(?:@cardstack\/base(?:\/|$)|https:\/\/cardstack\.com\/base(?:\/|$))/;

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
      identityKey(),
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

  function identityKey(): t.CallExpression {
    return t.callExpression(
      t.memberExpression(t.identifier('Symbol'), t.identifier('for')),
      [t.stringLiteral(exportIdentitySymbolKey)],
    );
  }

  // Object.defineProperty(X, Symbol.for("ident"), {
  //   value: [moduleIdentifier, exportedName], configurable: true,
  //   writable: true });
  function identityStatement(
    binding: t.Identifier,
    moduleIdentifier: string,
    exportedName: string,
  ): t.Statement {
    return t.expressionStatement(
      t.callExpression(
        t.memberExpression(
          t.identifier('Object'),
          t.identifier('defineProperty'),
        ),
        [
          t.identifier(binding.name),
          identityKey(),
          t.objectExpression([
            t.objectProperty(
              t.identifier('value'),
              t.arrayExpression([
                t.stringLiteral(moduleIdentifier),
                t.stringLiteral(exportedName),
              ]),
            ),
            t.objectProperty(
              t.identifier('configurable'),
              t.booleanLiteral(true),
            ),
            t.objectProperty(t.identifier('writable'), t.booleanLiteral(true)),
          ]),
        ],
      ),
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
        let markedDefinitionCall = markedDefinitionMatcher(program);
        let tagged = new Set<t.Node>();

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

        // `statement` is the program statement the declaration belongs to,
        // which a computed binding's tagging statements follow.
        function tagDeclaration(
          statement: NodePath<t.Statement>,
          declaration: NodePath<t.Node | null | undefined>,
          exportedNameOf: (localName: string) => string | undefined,
        ) {
          if (declaration.isClassDeclaration() && declaration.node.id) {
            tag(declaration, exportedNameOf(declaration.node.id.name));
          } else if (
            declaration.isVariableDeclaration() &&
            !declaration.node.declare
          ) {
            let computed: t.Statement[] = [];
            for (let declarator of declaration.get('declarations')) {
              let id = declarator.node.id;
              let init = declarator.get('init');
              if (id.type !== 'Identifier') {
                continue;
              }
              let exportedName = exportedNameOf(id.name);
              let marked = markedDefinitionCall(init.node);
              if (init.isClassExpression()) {
                tag(init, exportedName);
              } else if (exportedName !== undefined && marked) {
                tagged.add(marked);
                computed.push(
                  identityStatement(id, moduleIdentifier, exportedName),
                );
              }
            }
            if (computed.length) {
              statement.insertAfter(computed);
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
            } else if (
              declaration.isExpression() &&
              markedDefinitionCall(declaration.node)
            ) {
              tagged.add(markedDefinitionCall(declaration.node)!);
              // `export default markDefinition(...)`: the value is bound to a
              // name the tagging statement can reach, and that name exported.
              let binding = statement.scope.generateUidIdentifier('default');
              statement.insertBefore([
                t.variableDeclaration('const', [
                  t.variableDeclarator(binding, declaration.node),
                ]),
                identityStatement(binding, moduleIdentifier, 'default'),
              ]);
              declaration.replaceWith(t.identifier(binding.name));
            }
          } else if (statement.isExportNamedDeclaration()) {
            // `export class Foo` and `export const Foo = class` export the
            // binding under its own name.
            tagDeclaration(
              statement,
              statement.get('declaration'),
              (name) => name,
            );
          } else {
            tagDeclaration(statement, statement, (name) =>
              exportedNames.get(name),
            );
          }
        }

        // A marked definition that isn't what an exported binding is declared
        // with has no name to be tagged with.
        program.traverse({
          CallExpression(call) {
            if (
              markedDefinitionCall(call.node) === call.node &&
              !tagged.has(call.node)
            ) {
              throw call.buildCodeFrameError(
                `${markDefinitionName}() must be the value an exported binding is declared with, or the module's default export`,
              );
            }
          },
        });
      },
    },
  };
}

// Recognizes a call to `markDefinition` as imported from its module,
// by name or through a namespace, and returns the call. Throws on an import
// of `markDefinition` by another spelling of a base module.
function markedDefinitionMatcher(
  program: NodePath<t.Program>,
): (expression: t.Node | null | undefined) => t.CallExpression | undefined {
  let names = new Set<string>();
  let namespaces = new Set<string>();
  for (let statement of program.get('body')) {
    if (!statement.isImportDeclaration()) {
      continue;
    }
    let source = statement.node.source.value;
    for (let specifier of statement.get('specifiers')) {
      if (
        specifier.isImportSpecifier() &&
        importedName(specifier.node) === markDefinitionName
      ) {
        if (source === markDefinitionModule) {
          names.add(specifier.node.local.name);
        } else if (otherBaseSpelling.test(source)) {
          throw specifier.buildCodeFrameError(
            `import ${markDefinitionName} from '${markDefinitionModule}', not '${source}'`,
          );
        }
      } else if (
        specifier.isImportNamespaceSpecifier() &&
        source === markDefinitionModule
      ) {
        namespaces.add(specifier.node.local.name);
      }
    }
  }

  return function markedDefinitionCall(expression) {
    let call = unwrap(expression);
    if (call?.type !== 'CallExpression') {
      return undefined;
    }
    let callee = call.callee;
    if (callee.type === 'Identifier' && names.has(callee.name)) {
      return call;
    }
    if (
      callee.type === 'MemberExpression' &&
      !callee.computed &&
      callee.object.type === 'Identifier' &&
      namespaces.has(callee.object.name) &&
      callee.property.type === 'Identifier' &&
      callee.property.name === markDefinitionName
    ) {
      return call;
    }
    return undefined;
  };
}

// The expression a type assertion or parentheses wrap.
function unwrap(expression: t.Node | null | undefined): t.Node | undefined {
  while (
    expression &&
    (expression.type === 'ParenthesizedExpression' ||
      expression.type === 'TSAsExpression' ||
      expression.type === 'TSSatisfiesExpression' ||
      expression.type === 'TSNonNullExpression' ||
      expression.type === 'TSTypeAssertion' ||
      expression.type === 'TypeCastExpression')
  ) {
    expression = expression.expression;
  }
  return expression ?? undefined;
}

function importedName(specifier: t.ImportSpecifier): string {
  return specifier.imported.type === 'Identifier'
    ? specifier.imported.name
    : specifier.imported.value;
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
