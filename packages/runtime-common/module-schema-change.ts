import * as Babel from '@babel/core';
import { parse as babelParse } from '@babel/parser';
import type { types as t } from '@babel/core';
import type { NodePath } from '@babel/traverse';
//@ts-ignore unsure where these types live
import decoratorsPlugin from '@babel/plugin-syntax-decorators';
//@ts-ignore unsure where these types live
import classPropertiesPlugin from '@babel/plugin-syntax-class-properties';
//@ts-ignore unsure where these types live
import typescriptPlugin from '@babel/plugin-syntax-typescript';
import {
  schemaAnalysisPlugin,
  type ClassReference,
  type Options,
  type PossibleCardOrFieldDeclaration,
} from './schema-analysis-plugin.ts';
import {
  contentTagPreprocessor,
  loadContentTag,
} from './content-tag-loader.ts';
import { getBabelOptions } from './babel-options.ts';

// Whether rewriting a module from `before` to `after` changes the schema its
// instances are serialized against, as far as reading the two sources can
// prove. `undefined` stands for a module that does not exist on that side.
//
// A schema change is what a write to another card in the realm has to wait
// out: staging a card resolves its type's fields, and a pass over a module
// whose schema moved re-derives that type. A change that leaves the schema
// alone — a template, a method body, a style, a helper — re-indexes the
// module's dependents without moving anything a staging write reads, so that
// pass need not hold other writers back.
//
// The schema is read off each card or field class the module declares: its
// export name, the class it extends, and each `@field` — its name, the field
// function (`contains`, `linksTo`, ...) and the decorator it was declared
// with, the class it holds, and the keys of its options, which is where a
// field becomes computed (`computeVia`) or query-backed (`query`). The static
// symbol-keyed members of those classes (`static [serialize]`,
// `[deserialize]`, `[queryableValue]`, ...) are part of it too, compared by
// their code, since they decide how a field's value is stored. So are the
// names a module re-exports from other modules, because a code ref can name a
// card through one.
//
// The answer is true only when both sides can be read and their schemas
// differ. A source that does not parse proves nothing about the schema, so it
// answers false; the module's dependents are still re-indexed, by a pass that
// does not hold other writers back.
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
  let beforeSchema =
    before === undefined ? emptySchema : readSchema(before, url);
  let afterSchema = after === undefined ? emptySchema : readSchema(after, url);
  if (beforeSchema === undefined || afterSchema === undefined) {
    return false;
  }
  return beforeSchema !== afterSchema;
}

// A schema serialized to a string, so two can be compared with `===`. Every
// collection in it is sorted, so declaration order does not count as a change.
type Schema = string;

const emptySchema: Schema = JSON.stringify({ classes: [], reexports: [] });

function readSchema(src: string, url: string): Schema | undefined {
  let analysis: Options = { possibleCardsOrFields: [], declarations: [] };
  let ast: t.File;
  try {
    let preprocessed = templatesToPlaceholders(src);
    ast = babelParse(preprocessed, getBabelOptions({ sourceFilename: url }));
    Babel.transformFromAstSync(ast, preprocessed, {
      code: false,
      ast: false,
      cloneInputAst: false,
      configFile: false,
      babelrc: false,
      plugins: [
        typescriptPlugin,
        [decoratorsPlugin, { legacy: true }],
        classPropertiesPlugin,
        [schemaAnalysisPlugin, analysis],
      ],
    });
  } catch {
    return undefined;
  }

  let classes = analysis.possibleCardsOrFields;
  let refName = (ref: ClassReference | undefined) => {
    if (!ref) {
      return null;
    }
    if (ref.type === 'external') {
      return `${ref.module}#${ref.name}`;
    }
    // An internal reference is an index into this module's own classes,
    // which moves whenever a class is added ahead of it, so it is named by
    // the class it points at instead.
    let target =
      ref.classIndex === undefined ? undefined : classes[ref.classIndex];
    return `local#${target?.localName ?? '?'}`;
  };

  let schema = {
    classes: classes
      .map((declaration) => ({
        localName: declaration.localName ?? null,
        exportName: declaration.exportName ?? null,
        super: refName(declaration.super),
        fields: [...declaration.possibleFields.entries()]
          .map(([name, field]) => ({
            name,
            card: refName(field.card),
            type: refName(field.type),
            decorator: refName(field.decorator),
            options: fieldOptionKeys(field.path),
          }))
          .sort(byName),
        hooks: staticSymbolMembers(declaration),
      }))
      .sort((a, b) => (a.localName ?? '').localeCompare(b.localName ?? '')),
    reexports: reexportsOf(ast).sort(),
  };
  return JSON.stringify(schema);
}

function byName(a: { name: string }, b: { name: string }) {
  return a.name.localeCompare(b.name);
}

// The keys of a field's options object, which is what decides whether the
// field is stored, computed or query-backed. The option values are left out:
// a field's description or a computed field's function moves no stored
// value. Options that are not an object literal cannot be read, and read as
// one opaque marker on both sides.
function fieldOptionKeys(path: NodePath<t.ClassProperty>): string[] | string {
  let call = path.node.value;
  if (call?.type !== 'CallExpression') {
    return [];
  }
  let options = call.arguments[1];
  if (!options) {
    return [];
  }
  if (
    options.type === 'FunctionExpression' ||
    options.type === 'ArrowFunctionExpression'
  ) {
    // A function in this position is a field's compute function.
    return ['computeVia'];
  }
  if (options.type !== 'ObjectExpression') {
    return 'opaque';
  }
  return options.properties
    .map((property) => {
      if (
        (property.type === 'ObjectProperty' ||
          property.type === 'ObjectMethod') &&
        !property.computed
      ) {
        if (property.key.type === 'Identifier') {
          return property.key.name;
        }
        if (property.key.type === 'StringLiteral') {
          return property.key.value;
        }
      }
      return '...';
    })
    .sort();
}

// The code of each static member of a card or field class whose key is
// computed — the symbol-keyed hooks card-api reads to serialize, deserialize
// and query a field's value. Printed without comments or formatting, so only
// a change to the code itself counts.
function staticSymbolMembers(
  declaration: PossibleCardOrFieldDeclaration,
): string[] {
  let members: string[] = [];
  for (let member of declaration.path.node.body.body) {
    if (
      (member.type === 'ClassMethod' || member.type === 'ClassProperty') &&
      member.static &&
      member.computed
    ) {
      members.push(printClassMember(member));
    }
  }
  return members.sort();
}

function printClassMember(member: t.ClassMethod | t.ClassProperty): string {
  let types = Babel.types;
  let file = types.file(
    types.program([
      types.classDeclaration(
        types.identifier('Member'),
        null,
        types.classBody([types.cloneNode(member, true, true)]),
      ),
    ]),
  );
  let result = Babel.transformFromAstSync(file, undefined, {
    code: true,
    ast: false,
    comments: false,
    compact: true,
    configFile: false,
    babelrc: false,
  });
  return result?.code ?? '';
}

// The names this module exports that another module defines, each with where
// it comes from: `export { X } from './x'`, `export * from './x'`, and an
// import that is exported again.
function reexportsOf(ast: t.File): string[] {
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

  let reexports: string[] = [];
  for (let statement of ast.program.body) {
    if (statement.type === 'ExportAllDeclaration') {
      reexports.push(`*=${statement.source.value}#*`);
    } else if (
      statement.type === 'ExportNamedDeclaration' &&
      !statement.declaration
    ) {
      for (let specifier of statement.specifiers) {
        if (specifier.type === 'ExportSpecifier') {
          let exported = nameOf(specifier.exported);
          let origin = statement.source
            ? `${statement.source.value}#${specifier.local.name}`
            : imports.get(specifier.local.name);
          if (origin) {
            reexports.push(`${exported}=${origin}`);
          }
        } else if (specifier.type === 'ExportNamespaceSpecifier') {
          reexports.push(
            `${nameOf(specifier.exported)}=${statement.source?.value}#*`,
          );
        } else if (specifier.type === 'ExportDefaultSpecifier') {
          reexports.push(`default=${statement.source?.value}#default`);
        }
      }
    } else if (
      statement.type === 'ExportDefaultDeclaration' &&
      statement.declaration.type === 'Identifier'
    ) {
      let origin = imports.get(statement.declaration.name);
      if (origin) {
        reexports.push(`default=${origin}`);
      }
    }
  }
  return reexports;
}

function nameOf(node: t.Identifier | t.StringLiteral): string {
  return node.type === 'Identifier' ? node.name : node.value;
}

// Each `<template>` swapped for an expression that parses wherever a template
// can stand: as a value, and as a computed member key in a class body. A
// template never declares a field, so its contents are left out entirely.
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
    output.push('[templatePlaceholder()]');
    offset = match.range.endChar;
  }
  output.push(chars.slice(offset).join(''));
  return output.join('');
}
