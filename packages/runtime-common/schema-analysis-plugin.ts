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
  exportName: string | undefined; //generally, all our cases should have an exportName
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
  type: ExternalReference | InternalReference;
  decorator: ExternalReference | InternalReference;
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
        insertOrReplace(
          {
            localName,
            exportName: getExportName(path, localName),
            path,
            type: 'function',
          },
          state.opts.declarations,
        );
      }
    },
  },
  ClassDeclaration: {
    enter(path: NodePath<t.ClassDeclaration>, state: State) {
      let localName = getLocalName(path);
      // == handle class that doesn't inherit from super ==
      if (!path.node.superClass) {
        // == handle base def ==
        if (isBaseDefClass(path)) {
          let possibleCardOrField: PossibleCardOrFieldDeclaration = {
            localName,
            path,
            possibleFields: new Map(),
            exportName: getExportName(path, localName),
            type: 'possibleCardOrField',
          };
          state.opts.possibleCardsOrFields.push(possibleCardOrField);
          insertOrReplace(possibleCardOrField, state.opts.declarations);
          return;
        }

        // == handle direct exports ==
        if (t.isExportDeclaration(path.parentPath)) {
          insertOrReplace(
            {
              localName,
              exportName: getExportName(path, localName),
              path,
              type: 'class',
            },
            state.opts.declarations,
          );
          return;
        }

        // == handle renamed exports ==
        let maybeExportSpecifierLocal = findExportSpecifierPathForDeclaration(
          path,
          localName,
        );
        if (maybeExportSpecifierLocal !== undefined) {
          insertOrReplace(
            {
              localName,
              exportName: getExportName(path, localName),
              path,
              type: 'class',
            },
            state.opts.declarations,
          );
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

          let possibleCardOrField: PossibleCardOrFieldDeclaration = {
            super: classRef,
            localName,
            path,
            possibleFields: new Map(),
            exportName: getExportName(path, localName),
            type: 'possibleCardOrField',
          };
          state.opts.possibleCardsOrFields.push(possibleCardOrField);
          insertOrReplace(possibleCardOrField, state.opts.declarations);
        } else {
          // == handle non-card or non-field ==
          if (t.isExportDeclaration(path.parentPath)) {
            insertOrReplace(
              {
                localName,
                exportName: getExportName(path, localName),
                path,
                type: 'class',
              },
              state.opts.declarations,
            );
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
    let isCardApiFile =
      path.node.loc &&
      'filename' in path.node.loc &&
      path.node.loc.filename === 'https://cardstack.com/base/card-api';
    let decoratorInfo = getNamedImportInfo(path.scope, expression.node.name);
    if (!decoratorInfo && !isCardApiFile) {
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
    if (!fieldTypeInfo && !isCardApiFile) {
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
      type: isCardApiFile
        ? { type: 'internal' }
        : {
            type: 'external',
            module: getName(fieldTypeInfo!.declaration.node.source),
            name: getName(fieldTypeInfo!.specifier.node.imported),
          },
      decorator: isCardApiFile
        ? { type: 'internal' }
        : {
            type: 'external',
            module: getName(decoratorInfo!.declaration.node.source),
            name: getName(decoratorInfo!.specifier.node.imported),
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
// - ones which enter the module scope (eg import { foo } from './some-module'; export { foo })
// - ones which do not enter the module scope (eg export { foo } from './some-module')
// Typically re-export refers to variables that are never entering the module scope
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
          insertOrReplace(
            {
              path,
              exportName: getExportName(path, localName),
              localName: localName,
              type: 'reexport',
            },
            state.opts.declarations,
          );
        } else {
          throw new Error('Unsupported export specifier');
        }
      });
    }
  },
  ExportDefaultDeclaration(
    path: NodePath<t.ExportDefaultDeclaration>,
    state: State,
  ) {
    // Check if the exported value is an identifier (variable/reference)
    if (path.node.declaration.type === 'Identifier') {
      const localName = path.node.declaration.name;
      insertOrReplace(
        {
          path,
          exportName: 'default',
          localName,
          type: 'reexport',
        },
        state.opts.declarations,
      );
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

// find the local identifier of a declaration that is referred in an export specifier as long as it enters the module scope
function findExportSpecifierPathForDeclaration(
  path:
    | NodePath<t.ClassDeclaration>
    | NodePath<t.FunctionDeclaration>
    | NodePath<t.ExportNamedDeclaration>,
  localName: string | undefined,
): NodePath<t.Identifier> | undefined {
  let binding = localName ? path.scope.getBinding(localName) : undefined;
  if (binding) {
    return binding.referencePaths.find((b) =>
      b.parentPath?.isExportSpecifier(),
    ) as NodePath<t.Identifier> | undefined;
  }
  return undefined;
}

// find the specifier of a declaration that is referred in an export specifier as long as it enters the module scope
function findExportSpecifierPathForNonBinding(
  path: NodePath<t.ExportNamedDeclaration>,
  localName: string | undefined,
): t.ExportSpecifier | undefined {
  if (path.node.source && path.node.specifiers) {
    let specifier = path.node.specifiers.find((specifier) => {
      if (t.isExportSpecifier(specifier)) {
        return specifier.local.name === localName;
      }
      return false;
    });
    if (t.isExportSpecifier(specifier)) {
      return specifier;
    }
  }
  return;
}

function getExportName(
  path:
    | NodePath<t.ClassDeclaration>
    | NodePath<t.FunctionDeclaration>
    | NodePath<t.ExportNamedDeclaration>,
  localName: string | undefined,
): string | undefined {
  let { parentPath } = path;
  if (parentPath.isExportNamedDeclaration()) {
    // eg handles scenario like export MyClass {} or export function foo(){}
    return localName;
  } else if (parentPath.isExportDefaultDeclaration()) {
    // eg export default class MyClass {}
    return 'default';
  } else {
    // case that enters the module scope
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
    // case that doesn't enter module scope
    // eg export { MyCard as SomeCard } from './some-module
    if (path.isExportNamedDeclaration()) {
      let maybeExportSpecifierNonBinding = findExportSpecifierPathForNonBinding(
        path,
        localName,
      );
      if (maybeExportSpecifierNonBinding) {
        return getName(maybeExportSpecifierNonBinding.exported);
      }
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
  if (!binding?.path.isImportSpecifier()) {
    return undefined;
  }

  return {
    declaration: binding.path.parentPath as NodePath<t.ImportDeclaration>,
    specifier: binding.path,
  };
}

// the local name always refers to a code declaration and not the variable its assigned to
// it doesn't refer to the variable a function or class is assigned to
function getLocalName(
  path: NodePath<t.FunctionDeclaration> | NodePath<t.ClassDeclaration>,
) {
  return path.node.id ? path.node.id.name : undefined;
}

// this is just a simple utility to get name
// most instances of usage are on t.Identifier
// t.StringLiteral do not occur often in our usage of schema, they either occur
// - as a value of a variable (eg let foo = 'apple'. 'apple' is the string literal)
// - as a value of node.source (eg import foo from 'some-module'. 'some-module' is the string literal)
export function getName(node: t.Identifier | t.StringLiteral) {
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

function insertOrReplace(item: Declaration, arr: Declaration[]) {
  let localName = item.localName;
  let existingDeclaration = arr.find((i) => {
    return i.localName === localName;
  });
  if (existingDeclaration) {
    if (
      item.type === 'possibleCardOrField' &&
      existingDeclaration.type === 'reexport'
    ) {
      let index = arr.indexOf(existingDeclaration);
      arr.splice(index, 1, item);
    }
  } else {
    arr.push(item);
  }
  return arr;
}

export function isEquivalentBodyPosition(
  path: NodePath | undefined,
  newPath: NodePath | undefined,
) {
  if (
    path?.node &&
    newPath?.node &&
    'body' in path.node &&
    'body' in newPath.node &&
    path.node.body &&
    newPath.node.body &&
    'loc' in path.node.body &&
    'loc' in newPath.node.body &&
    path.node.body.loc &&
    newPath.node.body.loc
  ) {
    let { start: newStart, end: newEnd } = newPath.node.body.loc;
    let { start, end } = path.node.body.loc;
    // @ts-expect-error Property 'token' does not exist on type '{ line: number; column: number; }'.
    return start.token === newStart.token && end.token === newEnd.token;
  }
  return false;
}
