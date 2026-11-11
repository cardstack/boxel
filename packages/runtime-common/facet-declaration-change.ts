import * as Babel from '@babel/core';
import { parse as babelParse } from '@babel/parser';
import generateModule from '@babel/generator';
import type { types as t } from '@babel/core';
import {
  contentTagPreprocessor,
  loadContentTag,
} from './content-tag-loader.ts';
import { getBabelOptions } from './babel-options.ts';

// Whether rewriting a module from `before` to `after` changes nothing but
// facet declarations. Such a write leaves every card's search doc and rendered
// HTML as they were, so the realm rewrites the facet table from the indexed
// search docs (`backfillFacetValues`) instead of rendering the module's
// dependents again (docs/search.md, Facets).
//
// Decided on the parsed modules, never on their text: the change is
// facet-only exactly when the two ASTs are identical once these are taken out
// of both:
//   (a) a `facet` property of a `search: { … }` object passed to a field
//       factory in an `@field` initializer;
//   (b) a `search: {}` that (a) left empty, and an options object that (b)
//       left empty in turn;
//   (c) a class's `static facetValue` member.
// Templates are kept, character for character, as string literals, so any
// change to one (its whitespace included) is a change. Comments count too.
// A module either side that does not parse answers false. A false "no" costs
// a render; a false "yes" would leave stale cards, so every doubt answers no.

type Generate = (
  node: t.Node,
  options: { comments: boolean; compact: boolean },
) => { code: string };
const generate = ((generateModule as unknown as { default?: Generate })
  .default ?? generateModule) as unknown as Generate;

export async function moduleChangeIsOnlyFacetDeclarations(
  before: string | undefined,
  after: string | undefined,
  url = 'module.gts',
): Promise<boolean> {
  if (before === undefined || after === undefined || before === after) {
    return false;
  }
  await loadContentTag();
  let a = withoutFacetDeclarations(before, url);
  let b = withoutFacetDeclarations(after, url);
  return a !== undefined && b !== undefined && a === b;
}

// The module, with its facet declarations taken out, generated back to code
// (`undefined` when it does not parse).
function withoutFacetDeclarations(
  src: string,
  url: string,
): string | undefined {
  let ast: t.File;
  try {
    ast = babelParse(
      templatesAsLiterals(src),
      getBabelOptions({ sourceFilename: url }),
    );
  } catch {
    return undefined;
  }
  Babel.traverse(ast, {
    ClassProperty(path) {
      let node = path.node;
      if (node.static && !node.computed && isNamed(node.key, 'facetValue')) {
        path.remove();
        return;
      }
      if (isFieldDeclaration(node) && node.value?.type === 'CallExpression') {
        stripFacetOptions(node.value);
      }
    },
  });
  return generate(ast, { comments: true, compact: true }).code;
}

function isNamed(node: t.Node, name: string): boolean {
  return (
    (node.type === 'Identifier' && node.name === name) ||
    (node.type === 'StringLiteral' && node.value === name)
  );
}

function isFieldDeclaration(node: t.ClassProperty): boolean {
  return (node.decorators ?? []).some(
    (d) => d.expression.type === 'Identifier' && d.expression.name === 'field',
  );
}

function stripFacetOptions(call: t.CallExpression): void {
  call.arguments = call.arguments.filter((arg) => {
    if (arg.type !== 'ObjectExpression') {
      return true;
    }
    let touched = false;
    arg.properties = arg.properties.filter((prop) => {
      if (
        prop.type !== 'ObjectProperty' ||
        prop.computed ||
        !isNamed(prop.key, 'search') ||
        prop.value.type !== 'ObjectExpression'
      ) {
        return true;
      }
      let search = prop.value;
      let count = search.properties.length;
      search.properties = search.properties.filter(
        (p) =>
          !(
            p.type === 'ObjectProperty' &&
            !p.computed &&
            isNamed(p.key, 'facet')
          ),
      );
      if (search.properties.length < count) {
        touched = true;
        // (b): a search object only `facet` held goes with it.
        return search.properties.length > 0;
      }
      return true;
    });
    // (b): an options object only that search object held goes too.
    return !(touched && arg.properties.length === 0);
  });
}

// Each `<template>` replaced by a call holding its exact text as a string
// literal, so the parse sees it and a change to it is a change to the AST.
function templatesAsLiterals(src: string): string {
  let matches = contentTagPreprocessor().parse(src);
  if (matches.length === 0) {
    return src;
  }
  // Sliced as code points, the unit content-tag reports ranges in.
  let chars = Array.from(src);
  let output: string[] = [];
  let offset = 0;
  for (let match of matches) {
    output.push(chars.slice(offset, match.range.startChar).join(''));
    let text = JSON.stringify(
      chars.slice(match.range.startChar, match.range.endChar).join(''),
    );
    output.push(
      match.type === 'class-member'
        ? `;static __template = templateLiteral(${text});`
        : `templateLiteral(${text})`,
    );
    offset = match.range.endChar;
  }
  output.push(chars.slice(offset).join(''));
  return output.join('');
}
