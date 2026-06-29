// Source rewriter for the `searchable` migration. Given a `.gts`/`.ts` card
// module and a per-class policy (what the DB derivation observed, plus whether
// a def had zero instances), it:
//
//   * strips every `isUsed` option from relationship/field declarations
//     (unconditionally — the option is going away);
//   * adds/updates a `searchable` option on a relationship/field declaration to
//     the value the derivation observed; and
//   * for a zero-instance card def (no search doc to read), defaults each of its
//     non-query-backed `linksTo` / `linksToMany` fields to `searchable: true`
//     (depth-1) for resilience.
//
// Query-backed relationships (an options object carrying a `query`) are never
// annotated — `searchable` is inert on them — though their `isUsed` is still
// stripped.
//
// It reuses the exact gjsToPlaceholderJS → recast/@babel → placeholderJSToGJS
// pipeline the `context-search` codemod uses, so `<template>` blocks survive and
// formatting is preserved for everything it doesn't touch. A module whose source
// can't be parsed throws — the caller skips and reports it (§6).

import { parse as recastParse, print as recastPrint } from 'recast';
import { parse as babelParse } from '@babel/parser';
import {
  gjsToPlaceholderJS,
  placeholderJSToGJS,
} from '@cardstack/runtime-common/module-syntax';
import { getBabelOptions } from '@cardstack/runtime-common/babel-options';

// Mirror of `Searchable` in packages/base/card-api.gts.
export type Searchable = true | string | string[];

const FIELD_FNS = new Set([
  'contains',
  'containsMany',
  'linksTo',
  'linksToMany',
]);
const RELATIONSHIP_FNS = new Set(['linksTo', 'linksToMany']);

// What the caller knows about one class in this module.
export interface ClassPolicy {
  // Per-field `searchable` the DB derivation observed. Present (possibly empty)
  // iff the def had indexed instances. A field absent from this map kept every
  // relationship `{ id }` and gets no annotation.
  observed?: Record<string, Searchable>;
  // The def is an instantiable card def with zero indexed instances: default its
  // non-query-backed relationship fields to `searchable: true`.
  defaultRelationshipsToTrue?: boolean;
}

export interface AppliedChange {
  className: string | null;
  fieldName: string;
  fieldType: string;
  setSearchable?: Searchable;
  strippedIsUsed?: boolean;
}

export interface SkippedField {
  className: string | null;
  fieldName: string;
  reason: string;
}

// An observed route whose head field is not declared on the matched class —
// almost always an inherited field (e.g. `cardInfo` lives on base CardDef). The
// annotation can't be applied to the subclass source; it belongs on the
// declaring def. Reported so these are handled deliberately, never dropped
// silently.
export interface UnappliedObserved {
  className: string | null;
  fieldName: string;
  value: Searchable;
}

export interface TransformResult {
  status: 'transformed' | 'unchanged';
  output: string;
  changes: AppliedChange[];
  // Relationship/field declarations we recognized but could not safely edit
  // (e.g. non-literal options). The caller tracks these so we can extend the
  // codemod to handle them.
  skipped: SkippedField[];
  // Observed routes whose field isn't declared on the class (inherited fields).
  unapplied: UnappliedObserved[];
}

export interface TransformOptions {
  filename: string;
  // Returns the policy for a class by its declared name, or undefined when the
  // caller has nothing to apply (the class still gets `isUsed` stripped).
  policyForClass: (className: string | null) => ClassPolicy | undefined;
}

function recastParseJs(src: string, filename: string): any {
  return recastParse(src, {
    parser: {
      parse: (source: string) =>
        babelParse(source, getBabelOptions({ sourceFilename: filename })),
    },
  });
}

// Depth-first walk over the Babel AST, invoking `visit` on every node. Mirrors
// context-search's `walkBabel`; skips positional/metadata keys.
const SKIP_KEYS = new Set([
  'loc',
  'start',
  'end',
  'type',
  'range',
  'extra',
  'comments',
  'leadingComments',
  'trailingComments',
  'innerComments',
  'tokens',
  'errors',
]);

function walk(node: any, visit: (n: any) => void): void {
  if (!node || typeof node !== 'object') {
    return;
  }
  if (Array.isArray(node)) {
    for (let child of node) {
      walk(child, visit);
    }
    return;
  }
  if (typeof node.type === 'string') {
    visit(node);
  }
  for (let key of Object.keys(node)) {
    if (SKIP_KEYS.has(key)) {
      continue;
    }
    walk(node[key], visit);
  }
}

function classNameOf(classNode: any): string | null {
  return classNode?.id?.type === 'Identifier' ? classNode.id.name : null;
}

function propKeyName(node: any): string | null {
  if (!node) {
    return null;
  }
  if (node.type === 'Identifier') {
    return node.name;
  }
  if (node.type === 'StringLiteral') {
    return node.value;
  }
  return null;
}

// An ObjectExpression property whose key is `name` (handles identifier and
// string-literal keys, skips spreads).
function findObjectProp(objExpr: any, name: string): any {
  return objExpr.properties.find(
    (p: any) =>
      (p.type === 'ObjectProperty' || p.type === 'Property') &&
      !p.computed &&
      propKeyName(p.key) === name,
  );
}

// Render a Searchable as JS literal source. Single quotes to match the repo's
// eslint/prettier style (the caller doesn't reformat .gts standalone — eslint
// --fix is the formatting authority at commit). Path segments are field
// identifiers / dotted paths, so they never contain a quote to escape.
function quote(s: string): string {
  return `'${s}'`;
}
function searchableLiteralSource(value: Searchable): string {
  if (value === true) {
    return 'true';
  }
  if (typeof value === 'string') {
    return quote(value);
  }
  return '[' + value.map((s) => quote(s)).join(', ') + ']';
}

// Build AST nodes by parsing a snippet (matching context-search's approach) so
// we depend only on recast + @babel/parser, not @babel/types. Parsing through a
// `let __v = <expr>;` binding avoids both string-literal directive promotion and
// recast's parenthesization artifacts that a bare `(<expr>)` wrapper leaves.
function parseValue(src: string, filename: string): any {
  let ast = recastParseJs(`let __v = ${src};`, filename);
  return ast.program.body[0].declarations[0].init;
}

function searchableValueNode(value: Searchable, filename: string): any {
  return parseValue(searchableLiteralSource(value), filename);
}

function searchablePropNode(value: Searchable, filename: string): any {
  return searchableObjectNode(value, filename).properties[0];
}

// A whole `{ searchable: <value> }` object. Assigning this as the options
// argument (rather than creating `{}` and pushing a property) makes recast
// print it inline, matching the repo's `{ isUsed: true }` convention.
function searchableObjectNode(value: Searchable, filename: string): any {
  return parseValue(
    `{ searchable: ${searchableLiteralSource(value)} }`,
    filename,
  );
}

// Read a literal `searchable` value back out of an AST node, for idempotent
// re-runs (skip rewriting a field whose annotation already matches). Returns
// undefined for any non-literal / unrecognized shape.
function readSearchableFromNode(node: any): Searchable | undefined {
  if (!node) {
    return undefined;
  }
  if (node.type === 'BooleanLiteral' && node.value === true) {
    return true;
  }
  if (node.type === 'StringLiteral') {
    return node.value;
  }
  if (node.type === 'ArrayExpression') {
    let out: string[] = [];
    for (let el of node.elements) {
      if (el?.type !== 'StringLiteral') {
        return undefined;
      }
      out.push(el.value);
    }
    return out;
  }
  return undefined;
}

function searchableEquals(a: Searchable, b: Searchable | undefined): boolean {
  if (b === undefined) {
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((v, i) => v === b[i])
    );
  }
  return a === b;
}

// Returns the field name when `classProp` is a recognized field declaration
// (so the caller can track which declared fields it saw), else null.
function rewriteFieldProperty(
  classProp: any,
  className: string | null,
  policy: ClassPolicy | undefined,
  changes: AppliedChange[],
  skipped: SkippedField[],
  filename: string,
): string | null {
  let call = classProp.value;
  if (!call || call.type !== 'CallExpression') {
    return null;
  }
  if (call.callee?.type !== 'Identifier' || !FIELD_FNS.has(call.callee.name)) {
    return null;
  }
  let fieldType = call.callee.name;
  let fieldName = propKeyName(classProp.key);
  if (!fieldName) {
    return null;
  }

  let optionsArg = call.arguments[1];
  let hasOptions = optionsArg != null;
  if (hasOptions && optionsArg.type !== 'ObjectExpression') {
    // Options passed as a variable / spread — we can't statically strip or add.
    skipped.push({
      className,
      fieldName,
      reason: `${fieldType} options are not an object literal`,
    });
    return fieldName;
  }

  let applied: AppliedChange = { className, fieldName, fieldType };
  let changed = false;

  // 1) Strip isUsed (unconditional).
  if (hasOptions) {
    let before = optionsArg.properties.length;
    optionsArg.properties = optionsArg.properties.filter(
      (p: any) => propKeyName(p?.key) !== 'isUsed' || p.computed,
    );
    if (optionsArg.properties.length !== before) {
      applied.strippedIsUsed = true;
      changed = true;
    }
  }

  // 2) Decide the searchable value to apply.
  let isQueryBacked =
    hasOptions && Boolean(findObjectProp(optionsArg, 'query'));
  let desired: Searchable | undefined;
  if (policy?.observed && fieldName in policy.observed) {
    desired = policy.observed[fieldName];
  } else if (
    policy?.defaultRelationshipsToTrue &&
    RELATIONSHIP_FNS.has(fieldType) &&
    !isQueryBacked
  ) {
    desired = true;
  }

  if (desired !== undefined && !isQueryBacked) {
    let existing = hasOptions
      ? findObjectProp(optionsArg, 'searchable')
      : undefined;
    let current = existing ? readSearchableFromNode(existing.value) : undefined;
    if (!searchableEquals(desired, current)) {
      if (!hasOptions) {
        // Assign a whole inline object so recast prints `{ searchable: … }`
        // on one line.
        call.arguments[1] = searchableObjectNode(desired, filename);
      } else if (existing) {
        existing.value = searchableValueNode(desired, filename);
      } else {
        optionsArg.properties.push(searchablePropNode(desired, filename));
      }
      applied.setSearchable = desired;
      changed = true;
    }
  }

  // 3) If stripping isUsed emptied the options object, drop the empty `{}` arg
  //    so we don't leave `linksTo(X, {})` behind.
  if (
    call.arguments.length === 2 &&
    call.arguments[1].type === 'ObjectExpression' &&
    call.arguments[1].properties.length === 0
  ) {
    call.arguments.pop();
  }

  if (changed) {
    changes.push(applied);
  }
  return fieldName;
}

export function transformSearchable(
  source: string,
  opts: TransformOptions,
): TransformResult {
  let placeholder = gjsToPlaceholderJS(source);
  let ast = recastParseJs(placeholder, opts.filename);

  let changes: AppliedChange[] = [];
  let skipped: SkippedField[] = [];
  let unapplied: UnappliedObserved[] = [];

  walk(ast.program, (node: any) => {
    if (node.type !== 'ClassDeclaration' && node.type !== 'ClassExpression') {
      return;
    }
    let className = classNameOf(node);
    let policy = opts.policyForClass(className);
    let body = node.body?.body;
    if (!Array.isArray(body)) {
      return;
    }
    let declaredFields = new Set<string>();
    for (let member of body) {
      if (
        member.type === 'ClassProperty' ||
        member.type === 'PropertyDefinition'
      ) {
        let name = rewriteFieldProperty(
          member,
          className,
          policy,
          changes,
          skipped,
          opts.filename,
        );
        if (name) {
          declaredFields.add(name);
        }
      }
    }
    // Observed routes whose head field isn't declared here (inherited fields,
    // e.g. base CardDef's `cardInfo`) can't be applied to this class.
    if (policy?.observed) {
      for (let [fieldName, value] of Object.entries(policy.observed)) {
        if (!declaredFields.has(fieldName)) {
          unapplied.push({ className, fieldName, value });
        }
      }
    }
  });

  if (changes.length === 0) {
    return { status: 'unchanged', output: source, changes, skipped, unapplied };
  }

  // recast only applies these to the regions it REPRINTS (the field calls we
  // touched); untouched code is copied verbatim. They keep the reprinted
  // options object repo-conformant (trailing comma, single quotes) so the diff
  // shows only our edit — important because base `.gts` can't be eslint --fix'd
  // (its <template> trips eslint's parser; it lints via ember-template-lint).
  let printed = recastPrint(ast, { trailingComma: true, quote: 'single' }).code;
  let output = placeholderJSToGJS(printed);
  return { status: 'transformed', output, changes, skipped, unapplied };
}
