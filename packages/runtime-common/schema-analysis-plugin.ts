import type * as Babel from '@babel/core';
import { types as t } from '@babel/core';
import type { NodePath, Scope } from '@babel/traverse';

interface State {
  opts: Options;
  insideCard: boolean;
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

export interface PossibleCardOrFieldClass extends BaseDeclaration {
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

// an element should be (an item of focus within a module)
// - exported function or class
// - exported card or field
// - unexported card or field
export type ElementDeclaration = PossibleCardOrFieldClass | BaseDeclaration;

export interface Options {
  possibleCardsOrFields: PossibleCardOrFieldClass[]; //cards may not be exports
  elements: ElementDeclaration[];
}

export function schemaAnalysisPlugin(_babel: typeof Babel) {
  return {
    visitor: {
      FunctionDeclaration: {
        enter(path: NodePath<t.FunctionDeclaration>, state: State) {
          let localName = path.node.id ? path.node.id.name : undefined;
          if (t.isExportDeclaration(path.parentPath)) {
            state.opts.elements.push({
              localName,
              exportedAs: getExportedAs(path, localName),
              path,
            });
          }
        },
      },
      ClassDeclaration: {
        enter(path: NodePath<t.ClassDeclaration>, state: State) {
          if (!path.node.superClass) {
            let localName = path.node.id ? path.node.id.name : undefined;
            if (t.isExportDeclaration(path.parentPath)) {
              state.opts.elements.push({
                localName,
                exportedAs: getExportedAs(path, localName),
                path,
              });
            }
            return;
          }

          let sc = path.get('superClass');
          if (sc.isReferencedIdentifier()) {
            let classRef = makeClassReference(path.scope, sc.node.name, state);
            if (classRef) {
              state.insideCard = true;
              let localName = path.node.id ? path.node.id.name : undefined;

              let possibleCardOrField = {
                super: classRef,
                localName,
                path,
                possibleFields: new Map(),
                exportedAs: getExportedAs(path, localName),
              };
              state.opts.possibleCardsOrFields.push(possibleCardOrField);
              state.opts.elements.push(possibleCardOrField);
            } else {
              if (t.isExportDeclaration(path.parentPath)) {
                let localName = path.node.id ? path.node.id.name : undefined;
                state.opts.elements.push({
                  localName,
                  exportedAs: getExportedAs(path, localName),
                  path,
                });
              }
            }
          } else {
            if (t.isExportDeclaration(path.parentPath)) {
              let localName = path.node.id ? path.node.id.name : undefined;
              state.opts.elements.push({
                localName,
                exportedAs: getExportedAs(path, localName),
                path,
              });
            }
          }
        },

        exit(_path: NodePath<t.ClassDeclaration>, state: State) {
          state.insideCard = false;
        },
      },

      Decorator(path: NodePath<t.Decorator>, state: State) {
        if (!state.insideCard) {
          return;
        }

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
        // was added to possibleCardsOrFields
        let [card] = state.opts.possibleCardsOrFields.slice(-1);
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
    if (typeof (Error as any).captureStackTrace === 'function') {
      (Error as any).captureStackTrace(this, this.constructor);
    } else if (!this.stack) {
      this.stack = new Error(message).stack;
    }
  }
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
    let superClassIndex = state.opts.possibleCardsOrFields.findIndex(
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

export function isPossibleCardOrFieldClass(
  element: any,
): element is PossibleCardOrFieldClass {
  return (
    element &&
    element.super &&
    typeof element.localName === 'string' &&
    element.possibleFields instanceof Map &&
    element.path
  );
}

export function isInternalReference(
  classReference: any,
): classReference is InternalReference {
  return classReference && classReference.type === 'internal';
}
