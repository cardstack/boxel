import type * as Babel from '@babel/core';
import type { PluginObj, PluginPass, types as t } from '@babel/core';
import type { NodePath } from '@babel/traverse';
import { PREFIX_REALMS } from './realm-prefixes.ts';

// Every exported class gets a static member keyed by this registered symbol,
// whose value is `[moduleIdentifier, exportedName]`.
//
// A class written in the module gets the member in its body. A class the
// module gets from a class factory — `export const Status =
// enumField(StringField, ...)` — has no body in the module to put it in, so it
// is tagged by a statement after the binding, once the factory has returned
// it.
export const exportIdentitySymbolKey = 'ident';

// A function that returns a class a module may export, named by the module
// that exports the function and the name it is exported under.
export type ClassFactory = readonly [module: string, exportedName: string];

// The class factories card and field modules call to make the classes they
// export. A class made by any other function is exported untagged.
export const CLASS_FACTORIES: readonly ClassFactory[] = Object.freeze([
  ['@cardstack/base/enum', 'default'],
  ['@cardstack/catalog/fields/status/status', 'statusField'],
  ['@cardstack/catalog/fields/priority/priority', 'priorityField'],
]);

export interface Options {
  // Names the module being compiled. A function receives the on-disk filename
  // babel was given and returns the identifier to inline, or `null` to leave
  // every class in that file untagged.
  moduleIdentifier: string | ((filename: string) => string | null);
  // The class factories whose results are tagged. Defaults to CLASS_FACTORIES.
  classFactories?: readonly ClassFactory[];
  // Names the module an import specifier refers to, in the form
  // `classFactories` names modules. Given the specifier and the module being
  // compiled; returning undefined leaves the default in place, which resolves
  // a relative specifier against the module's identifier when that is a URL
  // and spells a well-known realm alias by its prefix.
  importedModule?: (
    specifier: string,
    importer: { moduleIdentifier: string; filename: string | undefined },
  ) => string | undefined;
  // Spells a resolved module the way `classFactories` does, for a module that
  // has spellings beyond the alias forms the default knows, such as a realm
  // URL a prefix is registered for.
  canonicalModule?: (module: string) => string;
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
        let isClassFactoryCall = classFactoryCallMatcher(
          program,
          state,
          moduleIdentifier,
        );

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
                isClassFactoryCall(init.node)
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
              isClassFactoryCall(declaration.node)
            ) {
              // `export default enumField(...)`: the value is bound to a name
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

// Recognizes a call to one of the configured class factories, however the
// module reaches the factory: imported by default, by name or through a
// namespace, or declared and exported by the module itself.
function classFactoryCallMatcher(
  program: NodePath<t.Program>,
  state: State,
  moduleIdentifier: string,
): (expression: t.Node | null | undefined) => boolean {
  let factories = new Set(
    (state.opts.classFactories ?? CLASS_FACTORIES).map(
      ([module, name]) => `${trimExtension(module)}#${name}`,
    ),
  );
  let importer = { moduleIdentifier, filename: state.filename };
  let canonical = state.opts.canonicalModule ?? ((module: string) => module);
  let moduleOf = (specifier: string) =>
    trimExtension(
      canonical(
        state.opts.importedModule?.(specifier, importer) ??
          defaultImportedModule(specifier, moduleIdentifier),
      ),
    );
  let ownExports = collectOwnExportNames(program);

  // The factory a callee names, as `module#exportedName`.
  function factoryOf(callee: t.Node): string | undefined {
    if (callee.type === 'Identifier') {
      let binding = program.scope.getBinding(callee.name);
      if (!binding) {
        return undefined;
      }
      let declaration = binding.path;
      if (
        declaration.isImportDefaultSpecifier() ||
        declaration.isImportSpecifier()
      ) {
        let source = (declaration.parent as t.ImportDeclaration).source.value;
        let imported = declaration.isImportDefaultSpecifier()
          ? 'default'
          : importedName(declaration.node);
        return `${moduleOf(source)}#${imported}`;
      }
      let exported = ownExports.get(callee.name);
      return exported === undefined
        ? undefined
        : `${trimExtension(canonical(moduleIdentifier))}#${exported}`;
    }
    if (
      callee.type === 'MemberExpression' &&
      !callee.computed &&
      callee.object.type === 'Identifier' &&
      callee.property.type === 'Identifier'
    ) {
      let declaration = program.scope.getBinding(callee.object.name)?.path;
      if (declaration?.isImportNamespaceSpecifier()) {
        let source = (declaration.parent as t.ImportDeclaration).source.value;
        return `${moduleOf(source)}#${callee.property.name}`;
      }
    }
    return undefined;
  }

  return function isClassFactoryCall(expression) {
    let call = unwrap(expression);
    if (call?.type !== 'CallExpression') {
      return false;
    }
    let factory = factoryOf(call.callee);
    return factory !== undefined && factories.has(factory);
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

// A relative specifier resolved against the importing module when its
// identifier is a URL, and a well-known realm alias spelled by its prefix.
function defaultImportedModule(
  specifier: string,
  moduleIdentifier: string,
): string {
  let module = specifier;
  if (/^\.\.?\//.test(specifier)) {
    try {
      module = new URL(specifier, moduleIdentifier).href;
    } catch {
      return specifier;
    }
  }
  for (let { prefix, alias } of PREFIX_REALMS) {
    if (alias && module.startsWith(alias)) {
      return prefix + module.slice(alias.length);
    }
  }
  return module;
}

function trimExtension(module: string): string {
  return module.replace(/\.(gts|ts|gjs|js)$/, '');
}

// Maps every local binding the module exports — by its declaration or by a
// separate export statement — to the first name it is exported under.
function collectOwnExportNames(
  program: NodePath<t.Program>,
): Map<string, string> {
  let names = collectLocalExports(program);
  for (let statement of program.node.body) {
    if (statement.type !== 'ExportNamedDeclaration') {
      continue;
    }
    let declaration = statement.declaration;
    if (declaration?.type === 'FunctionDeclaration' && declaration.id) {
      names.set(declaration.id.name, declaration.id.name);
    } else if (declaration?.type === 'VariableDeclaration') {
      for (let declarator of declaration.declarations) {
        if (declarator.id.type === 'Identifier') {
          names.set(declarator.id.name, declarator.id.name);
        }
      }
    }
  }
  return names;
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
