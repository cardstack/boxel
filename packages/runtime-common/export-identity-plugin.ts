import type * as Babel from '@babel/core';
import type { PluginObj, PluginPass, types as t } from '@babel/core';
import type { NodePath } from '@babel/traverse';

// Every exported class gets a static member keyed by this registered symbol,
// whose value is `[moduleIdentifier, exportedName]`.
//
// A class written in the module gets the member in its body. A class the
// module only computes — `export const Status = enumField(StringField, ...)`,
// where a factory makes the class — is tagged by a statement after the
// binding, once its value is known: when the value is a function that carries
// no identity of its own, it gets the same member.
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

  // if (typeof X === "function" &&
  //     !Object.prototype.hasOwnProperty.call(X, Symbol.for("ident")))
  //   Object.defineProperty(X, Symbol.for("ident"), {
  //     value: [moduleIdentifier, exportedName], configurable: true,
  //     writable: true });
  function identityStatement(
    binding: t.Identifier,
    moduleIdentifier: string,
    exportedName: string,
  ): t.Statement {
    let value = () => t.identifier(binding.name);
    let objectMethod = (name: string) =>
      t.memberExpression(t.identifier('Object'), t.identifier(name));
    return t.ifStatement(
      t.logicalExpression(
        '&&',
        t.binaryExpression(
          '===',
          t.unaryExpression('typeof', value()),
          t.stringLiteral('function'),
        ),
        t.unaryExpression(
          '!',
          t.callExpression(
            t.memberExpression(
              t.memberExpression(
                objectMethod('prototype'),
                t.identifier('hasOwnProperty'),
              ),
              t.identifier('call'),
            ),
            [value(), identityKey()],
          ),
        ),
      ),
      t.expressionStatement(
        t.callExpression(objectMethod('defineProperty'), [
          value(),
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
        ]),
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
              if (init.isClassExpression()) {
                tag(init, exportedName);
              } else if (
                exportedName !== undefined &&
                mayEvaluateToClass(init.node)
              ) {
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
              !declaration.isIdentifier() &&
              mayEvaluateToClass(declaration.node)
            ) {
              // `export default makeClass()`: the value is bound to a name
              // the tagging statement can reach, and that name exported.
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
      },
    },
  };
}

// Whether an initializer could evaluate to a class it does not spell out: a
// factory call, a reference to another binding, and the like. Literals,
// functions and object or array literals cannot.
function mayEvaluateToClass(expression: t.Node | null | undefined): boolean {
  if (!expression) {
    return false;
  }
  switch (expression.type) {
    case 'CallExpression':
    case 'OptionalCallExpression':
    case 'Identifier':
    case 'MemberExpression':
    case 'OptionalMemberExpression':
    case 'ConditionalExpression':
    case 'LogicalExpression':
    case 'SequenceExpression':
    case 'AwaitExpression':
      return true;
    case 'ParenthesizedExpression':
    case 'TSAsExpression':
    case 'TSSatisfiesExpression':
    case 'TSNonNullExpression':
    case 'TSTypeAssertion':
    case 'TypeCastExpression':
      return mayEvaluateToClass(expression.expression);
    default:
      return false;
  }
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
