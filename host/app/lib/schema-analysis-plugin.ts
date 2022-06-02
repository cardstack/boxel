import type * as Babel from '@babel/core';
import type { types as t } from '@babel/core';
import type { NodePath } from '@babel/traverse';

interface State {
  opts: Options;
}

export type CardReference =
  | {
      type: 'external';
      module: string;
      name: string;
    }
  | {
      type: 'internal';
      classIndex: number;
    };

export interface PossibleCardClass {
  super: CardReference;
  localName: string | undefined;
  // exportedAs: string | undefined;
  path: NodePath<t.ClassDeclaration>;
  fields: Map<string, CardReference>;
}

export interface Options {
  possibleCards: PossibleCardClass[];
}

export function schemaAnalysisPlugin(babel: typeof Babel) {
  let t = babel.types;
  return {
    visitor: {
      // ExportNamedDeclaration(
      //   path: NodePath<t.ExportNamedDeclaration>,
      //   state: State
      // ) {
      //   for (let specifier of path.node.specifiers) {
      //     switch (specifier.type) {
      //       case 'ExportSpecifier':
      //         if (!t.isIdentifier(specifier.exported)) {
      //           throw error(path, 'Expected exported name to be an identifier');
      //         }
      //         if (!t.isIdentifier(specifier.local)) {
      //           throw error(path, 'Exported local name to be an identifier');
      //         }
      //         state.opts.exports[specifier.local.name] =
      //           specifier.exported.name;
      //         break;
      //       case 'ExportDefaultSpecifier':
      //       case 'ExportNamespaceSpecifier':
      //         throw error(path, 'unimplemented');
      //       default:
      //         assertNever(specifier);
      //     }
      //   }
      //   if (path.node.declaration) {
      //     let declaration = path.node.declaration;
      //     switch (declaration.type) {
      //       // we could try harder to find card classes in
      //       // other types of declarations
      //       case 'ClassDeclaration':
      //         state.opts.exports[declaration.id.name] = declaration.id.name;
      //         break;
      //     }
      //   }
      // },

      // ExportDefaultDeclaration(
      //   path: NodePath<t.ExportDefaultDeclaration>,
      //   state: State
      // ) {
      //   if (path.node.declaration) {
      //     let declaration = path.node.declaration;
      //     switch (declaration.type) {
      //       // we could try harder to find card classes in
      //       // other types of declarations
      //       case 'ClassDeclaration':
      //         state.opts.exports[declaration.id.name] = 'default';
      //         break;
      //       case 'Identifier':
      //         state.opts.exports[declaration.name] = 'default';
      //     }
      //   }
      // },

      ClassDeclaration(path: NodePath<t.ClassDeclaration>, state: State) {
        if (path.node.superClass && !t.isIdentifier(path.node.id)) {
          return;
        }

        let sc = path.get('superClass');
        if (sc.isReferencedIdentifier()) {
          let binding = path.scope.getBinding(sc.node.name);
          if (
            binding?.path.isImportSpecifier() ||
            binding?.path.isImportDefaultSpecifier()
          ) {
            let parent = binding.path
              .parentPath as NodePath<t.ImportDeclaration>;
            state.opts.possibleCards.push({
              super: {
                type: 'external',
                module: parent.node.source.value,
                name: binding.path.isImportDefaultSpecifier()
                  ? 'default'
                  : getName(binding.path.node.imported),
              },
              localName: path.node.id ? path.node.id.name : undefined,
              path,
              fields: new Map(),
            });
          }

          if (binding?.path.isClassDeclaration()) {
            let superClassNode = binding.path.node;
            let superClassIndex = state.opts.possibleCards.findIndex(
              (card) => card.path.node === superClassNode
            );
            if (superClassIndex >= 0) {
              state.opts.possibleCards.push({
                super: {
                  type: 'internal',
                  classIndex: superClassIndex,
                },
                localName: path.node.id ? path.node.id.name : undefined,
                path,
                fields: new Map(),
              });
            }
          }
        }
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

function getName(node: t.Identifier | t.StringLiteral) {
  if (node.type === 'Identifier') {
    return node.name;
  } else {
    return node.value;
  }
}
