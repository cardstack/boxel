import type * as Babel from '@babel/core';
import { types as t } from '@babel/core';
import type { NodePath, Scope } from '@babel/traverse';

interface State {
  opts: Options;
}

export interface ExternalReference {
  type: 'external';
  module: string;
  name: string;
}

export interface InternalReference {
  type: 'internal';
  classIndex?: number;
}

export type ClassReference = ExternalReference | InternalReference;

export type BaseDeclaration = {
  localName: string | undefined;
  exportedAs: string | undefined;
  path: NodePath;
};

export interface PossibleCardClass extends BaseDeclaration {
  super: ClassReference;
  possibleFields: Map<string, PossibleField>;
  path: NodePath<t.ClassDeclaration>;
}

export interface PossibleField {
  card: ClassReference;
  type: ExternalReference;
  decorator: ExternalReference;
  path: NodePath<t.ClassProperty>;
}

export type ModuleDeclaration = PossibleCardClass | BaseDeclaration;

export interface Options {
  possibleCards: PossibleCardClass[]; //cards may not be exports
  moduleDeclarations: ModuleDeclaration[];
}

export function schemaAnalysisPlugin(_babel: typeof Babel) {
  return {
    visitor: {
      Declaration: {
        enter(
          path: NodePath<t.ClassDeclaration> | NodePath<t.FunctionDeclaration>,
          state: State,
        ) {
          if (t.isClassDeclaration(path) || t.isFunctionDeclaration(path)) {
            let localName = path.node.id ? path.node.id.name : undefined;
            if (t.isExportDeclaration(path.parentPath)) {
              state.opts.moduleDeclarations.push({
                localName,
                exportedAs: getExportedAs(path, localName),
                path,
              });
            } else if (t.isClassDeclaration(path)) {
              let maybeCard = lookForCard(path, state);
              if (maybeCard) {
                state.opts.moduleDeclarations.push(maybeCard);
              }
            }
          }
        },
      },
      ClassDeclaration: {
        enter(path: NodePath<t.ClassDeclaration>, state: State) {
          let maybeCard = lookForCard(path, state);
          if (maybeCard) {
            state.opts.possibleCards.push(maybeCard);
            maybeCard.path.traverse({
              Decorator: {
                enter(path: NodePath<t.Decorator>) {
                  let expression = path.get('expression');
                  if (!expression.isIdentifier()) {
                    return;
                  }
                  let decoratorInfo = getNamedImportInfo(
                    path.scope,
                    expression.node.name,
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
                    maybeFieldTypeFunction.name,
                  );
                  if (!fieldTypeInfo) {
                    return; // our field type function (e.g. contains()) must originate from a named import
                  }

                  let [maybeFieldCard] = maybeCallExpression.arguments; // note that the 2nd argument is the computeVia
                  let maybeFieldCardName;
                  if (maybeFieldCard.type !== 'Identifier') {
                    if (
                      maybeFieldCard.type === 'ArrowFunctionExpression' &&
                      maybeFieldCard.body.type === 'Identifier'
                    ) {
                      maybeFieldCardName = maybeFieldCard.body.name;
                    } else {
                      return;
                    }
                  } else {
                    maybeFieldCardName = maybeFieldCard.name;
                  }

                  let fieldCard = makeClassReference(
                    path.scope,
                    maybeFieldCardName,
                    state,
                  );
                  if (!fieldCard) {
                    return; // the first argument to our field type function must be a card reference
                  }

                  let possibleField: PossibleField = {
                    card: fieldCard,
                    path: maybeClassProperty,
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
            });
          }
        },
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
    if (typeof (Error as any).captureStackTrace === 'function') {
      (Error as any).captureStackTrace(this, this.constructor);
    } else if (!this.stack) {
      this.stack = new Error(message).stack;
    }
  }
}

function lookForCard(path: NodePath<t.ClassDeclaration>, state: State) {
  if (!path.node.superClass) {
    return;
  }

  let sc = path.get('superClass');
  if (sc.isReferencedIdentifier()) {
    let classRef = makeClassReference(path.scope, sc.node.name, state);
    if (classRef) {
      let localName = path.node.id ? path.node.id.name : undefined;
      return {
        super: classRef,
        localName,
        path,
        possibleFields: new Map(),
        exportedAs: getExportedAs(path, localName),
      };
    }
  }
  return;
}

function getExportedAs(
  path: NodePath<t.ClassDeclaration> | NodePath<t.FunctionDeclaration>,
  localName: string | undefined,
): string | undefined {
  let { parentPath } = path;
  if (parentPath.isExportNamedDeclaration()) {
    // the class declaration is part of a named export
    return localName;
  } else if (parentPath.isExportDefaultDeclaration()) {
    // the class declaration is part of a default export
    return 'default';
  } else {
    // the class's identifier is referenced in a node whose parent is an ExportSpecifier
    let binding = localName ? path.scope.getBinding(localName) : undefined;
    if (binding) {
      let maybeExportSpecifierLocal = binding.referencePaths.find(
        (b) => b.parentPath?.isExportSpecifier(),
      ) as NodePath<t.Identifier> | undefined;
      if (maybeExportSpecifierLocal) {
        return getName(
          (maybeExportSpecifierLocal.parentPath as NodePath<t.ExportSpecifier>)
            .node.exported,
        );
      }
    }
  }
  return;
}

function makeClassReference(
  scope: Scope,
  name: string,
  state: State,
): ClassReference | undefined {
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
      (card) => card.path.node === superClassNode,
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
  name: string,
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
