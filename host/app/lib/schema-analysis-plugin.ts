import type * as Babel from '@babel/core';
import type { types as t } from '@babel/core';
import type { NodePath } from '@babel/traverse';

interface State {
  opts: Options;
}

export interface Options {
  exports: {
    [localName: string]: string; // localName -> exportedName
  };
  imports: {
    [localName: string]: {
      importedName: string | NamespaceMarker;
      source: string;
    };
  };
  classes: {
    [className: string]: {
      superClass: string | null;
      // TODO add @field properties
      // TODO add static properties
    };
  };
}

const NamespaceMarker = { isNamespace: true };
type NamespaceMarker = typeof NamespaceMarker;

export function schemaAnalysisPlugin(babel: typeof Babel) {
  let t = babel.types;
  return {
    visitor: {
      ExportDeclaration(path: NodePath<t.ExportDeclaration>, state: State) {
        switch (path.node.type) {
          case 'ExportNamedDeclaration':
            for (let specifier of path.node.specifiers) {
              switch (specifier.type) {
                case 'ExportSpecifier':
                  if (!t.isIdentifier(specifier.exported)) {
                    throw error(
                      path,
                      'Expected exported name to be an identifier'
                    );
                  }
                  if (!t.isIdentifier(specifier.local)) {
                    throw error(
                      path,
                      'Exported local name to be an identifier'
                    );
                  }
                  state.opts.exports[specifier.local.name] =
                    specifier.exported.name;
                  break;
                case 'ExportDefaultSpecifier':
                case 'ExportNamespaceSpecifier':
                  throw error(path, 'unimplemented');
                default:
                  assertNever(specifier);
              }
            }
            if (path.node.declaration) {
              let declaration = path.node.declaration;
              switch (declaration.type) {
                // we could try harder to find card classes in
                // other types of declarations
                case 'ClassDeclaration':
                  state.opts.exports[declaration.id.name] = declaration.id.name;
                  break;
              }
            }
            break;

          case 'ExportDefaultDeclaration':
            if (path.node.declaration) {
              let declaration = path.node.declaration;
              switch (declaration.type) {
                // we could try harder to find card classes in
                // other types of declarations
                case 'ClassDeclaration':
                  state.opts.exports[declaration.id.name] = 'default';
                  break;
                case 'Identifier':
                  state.opts.exports[declaration.name] = 'default';
              }
            }
            break;

          case 'ExportAllDeclaration':
            throw error(path, 'unimplemented');

          default:
            assertNever(path.node);
        }
      },

      ImportDeclaration(path: NodePath<t.ImportDeclaration>, state: State) {
        let source = path.node.source.value;
        for (let specifier of path.node.specifiers) {
          switch (specifier.type) {
            case 'ImportSpecifier':
              if (!t.isIdentifier(specifier.imported)) {
                throw error(path, 'Expected imported name to be an identifier');
              }
              if (!t.isIdentifier(specifier.local)) {
                throw error(path, 'Exported local name to be an identifier');
              }
              state.opts.imports[specifier.local.name] = {
                importedName: specifier.imported.name,
                source,
              };
              break;
            case 'ImportDefaultSpecifier':
              state.opts.imports[specifier.local.name] = {
                importedName: 'default',
                source,
              };
              break;
            case 'ImportNamespaceSpecifier':
              throw error(path, 'unimplemented');
            default:
              assertNever(specifier);
          }
        }
      },

      ClassDeclaration(path: NodePath<t.ClassDeclaration>, state: State) {
        if (path.node.superClass && !t.isIdentifier(path.node.id)) {
          throw error(path, 'Expected super class to be an identifier');
        }
        state.opts.classes[path.node.id.name] = {
          superClass:
            (path.node.superClass as t.Identifier | null)?.name ?? null,
        };
      },
    },
  };
}

export function error(path: NodePath<any>, message: string) {
  return path.buildCodeFrameError(message, CompilerError);
}
class CompilerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CompilerError';
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, this.constructor);
    } else if (!this.stack) {
      this.stack = new Error(message).stack;
    }
  }
}

function assertNever(value: never) {
  throw new Error(`should never happen ${value}`);
}
