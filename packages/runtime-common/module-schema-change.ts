import * as Babel from '@babel/core';
import { parse as babelParse } from '@babel/parser';
import generateModule from '@babel/generator';
import type { types as t } from '@babel/core';
import type { NodePath } from '@babel/traverse';
import {
  contentTagPreprocessor,
  loadContentTag,
} from './content-tag-loader.ts';
import { getBabelOptions } from './babel-options.ts';

// `@babel/generator` is CommonJS, and its default export arrives wrapped or
// not depending on which bundler or loader resolved it.
type Generate = (
  node: t.Node,
  options: { comments: boolean; compact: boolean },
) => { code: string };
const generate = ((generateModule as unknown as { default?: Generate })
  .default ?? generateModule) as unknown as Generate;

// Whether rewriting a module from `before` to `after` changes the schema its
// instances are serialized against, as far as reading the two sources can
// prove. `undefined` stands for a module that does not exist on that side.
//
// A schema change is what a write to another card in the realm has to wait
// out: staging a card resolves its type's fields, and a pass over a module
// whose schema moved re-derives that type and every type built on it. A
// change that leaves the schema alone — a template, a method body, a style,
// a helper — re-indexes the module's dependents without moving anything a
// staging write reads, so that pass need not hold other writers back.
//
// The schema is read off the source text rather than off the cards the module
// is known to declare, so a field is counted however it is spelled: through
// a namespace, a forward reference, a local alias, a class expression or an
// options object held in a variable. It is made of:
//
//   - every decorated member of every class — a `@field` and its value, an
//     `@operation` and its arguments — except Glimmer's `@tracked`, `@action`
//     and `@cached`, which hold component state. A field's compute function
//     is left out, since it computes a value without moving a stored one;
//   - every class's name, the class it extends, and its static members with
//     computed keys: the symbol-keyed hooks card-api reads to serialize,
//     deserialize and query a field's value;
//   - every module-level binding that aliases another (`const S = StringField`),
//     and every name the module exports, with what each one names;
//   - each import the parts above refer to, since an unchanged
//     `contains(StringField)` names a different field when the import it
//     resolves through moves.
//
// The answer is true only when the two schemas differ, or when the module did
// not parse before the write and declares a schema after it — a broken
// source between two versions must not hide the change across them. A
// source that does not parse after the write proves nothing, so it answers
// false; the module's dependents are still re-indexed, by a pass that does not
// hold other writers back.
export async function moduleSchemaChanged({
  url,
  before,
  after,
}: {
  url: string;
  before: string | undefined;
  after: string | undefined;
}): Promise<boolean> {
  await loadContentTag();
  let afterSchema = after === undefined ? emptySchema : readSchema(after, url);
  if (afterSchema === undefined) {
    return false;
  }
  let beforeSchema =
    before === undefined ? emptySchema : readSchema(before, url);
  if (beforeSchema === undefined) {
    return afterSchema !== emptySchema;
  }
  return beforeSchema !== afterSchema;
}

// A schema serialized to a string, so two can be compared with `===`. Every
// collection in it is sorted, so declaration order does not count as a change.
type Schema = string;

const emptySchema: Schema = JSON.stringify({
  classes: [],
  bindings: [],
  imports: [],
});

// Decorators that hold component state rather than declare anything about a
// card's data.
const COMPONENT_STATE_DECORATORS = new Set(['tracked', 'action', 'cached']);

interface ClassSchema {
  name: string;
  super: string | null;
  members: string[];
}

function readSchema(src: string, url: string): Schema | undefined {
  let ast: t.File;
  try {
    ast = babelParse(
      templatesToPlaceholders(src),
      getBabelOptions({ sourceFilename: url }),
    );
  } catch {
    return undefined;
  }

  let classes: ClassSchema[] = [];
  Babel.traverse(ast, {
    Class(path) {
      classes.push(readClass(path));
    },
  });

  let bindings = readBindings(ast);

  // The imports the schema refers to, found by the names it spells. A name
  // that only reads like one (a property key, say) costs at most an import
  // too many in the schema, never one too few.
  let referenced = new Set<string>();
  for (let text of [
    ...classes.flatMap((c) => [c.super ?? '', ...c.members]),
    ...bindings,
  ]) {
    for (let name of text.match(/[A-Za-z_$][\w$]*/g) ?? []) {
      referenced.add(name);
    }
  }
  let imports = [...importsOf(ast)]
    .filter(([local]) => referenced.has(local))
    .map(([local, origin]) => `${local}=${origin}`);

  let classesWithSchema = classes.filter(
    (c) => c.super !== null || c.members.length > 0,
  );
  if (
    classesWithSchema.length === 0 &&
    bindings.length === 0 &&
    imports.length === 0
  ) {
    return emptySchema;
  }
  return JSON.stringify({
    classes: classesWithSchema
      .map((c) => ({ ...c, members: c.members.sort() }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    bindings: bindings.sort(),
    imports: imports.sort(),
  });
}

function readClass(path: NodePath<t.Class>): ClassSchema {
  let node = path.node;
  let members: string[] = [];
  for (let member of node.body.body) {
    if (
      (member.type === 'ClassProperty' ||
        member.type === 'ClassMethod' ||
        member.type === 'ClassPrivateProperty' ||
        member.type === 'ClassPrivateMethod' ||
        member.type === 'ClassAccessorProperty') &&
      member.decorators?.length &&
      !member.decorators.every(isComponentStateDecorator)
    ) {
      members.push(printDecoratedMember(member));
    } else if (
      (member.type === 'ClassMethod' || member.type === 'ClassProperty') &&
      member.static &&
      member.computed
    ) {
      members.push(print(member));
    }
  }
  return {
    name: className(path),
    super: node.superClass ? print(node.superClass) : null,
    members,
  };
}

// A class's name, or for a class expression, where it is held: the binding
// or member it is assigned to, qualified by the class around it.
function className(path: NodePath<t.Class>): string {
  let own =
    path.node.id?.name ??
    (path.parentPath.isVariableDeclarator() &&
    path.parentPath.node.id.type === 'Identifier'
      ? path.parentPath.node.id.name
      : (path.parentPath.isClassProperty() ||
            path.parentPath.isObjectProperty()) &&
          !path.parentPath.node.computed &&
          path.parentPath.node.key.type === 'Identifier'
        ? path.parentPath.node.key.name
        : path.parentPath.isExportDefaultDeclaration()
          ? 'default'
          : '(anonymous)');
  let outer = path.parentPath.findParent((p) =>
    p.isClass(),
  ) as NodePath<t.Class> | null;
  return outer ? `${className(outer)}.${own}` : own;
}

function isComponentStateDecorator(decorator: t.Decorator): boolean {
  let expression = decorator.expression;
  return (
    expression.type === 'Identifier' &&
    COMPONENT_STATE_DECORATORS.has(expression.name)
  );
}

// A decorated member as written, less the parts that cannot move a stored
// value: a method's body, and a field's compute function.
function printDecoratedMember(
  member:
    | t.ClassProperty
    | t.ClassMethod
    | t.ClassPrivateProperty
    | t.ClassPrivateMethod
    | t.ClassAccessorProperty,
): string {
  let types = Babel.types;
  let copy = types.cloneNode(member, true, true);
  if (copy.type === 'ClassMethod' || copy.type === 'ClassPrivateMethod') {
    copy.body = types.blockStatement([]);
  } else if (copy.value?.type === 'CallExpression') {
    copy.value.arguments = copy.value.arguments.map((arg, index) =>
      index > 0 ? withoutComputeFunction(arg) : arg,
    );
  }
  return print(copy);
}

type CallArgument = t.CallExpression['arguments'][number];

// A field's compute function stands in a field function's options, or, in
// the older form, as the argument after the field's class. Either is swapped
// for a marker, so the field still reads as computed, whatever it computes.
function withoutComputeFunction(arg: CallArgument): CallArgument {
  let types = Babel.types;
  if (
    arg.type === 'FunctionExpression' ||
    arg.type === 'ArrowFunctionExpression'
  ) {
    return types.identifier('computeVia');
  }
  if (arg.type !== 'ObjectExpression') {
    return arg;
  }
  arg.properties = arg.properties.map((property) => {
    if (isNamed(property, 'computeVia')) {
      return types.objectProperty(
        types.identifier('computeVia'),
        types.identifier('computeVia'),
      );
    }
    return property;
  });
  return arg;
}

function isNamed(
  property: t.ObjectExpression['properties'][number],
  name: string,
): boolean {
  return (
    (property.type === 'ObjectProperty' || property.type === 'ObjectMethod') &&
    !property.computed &&
    ((property.key.type === 'Identifier' && property.key.name === name) ||
      (property.key.type === 'StringLiteral' && property.key.value === name))
  );
}

// The module-level bindings that can stand in for a field's class or its
// options, and every name the module exports.
//
// A binding counts when its value is another name (`const S = StringField`,
// `export const Active = Base.StringField`) or an object (a field's options
// held in a variable). So does every export that can name a class: one of a
// class, of an alias, or of an imported binding, with where it comes from. An
// export of a function or of any other value is left out, since neither names
// a type, and a function's body is no part of a schema.
function readBindings(ast: t.File): string[] {
  let imports = importsOf(ast);
  let bindings: string[] = [];
  let kinds = new Map<string, string>();
  for (let statement of ast.program.body) {
    let declaration: t.Node | null | undefined = statement;
    if (statement.type === 'ExportNamedDeclaration') {
      declaration = statement.declaration;
    } else if (statement.type === 'ExportDefaultDeclaration') {
      declaration = statement.declaration;
    }
    if (declaration?.type === 'VariableDeclaration') {
      for (let declarator of declaration.declarations) {
        if (declarator.id.type !== 'Identifier') {
          continue;
        }
        let init = declarator.init;
        if (
          init &&
          (init.type === 'Identifier' ||
            init.type === 'MemberExpression' ||
            init.type === 'ObjectExpression')
        ) {
          let value =
            init.type === 'ObjectExpression'
              ? withoutComputeFunction(Babel.types.cloneNode(init, true, true))
              : init;
          bindings.push(`${declarator.id.name}=${print(value)}`);
          kinds.set(declarator.id.name, 'alias');
        } else {
          kinds.set(declarator.id.name, 'value');
        }
      }
    } else if (
      (declaration?.type === 'FunctionDeclaration' ||
        declaration?.type === 'ClassDeclaration') &&
      declaration.id
    ) {
      kinds.set(
        declaration.id.name,
        declaration.type === 'FunctionDeclaration' ? 'function' : 'class',
      );
    }
  }

  let origin = (local: string) =>
    imports.get(local) ?? `local:${kinds.get(local) ?? 'unknown'}:${local}`;
  let exportBinding = (exported: string, from: string) => {
    if (!from.startsWith('local:function') && !from.startsWith('local:value')) {
      bindings.push(`export ${exported}=${from}`);
    }
  };
  for (let statement of ast.program.body) {
    if (statement.type === 'ExportAllDeclaration') {
      bindings.push(`export *=${statement.source.value}#*`);
    } else if (statement.type === 'ExportNamedDeclaration') {
      if (statement.declaration) {
        for (let name of declaredNames(statement.declaration)) {
          exportBinding(name, origin(name));
        }
      }
      for (let specifier of statement.specifiers) {
        let exported = nameOf(specifier.exported);
        if (specifier.type === 'ExportSpecifier') {
          exportBinding(
            exported,
            statement.source
              ? `${statement.source.value}#${specifier.local.name}`
              : origin(specifier.local.name),
          );
        } else {
          bindings.push(`export ${exported}=${statement.source?.value}#*`);
        }
      }
    } else if (statement.type === 'ExportDefaultDeclaration') {
      let declaration = statement.declaration;
      exportBinding(
        'default',
        declaration.type === 'Identifier'
          ? origin(declaration.name)
          : declaration.type === 'FunctionDeclaration'
            ? 'local:function'
            : declaration.type === 'ClassDeclaration'
              ? `local:class:${declaration.id?.name ?? 'default'}`
              : print(declaration),
      );
    }
  }
  return bindings;
}

function declaredNames(declaration: t.Declaration): string[] {
  if (declaration.type === 'VariableDeclaration') {
    return declaration.declarations.flatMap((d) =>
      d.id.type === 'Identifier' ? [d.id.name] : [],
    );
  }
  if (
    (declaration.type === 'FunctionDeclaration' ||
      declaration.type === 'ClassDeclaration' ||
      declaration.type === 'TSEnumDeclaration') &&
    declaration.id
  ) {
    return [declaration.id.name];
  }
  return [];
}

// Each imported local name, with the module and the name it is imported as.
function importsOf(ast: t.File): Map<string, string> {
  let imports = new Map<string, string>();
  for (let statement of ast.program.body) {
    if (statement.type !== 'ImportDeclaration') {
      continue;
    }
    for (let specifier of statement.specifiers) {
      let imported =
        specifier.type === 'ImportSpecifier'
          ? nameOf(specifier.imported)
          : specifier.type === 'ImportDefaultSpecifier'
            ? 'default'
            : '*';
      imports.set(
        specifier.local.name,
        `${statement.source.value}#${imported}`,
      );
    }
  }
  return imports;
}

function nameOf(node: t.Identifier | t.StringLiteral): string {
  return node.type === 'Identifier' ? node.name : node.value;
}

// Code without comments or formatting, so only a change to the code itself
// reads as one.
function print(node: t.Node): string {
  return generate(node, { comments: false, compact: true }).code;
}

// Each `<template>` swapped for code that parses where the template stands
// and declares nothing: an expression where it is a value, and an empty
// static block where it is a member of a class body. A template never
// declares a field, so its contents are left out entirely.
function templatesToPlaceholders(src: string): string {
  let matches = contentTagPreprocessor().parse(src);
  if (matches.length === 0) {
    return src;
  }
  // Sliced as an array of code points, the unit content-tag reports
  // character ranges in, so a multi-byte character ahead of a template does
  // not shift every range after it.
  let chars = Array.from(src);
  let output: string[] = [];
  let offset = 0;
  for (let match of matches) {
    output.push(chars.slice(offset, match.range.startChar).join(''));
    output.push(
      match.type === 'class-member' ? ';static {}' : 'templatePlaceholder()',
    );
    offset = match.range.endChar;
  }
  output.push(chars.slice(offset).join(''));
  return output.join('');
}
