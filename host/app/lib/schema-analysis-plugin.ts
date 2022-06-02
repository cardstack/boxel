import type * as Babel from '@babel/core';
import type { types as t } from '@babel/core';
import type { NodePath, Scope } from '@babel/traverse';

interface State {
  opts: Options;
}

interface ExternalReference {
  type: 'external';
  module: string;
  name: string;
}

export type CardReference =
  | ExternalReference
  | {
      type: 'internal';
      classIndex: number;
    };

export interface PossibleCardClass {
  super: CardReference;
  localName: string | undefined;
  // exportedAs: string | undefined;
  path: NodePath<t.ClassDeclaration>;
  possibleFields: Map<string, PossibleField>;
}

export interface PossibleField {
  card: CardReference;
  type: ExternalReference;
  decorator: ExternalReference;
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
          let cardRef = makeCardReference(path.scope, sc.node.name, state);
          if (cardRef) {
            state.opts.possibleCards.push({
              super: cardRef,
              localName: path.node.id ? path.node.id.name : undefined,
              path,
              possibleFields: new Map(),
            });
          }
        }
      },

      Decorator(path: NodePath<t.Decorator>, state: State) {
        let expression = path.get('expression');
        if (!expression.isIdentifier()) {
          return;
        }
        let decoratorInfo = getNamedImportInfo(
          path.scope,
          expression.node.name
        );
        if (!decoratorInfo) {
          return; // our @field decorator must originate from a named import
        }

        let maybeClassProperty = path.parentPath;
        if (
          !maybeClassProperty.isClassProperty() ||
          maybeClassProperty.node.key.type !== 'Identifier'
        ) {
          return;
        }

        let maybeCallExpression = maybeClassProperty.node.value;
        if (
          maybeCallExpression?.type !== 'CallExpression' ||
          maybeCallExpression.arguments.length === 0
        ) {
          return; // our field type function (e.g. contains()) must have at least one argument (the field card)
        }

        let maybeFieldTypeFunction = maybeCallExpression.callee;
        if (maybeFieldTypeFunction.type !== 'Identifier') {
          return;
        }

        let fieldTypeInfo = getNamedImportInfo(
          path.scope,
          maybeFieldTypeFunction.name
        );
        if (!fieldTypeInfo) {
          return; // our field type function (e.g. contains()) must originate from a named import
        }

        let [maybeFieldCard] = maybeCallExpression.arguments; // note that the 2nd argument is the computeVia
        if (maybeFieldCard.type !== 'Identifier') {
          return;
        }

        let fieldCard = makeCardReference(
          path.scope,
          maybeFieldCard.name,
          state
        );
        if (!fieldCard) {
          return; // the first argument to our field type function must be a card reference
        }

        let possibleField: PossibleField = {
          card: fieldCard,
          type: {
            type: 'external',
            module: getName(fieldTypeInfo.declaration.node.source),
            name: getName(fieldTypeInfo.specifier.node.imported),
          },
          decorator: {
            type: 'external',
            module: getName(decoratorInfo.declaration.node.source),
            name: getName(decoratorInfo.specifier.node.imported),
          },
        };
        // the card that contains this field will always be the last card that
        // was added to possibleCards
        let [card] = state.opts.possibleCards.slice(-1);
        let fieldName = maybeClassProperty.node.key.name;
        card.possibleFields.set(fieldName, possibleField);
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

function makeCardReference(
  scope: Scope,
  name: string,
  state: State
): CardReference | undefined {
  let binding = scope.getBinding(name);
  if (
    binding?.path.isImportSpecifier() ||
    binding?.path.isImportDefaultSpecifier()
  ) {
    let parent = binding.path.parentPath as NodePath<t.ImportDeclaration>;
    return {
      type: 'external',
      module: parent.node.source.value,
      name: binding.path.isImportDefaultSpecifier()
        ? 'default'
        : getName(binding.path.node.imported),
    };
  }

  if (binding?.path.isClassDeclaration()) {
    let superClassNode = binding.path.node;
    let superClassIndex = state.opts.possibleCards.findIndex(
      (card) => card.path.node === superClassNode
    );
    if (superClassIndex >= 0) {
      return {
        type: 'internal',
        classIndex: superClassIndex,
      };
    }
  }

  return undefined;
}

function getNamedImportInfo(
  scope: Scope,
  name: string
):
  | {
      declaration: NodePath<t.ImportDeclaration>;
      specifier: NodePath<t.ImportSpecifier>;
    }
  | undefined {
  let binding = scope.getBinding(name);
  if (!binding?.path.isImportSpecifier()) {
    return undefined;
  }

  return {
    declaration: binding.path.parentPath as NodePath<t.ImportDeclaration>,
    specifier: binding.path,
  };
}

function getName(node: t.Identifier | t.StringLiteral) {
  if (node.type === 'Identifier') {
    return node.name;
  } else {
    return node.value;
  }
}
