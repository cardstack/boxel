import type * as Babel from '@babel/core';
import { types as t } from '@babel/core';
import { type NodePath, type Scope, visitors } from '@babel/traverse';

export interface ExternalReference {
  type: 'external';
  module: string;
  name: string;
}

export interface InternalReference {
  type: 'internal';
  classIndex?: number; //the internal index only applies to possibleCardsOrFields array
}

export type ClassReference = ExternalReference | InternalReference;

export interface BaseDeclaration {
  localName: string | undefined;
  exportedAs: string | undefined;
  path: NodePath;
}

export interface FunctionDeclaration extends BaseDeclaration {
  type: 'function';
  path: NodePath<t.FunctionDeclaration>;
}

export interface ClassDeclaration extends BaseDeclaration {
  type: 'class';
  path: NodePath<t.ClassDeclaration>;
}

export interface PossibleCardOrFieldDeclaration extends BaseDeclaration {
  type: 'possibleCardOrField';
  super?: ClassReference; // this is optional to allow to be inclusive of base def class
  possibleFields: Map<string, PossibleField>;
  path: NodePath<t.ClassDeclaration>;
}

export interface Reexport extends BaseDeclaration {
  type: 'reexport';
}

export interface PossibleField {
  card: ClassReference;
  type: ExternalReference;
  decorator: ExternalReference;
  path: NodePath<t.ClassProperty>;
}

export type Declaration =
  | PossibleCardOrFieldDeclaration
  | FunctionDeclaration
  | ClassDeclaration
  | Reexport;

export interface Options {
  possibleCardsOrFields: PossibleCardOrFieldDeclaration[]; //cards may not be exports
  declarations: Declaration[];
}

interface State {
  opts: Options;
  insideCard: boolean;
}

export function schemaAnalysisPlugin(_babel: typeof Babel) {
  return {
    visitor: visitors.merge([coreVisitor, reExportVisitor]),
  };
}

const coreVisitor = {
  FunctionDeclaration: {
    enter(path: NodePath<t.FunctionDeclaration>, state: State) {
      let localName = getLocalName(path);
      if (t.isExportDeclaration(path.parentPath)) {
        // == handle direct export ==
        state.opts.declarations.push({
          localName,
          exportedAs: getExportedAsName(path, localName),
          path,
          type: 'function',
        });
      }
    },
  },
  ClassDeclaration: {
    enter(path: NodePath<t.ClassDeclaration>, state: State) {
      // == handle class that doesn't inherit from super ==
      if (!path.node.superClass) {
        let localName = getLocalName(path);
        // == handle base def ==
        if (isBaseDefClass(path)) {
          let possibleCardOrField: PossibleCardOrFieldDeclaration = {
            localName,
            path,
            possibleFields: new Map(),
            exportedAs: getExportedAsName(path, localName),
            type: 'possibleCardOrField',
          };
          state.opts.possibleCardsOrFields.push(possibleCardOrField);
          state.opts.declarations.push(possibleCardOrField);
          return;
        }

        // == handle direct exports ==
        if (t.isExportDeclaration(path.parentPath)) {
          state.opts.declarations.push({
            localName,
            exportedAs: getExportedAsName(path, localName),
            path,
            type: 'class',
          });
          return;
        }

        // == handle renamed exports ==
        let maybeExportSpecifierLocal = findExportSpecifierPathForDeclaration(
          path,
          localName,
        );
        if (maybeExportSpecifierLocal !== undefined) {
          state.opts.declarations.push({
            localName,
            exportedAs: getExportedAsName(path, localName),
            path,
            type: 'class',
          });
        }
        return;
      }

      let sc = path.get('superClass');
      // == handle class that inherits from some super ==
      if (sc.isReferencedIdentifier()) {
        let classRef = makeClassReference(path.scope, sc.node.name, state);
        if (classRef) {
          // == handle card or field ==
          state.insideCard = true;
          let localName = getLocalName(path);

          let possibleCardOrField: PossibleCardOrFieldDeclaration = {
            super: classRef,
            localName,
            path,
            possibleFields: new Map(),
            exportedAs: getExportedAsName(path, localName),
            type: 'possibleCardOrField',
          };
          state.opts.possibleCardsOrFields.push(possibleCardOrField);
          state.opts.declarations.push(possibleCardOrField);
        } else {
          // == handle non-card or non-field ==
          if (t.isExportDeclaration(path.parentPath)) {
            let localName = getLocalName(path);
            state.opts.declarations.push({
              localName,
              exportedAs: getExportedAsName(path, localName),
              path,
              type: 'class',
            });
          }
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
    let decoratorInfo = getNamedImportInfo(path.scope, expression.node.name);
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

    let fieldCard = makeClassReference(path.scope, maybeFieldCardName, state);
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
};

//This visitor captures re-exports
const reExportVisitor = {
  ExportNamedDeclaration(
    path: NodePath<t.ExportNamedDeclaration>,
    state: State,
  ) {
    if (path.node.declaration === null) {
      //possibly flaky but it seems that only default
      //definition doesn't exist
      path.node.specifiers.forEach((specifier) => {
        if (t.isExportSpecifier(specifier)) {
          const localName = specifier.local.name;
          let codeDeclarationExists = state.opts.declarations.find(
            (d) => d.localName === localName,
          );
          if (!codeDeclarationExists) {
            state.opts.declarations.push({
              path,
              exportedAs: getExportedAsName(path, localName),
              localName: localName,
              type: 'reexport',
            });
          }
        } else {
          throw new Error('Unsupported export specifier');
        }
      });
    }
    if (path.node.source) {
      console.log('in export named blabal');
    }
  },
  ExportDefaultDeclaration(
    path: NodePath<t.ExportDefaultDeclaration>,
    state: State,
  ) {
    // Check if the exported value is an identifier (variable/reference)
    if (path.node.declaration.type === 'Identifier') {
      const localName = path.node.declaration.name;
      state.opts.declarations.push({
        path,
        exportedAs: 'default',
        localName,
        type: 'reexport',
      });
    }
  },

  ExportAllDeclaration(path: NodePath<t.ExportAllDeclaration>) {
    // Handle export all from another module
    // Example: export * from './module';
    if (path.node.source) {
      console.log('TODO: skipping handling this');
    }
  },
};

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

// find the local identifier of a class or function declaration that is used in an export specifier
function findExportSpecifierPathForDeclaration(
  path:
    | NodePath<t.ClassDeclaration>
    | NodePath<t.FunctionDeclaration>
    | NodePath<t.ExportNamedDeclaration>,
  localName: string | undefined,
): NodePath<t.Identifier> | undefined {
  // the class's identifier is referenced in a node whose parent is an ExportSpecifier
  let binding = localName ? path.scope.getBinding(localName) : undefined;
  if (binding) {
    return binding.referencePaths.find(
      (b) => b.parentPath?.isExportSpecifier(),
    ) as NodePath<t.Identifier> | undefined;
  }
  return undefined;
}

function getExportedAsName(
  path:
    | NodePath<t.ClassDeclaration>
    | NodePath<t.FunctionDeclaration>
    | NodePath<t.ExportNamedDeclaration>,
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
    // export named declaration seems to only occur here
    let maybeExportSpecifierLocal = findExportSpecifierPathForDeclaration(
      path,
      localName,
    );
    if (maybeExportSpecifierLocal !== undefined) {
      return getName(
        (maybeExportSpecifierLocal.parentPath as NodePath<t.ExportSpecifier>)
          .node.exported,
      );
    }
  }
  return;
}

function isBaseDefClass(path: NodePath<t.ClassDeclaration>): boolean {
  let localName = getLocalName(path);
  if (localName === 'BaseDef' && hasComputedProperty(path, 'isBaseInstance')) {
    return true;
  } else {
    return false;
  }
}

function hasComputedProperty(
  path: NodePath<t.ClassDeclaration>,
  propertyName: string,
): boolean {
  const classBody = path.node.body.body;
  return (
    classBody.some(
      (property) =>
        t.isClassProperty(property) &&
        property.computed &&
        t.isIdentifier(property.key) &&
        property.key.name === propertyName,
    ) || false
  );
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
  // if (binding?.path.isImportDefaultSpecifier()) {
  //   debugger;
  //   return {
  //     declaration: binding.path.parentPath,
  //     specifier: binding.path,
  //   };
  // }
  if (!binding?.path.isImportSpecifier()) {
    return undefined;
  }

  return {
    declaration: binding.path.parentPath as NodePath<t.ImportDeclaration>,
    specifier: binding.path,
  };
}

function getLocalName(
  path: NodePath<t.FunctionDeclaration> | NodePath<t.ClassDeclaration>,
) {
  return path.node.id ? path.node.id.name : undefined;
}

function getName(node: t.Identifier | t.StringLiteral) {
  if (node.type === 'Identifier') {
    return node.name;
  } else {
    return node.value;
  }
}

export function isPossibleCardOrFieldClassDeclaration(
  declaration: any,
): declaration is PossibleCardOrFieldDeclaration {
  let hasSuper = declaration.super;
  let isBase = isBaseDefClass(declaration.path);
  return (
    (isBase || hasSuper) &&
    typeof declaration.localName === 'string' &&
    declaration.possibleFields instanceof Map &&
    t.isClassDeclaration(declaration.path)
  );
}

export function isInternalReference(
  classReference: any,
): classReference is InternalReference {
  return classReference && classReference.type === 'internal';
}
