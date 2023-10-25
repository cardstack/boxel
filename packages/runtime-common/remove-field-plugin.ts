import type {
  PossibleCardOrFieldClass,
  PossibleField,
} from './schema-analysis-plugin';
import { types as t } from '@babel/core';
import { NodePath } from '@babel/traverse';

interface State {
  opts: Options;
  insideCard: boolean;
}

export interface Options {
  card: PossibleCardOrFieldClass;
  field: PossibleField;
}
export function removeFieldPlugin() {
  return {
    visitor: {
      ImportDeclaration(path: NodePath<t.ImportDeclaration>, state: State) {
        maybeRemoveFieldDecoratorImport(path, state);
        maybeRemoveFieldTypeImport(path, state);
        maybeRemoveFieldClassImport(path, state);
      },
      ClassProperty(path: NodePath<t.ClassProperty>, state: State) {
        if (
          path.node.key.type === 'Identifier' &&
          path.node.key.name ===
            (state.opts.field.path.node.key as t.Identifier).name
        ) {
          path.remove();
        }
      },
    },
  };
}

function maybeRemoveFieldDecoratorImport(
  path: NodePath<t.ImportDeclaration>,
  state: State,
) {
  if (path.node.source.value !== state.opts.field.decorator.module) {
    return;
  }
  let specifier = getImportSpecifier(path, state.opts.field.decorator.name) as
    | NodePath<t.ImportSpecifier>
    | undefined;
  if (!specifier) {
    return;
  }
  let references = getOtherReferences(
    path,
    specifier.node.local.name,
    (state.opts.field.path.node.key as t.Identifier).name,
  );
  if (references?.length === 0) {
    specifier.remove();
  }
}

function maybeRemoveFieldTypeImport(
  path: NodePath<t.ImportDeclaration>,
  state: State,
) {
  if (path.node.source.value !== state.opts.field.type.module) {
    return;
  }
  let specifier = getImportSpecifier(path, state.opts.field.type.name) as
    | NodePath<t.ImportSpecifier>
    | undefined;
  if (!specifier) {
    return;
  }
  let references = getOtherReferences(
    path,
    specifier.node.local.name,
    (state.opts.field.path.node.key as t.Identifier).name,
  );
  if (references?.length === 0) {
    specifier.remove();
  }
}

function maybeRemoveFieldClassImport(
  path: NodePath<t.ImportDeclaration>,
  state: State,
) {
  if (
    state.opts.field.card.type !== 'external' ||
    path.node.source.value !== state.opts.field.card.module
  ) {
    return;
  }
  let specifier = getImportSpecifier(path, state.opts.field.card.name);
  if (!specifier) {
    return;
  }
  let references = getOtherReferences(
    path,
    specifier.node.local.name,
    (state.opts.field.path.node.key as t.Identifier).name,
  );
  if (references?.length === 0) {
    if (path.get('specifiers').length === 1) {
      path.remove();
    } else {
      specifier.remove();
    }
  }
}

function getImportSpecifier(
  path: NodePath<t.ImportDeclaration>,
  name: string,
):
  | NodePath<t.ImportSpecifier>
  | NodePath<t.ImportDefaultSpecifier>
  | undefined {
  if (name === 'default') {
    return path
      .get('specifiers')
      .find((s) => s.node.type === 'ImportDefaultSpecifier') as
      | NodePath<t.ImportDefaultSpecifier>
      | undefined;
  }
  return path
    .get('specifiers')
    .find(
      (s) =>
        s.node.type === 'ImportSpecifier' && getName(s.node.imported) === name,
    ) as NodePath<t.ImportSpecifier> | undefined;
}

function getOtherReferences(
  path: NodePath<t.ImportDeclaration>,
  localName: string,
  fieldName: string,
): NodePath<t.Node>[] | undefined {
  let binding = path.scope.getBinding(localName);
  if (!binding) {
    return undefined;
  }
  return binding.referencePaths.filter((p) => {
    // we kinda got lucky that the 3 specific scenarios in which we search for
    // references all are 2 parents removed from the class property path
    let maybeClassProperty = p.parentPath?.parentPath?.node;
    if (maybeClassProperty?.type !== 'ClassProperty') {
      return true;
    }
    if (maybeClassProperty.key.type !== 'Identifier') {
      return true;
    }
    return maybeClassProperty.key.name !== fieldName;
  });
}

function getName(node: t.Identifier | t.StringLiteral) {
  if (node.type === 'Identifier') {
    return node.name;
  } else {
    return node.value;
  }
}
