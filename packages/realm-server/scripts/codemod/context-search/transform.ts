// Codemod that migrates first-party card source off the deprecated
// `@context.prerenderedCardSearchComponent` and onto the v2
// `@context.searchResultsComponent` surface.
//
// A usage migrates when its `@query`/`@realms`/`@cardUrls` are simple paths. The
// legacy args fold into a `search-entry`-rooted query built by a generated
// getter (wrapping the v1 `Query` through `searchEntryWireQueryFromQuery`); a
// static or dynamic `@format` binds through the query's `htmlQuery` (a dynamic
// format guarded by `isValidPrerenderedHtmlFormat`, mirroring base CardsGrid).
//
// A `<:response>` body that only iterates the result list and reads v2-native
// per-row fields (`url`/`isError`/`component`) is rewritten minimally. A body
// that yields the row onward, reaches into legacy-only fields (`cardType`/…), or
// hands the whole list to other markup (a child component, …) is migrated by
// feeding `results.entries` through the legacy-shape array adapter
// (`searchEntriesToPrerenderedCards`), so the body keeps working under the old
// field names.
//
// Genuinely un-mechanizable shapes — a non-path `@query`/`@realms`, an
// unsupported named block, a non-path/non-static `@format` — are left untouched
// and reported for hand migration.

import * as etr from 'ember-template-recast';
import * as ContentTag from 'content-tag';
import { parse as recastParse, print as recastPrint } from 'recast';
import { parse as babelParse } from '@babel/parser';
import {
  gjsToPlaceholderJS,
  placeholderJSToGJS,
} from '@cardstack/runtime-common/module-syntax';
import { getBabelOptions } from '@cardstack/runtime-common/babel-options';

export type TransformStatus = 'transformed' | 'unchanged' | 'skipped';

export interface TransformResult {
  status: TransformStatus;
  output: string;
  reasons: string[];
}

const OLD_MEMBER = 'prerenderedCardSearchComponent';
const NEW_MEMBER = 'searchResultsComponent';
const ADAPTER = 'searchEntryWireQueryFromQuery';
const QUERY_TYPE = 'SearchEntryWireQuery';
const RUNTIME_COMMON = '@cardstack/runtime-common';
const OLD_PATH = `@context.${OLD_MEMBER}`;
const NEW_PATH = `@context.${NEW_MEMBER}`;
const GETTER_BASE = 'searchResultsQuery';
// Name of the legacy-shape array adapter the codemod emits as a module-local
// function in each migrated card, so the body keeps reading the old per-row
// field names without baking a legacy shape into the platform (and the migrated
// card stays self-contained). The dynamic-format guard is a real runtime-common
// helper, mirroring the base CardsGrid getter.
const ARRAY_SHIM = 'searchEntriesToPrerenderedCards';
const FORMAT_GUARD = 'isValidPrerenderedHtmlFormat';

// The legacy component args this codemod understands. Any other `@arg` means a
// shape we don't model — bail out and report rather than silently drop it.
const KNOWN_ARGS = new Set([
  '@query',
  '@format',
  '@realms',
  '@cardUrls',
  '@isLive',
]);

// Per-item fields that map cleanly onto the v2 `entry`. `url` becomes `id`;
// `isError` and the per-item `component` carry over unchanged. Anything else
// (`cardType`/`iconHtml`/`hasHtml`/`realmUrl`/`usedRenderType`) lives under
// `entry.html` in v2 and has no safe mechanical rewrite.
const ITEM_FIELD_RENAMES: Record<string, string> = { url: 'id' };
const ALLOWED_ITEM_FIELDS = new Set(['url', 'isError', 'component']);

interface GetterSpec {
  templateIndex: number;
  name: string;
  queryExpr: string;
  realmsExpr?: string;
  cardUrlsExpr?: string;
  // Only set for a non-default (non-`fitted`) static format.
  format?: string;
  // Set for a dynamic format (a `this.`/`@arg` path) — bound through the query
  // getter guarded by `isValidPrerenderedHtmlFormat`.
  formatExpr?: string;
  // The migrated body feeds `results.entries` through the legacy-shape array
  // adapter (`searchEntriesToPrerenderedCards`) instead of rewriting each field.
  usesArrayShim?: boolean;
}

export function transformContextSearch(
  source: string,
  opts: { filename?: string } = {},
): TransformResult {
  let filename = opts.filename ?? 'module.gts';
  // Fast path + the idempotency guarantee: once migrated the source no longer
  // mentions the old member, so a second run is a no-op.
  if (!source.includes(OLD_MEMBER)) {
    return { status: 'unchanged', output: source, reasons: [] };
  }

  let reasons: string[] = [];
  let getterSpecs: GetterSpec[] = [];

  let templatePass = transformTemplates(source, getterSpecs, reasons, filename);

  if (getterSpecs.length === 0) {
    // No usage could be reshaped, yet we are past the early `!includes` guard so
    // the old member is still in the source — either every usage was reported
    // for hand migration, or it appears in a shape the template pass doesn't
    // recognize (e.g. captured into a TS getter, or addressed as
    // `this.args.context.…` rather than `@context.…`). Never call that
    // `unchanged`: a surviving member that we neither reshaped nor reported
    // would otherwise read as clean and silently escape the sweep. Flag it.
    if (reasons.length === 0) {
      reasons.push(
        `${filename}: ${OLD_MEMBER} present but no migratable usage was recognized (unrecognized usage shape, or an incidental mention) — left for hand migration`,
      );
    }
    return { status: 'skipped', output: source, reasons };
  }

  let tsPass = applyTsEdits(
    templatePass.output,
    getterSpecs,
    filename,
    reasons,
  );
  if (!tsPass.ok) {
    // We couldn't place a getter — discard the partial template edits and leave
    // the file for hand migration rather than emit something half-migrated.
    return { status: 'skipped', output: source, reasons };
  }

  // Never emit a half-migrated module. If the rewritten output still references
  // the old member — because a usage was reported for hand migration, or was an
  // unrecognized shape this pass didn't reshape — discard every edit and leave
  // the whole file untouched for hand migration. Writing a file that mixes the
  // new component with a stranded `@context.prerenderedCardSearchComponent` is
  // worse than not touching it: it still breaks once the member is removed, but
  // now also looks migrated. The residual-member check is the invariant; a usage
  // we silently failed to recognize (so recorded no reason) is caught here too.
  if (tsPass.output.includes(OLD_MEMBER)) {
    if (reasons.length === 0) {
      reasons.push(
        `${filename}: ${OLD_MEMBER} still present after transform (unrecognized usage) — left for hand migration`,
      );
    }
    return { status: 'skipped', output: source, reasons };
  }

  return { status: 'transformed', output: tsPass.output, reasons };
}

// ---------------------------------------------------------------------------
// Template pass (ember-template-recast)
// ---------------------------------------------------------------------------

function transformTemplates(
  source: string,
  getterSpecs: GetterSpec[],
  reasons: string[],
  filename: string,
): { output: string } {
  let matches = new ContentTag.Preprocessor().parse(source);
  let usedGetterNames = new Set<string>();
  let edits: { start: number; end: number; contents: string }[] = [];

  matches.forEach((match, templateIndex) => {
    if (!match.contents.includes(OLD_MEMBER)) {
      return;
    }
    let result = transformOneTemplate(
      match.contents,
      templateIndex,
      getterSpecs,
      reasons,
      usedGetterNames,
      filename,
    );
    if (result.changed) {
      edits.push({
        start: match.range.startChar,
        end: match.range.endChar,
        contents: result.output,
      });
    }
  });

  if (edits.length === 0) {
    return { output: source };
  }

  // Splice in reverse so earlier character offsets stay valid. `Array.from`
  // keeps us multi-byte safe, matching content-tag's character indexing.
  let chars = Array.from(source);
  edits.sort((a, b) => b.start - a.start);
  for (let edit of edits) {
    chars.splice(
      edit.start,
      edit.end - edit.start,
      `<template>${edit.contents}</template>`,
    );
  }
  return { output: chars.join('') };
}

function transformOneTemplate(
  contents: string,
  templateIndex: number,
  getterSpecs: GetterSpec[],
  reasons: string[],
  usedGetterNames: Set<string>,
  filename: string,
): { changed: boolean; output: string } {
  let ast = etr.parse(contents);
  let invocations = findInvocations(ast, reasons, filename);
  let changed = false;
  for (let invocation of invocations) {
    let transformed = tryTransformInvocation(
      invocation,
      templateIndex,
      getterSpecs,
      reasons,
      usedGetterNames,
      filename,
    );
    changed = changed || transformed;
  }
  return changed
    ? { changed: true, output: etr.print(ast) }
    : { changed: false, output: contents };
}

interface Invocation {
  // The angle-bracket invocation whose args/blocks get reshaped.
  element: any;
  // For the `{{#let (component @context.…) as |X|}}` form, the SubExpression
  // whose component path must move to the v2 member.
  subExpr: any | null;
}

function findInvocations(
  ast: any,
  reasons: string[],
  filename: string,
): Invocation[] {
  let directs: any[] = [];
  let lets: { localName: string; subExpr: any; scope: any }[] = [];

  walkGlimmer(ast, (node: any) => {
    if (node.type === 'ElementNode' && node.tag === OLD_PATH) {
      directs.push(node);
    }
    if (node.type === 'BlockStatement' && node.path?.original === 'let') {
      (node.params ?? []).forEach((param: any, idx: number) => {
        if (
          param.type === 'SubExpression' &&
          param.path?.original === 'component' &&
          param.params?.[0]?.type === 'PathExpression' &&
          param.params[0].original === OLD_PATH
        ) {
          let localName = node.program?.blockParams?.[idx];
          if (localName) {
            lets.push({ localName, subExpr: param, scope: node.program });
          }
        }
      });
    }
  });

  let invocations: Invocation[] = directs.map((element) => ({
    element,
    subExpr: null,
  }));

  for (let binding of lets) {
    let elements: any[] = [];
    walkGlimmer(binding.scope, (node: any) => {
      if (node.type === 'ElementNode' && node.tag === binding.localName) {
        elements.push(node);
      }
    });
    if (elements.length === 1) {
      invocations.push({ element: elements[0], subExpr: binding.subExpr });
    } else {
      reasons.push(
        `${filename}: <${binding.localName}> bound from (component ${OLD_PATH}) is invoked ${elements.length} times — left for hand migration`,
      );
    }
  }

  return invocations;
}

function tryTransformInvocation(
  invocation: Invocation,
  templateIndex: number,
  getterSpecs: GetterSpec[],
  reasons: string[],
  usedGetterNames: Set<string>,
  filename: string,
): boolean {
  let { element, subExpr } = invocation;
  let skip = (why: string) => {
    reasons.push(`${filename}: ${why} — left for hand migration`);
    return false;
  };

  // --- args ---
  let argByName = new Map<string, any>();
  for (let attr of element.attributes ?? []) {
    if (attr.name.startsWith('@')) {
      if (!KNOWN_ARGS.has(attr.name)) {
        return skip(`unrecognized arg ${attr.name} on the search component`);
      }
      argByName.set(attr.name, attr);
    }
  }

  let queryAttr = argByName.get('@query');
  if (!queryAttr) {
    return skip('search component has no @query');
  }
  let queryExpr = pathAttrToTs(queryAttr);
  if (!queryExpr) {
    return skip('@query is not a simple this./@arg path');
  }

  let realmsExpr: string | undefined;
  if (argByName.has('@realms')) {
    let expr = pathAttrToTs(argByName.get('@realms'));
    if (!expr) {
      return skip('@realms is not a simple this./@arg path');
    }
    realmsExpr = expr;
  }

  let cardUrlsExpr: string | undefined;
  if (argByName.has('@cardUrls')) {
    let expr = pathAttrToTs(argByName.get('@cardUrls'));
    if (!expr) {
      return skip('@cardUrls is not a simple this./@arg path');
    }
    cardUrlsExpr = expr;
  }

  let format: string | undefined;
  let formatExpr: string | undefined;
  if (argByName.has('@format')) {
    let value = staticString(argByName.get('@format'));
    if (value != null) {
      format = value;
    } else {
      let expr = pathAttrToTs(argByName.get('@format'));
      if (!expr) {
        return skip(
          '@format is neither a static string nor a simple this./@arg path',
        );
      }
      formatExpr = expr;
    }
  }

  // --- blocks ---
  let namedBlocks = (element.children ?? []).filter(
    (c: any) => c.type === 'ElementNode' && c.tag.startsWith(':'),
  );
  let loadingBlock = namedBlocks.find((b: any) => b.tag === ':loading');
  let responseBlock = namedBlocks.find((b: any) => b.tag === ':response');
  let unexpected = namedBlocks.find(
    (b: any) => b.tag !== ':loading' && b.tag !== ':response',
  );
  if (unexpected) {
    return skip(`named block ${unexpected.tag} is not supported`);
  }
  if (!responseBlock) {
    return skip('search component has no <:response> block');
  }
  if ((responseBlock.blockParams ?? []).length !== 1) {
    return skip('<:response> does not yield exactly one block param');
  }
  let responseParam = responseBlock.blockParams[0];

  // Decide how to migrate the <:response> body. A single direct
  // `{{#each <param>}}` whose item only touches v2-native fields
  // (`url`/`isError`/`component`) is rewritten minimally. Anything else — a body
  // that yields the row onward, reaches into legacy-only fields, or hands the
  // whole list to other markup (a child component, etc.) — is migrated by
  // feeding `results.entries` through the legacy-shape array adapter, so the
  // body keeps working verbatim with the old field names.
  let significant = significantChildren(responseBlock);
  let cleanEach =
    significant.length === 1 &&
    significant[0].type === 'BlockStatement' &&
    significant[0].path?.original === 'each' &&
    significant[0].params?.[0]?.original === responseParam &&
    countPathReferences(responseBlock, responseParam) === 1;

  let useShim = true;
  if (cleanEach) {
    let itemParam = significant[0].program?.blockParams?.[0];
    if (itemParam) {
      let badFields = new Set<string>();
      let passesWholeItem = false;
      walkGlimmer(significant[0].program, (node: any) => {
        if (
          node.type === 'PathExpression' &&
          node.head?.type === 'VarHead' &&
          node.head.name === itemParam
        ) {
          if (node.tail.length === 0) {
            passesWholeItem = true;
          } else if (!ALLOWED_ITEM_FIELDS.has(node.tail[0])) {
            badFields.add(node.tail.join('.'));
          }
        }
        if (
          node.type === 'ElementNode' &&
          node.tag.startsWith(`${itemParam}.`) &&
          node.tag.slice(itemParam.length + 1) !== 'component'
        ) {
          badFields.add(node.tag);
        }
      });
      useShim = passesWholeItem || badFields.size > 0;
    }
  }

  // --- mutate ---
  let getterName = uniqueName(GETTER_BASE, usedGetterNames);
  getterSpecs.push({
    templateIndex,
    name: getterName,
    queryExpr,
    realmsExpr,
    cardUrlsExpr,
    format: format && format !== 'fitted' ? format : undefined,
    formatExpr,
    usesArrayShim: useShim,
  });

  // Move the component reference to the v2 member.
  if (subExpr) {
    subExpr.params[0] = b.path(NEW_PATH);
  } else {
    element.tag = NEW_PATH;
  }

  // Args: keep any non-`@` attributes, point `@query` at the getter.
  let keptAttrs = (element.attributes ?? []).filter(
    (a: any) => !a.name.startsWith('@'),
  );
  element.attributes = [mintAttr('@query', `this.${getterName}`), ...keptAttrs];

  // Blocks → a single default block yielding `results`.
  element.blockParams = ['results'];
  let bodyChildren: any[];
  if (useShim) {
    // Bind the adapted list once to the original block param and keep the body
    // verbatim: `{{#let (searchEntriesToPrerenderedCards results.entries) as
    // |<param>|}}…body…{{/let}}`. The body keeps reading the list and its rows
    // under the legacy field names (`{{#each}}`, `.length`, child-component
    // hand-offs, `{{yield row}}`, even `.firstObject.url`), and the adapter runs
    // once per render rather than once per reference.
    let letBlock = b.block(
      b.path('let'),
      [b.sexpr(b.path(ARRAY_SHIM), [b.path('results.entries')])],
      b.hash([]),
      b.blockItself(responseBlock.children ?? [], [responseParam]),
    );
    bodyChildren = [letBlock];
  } else {
    // Minimal: iterate `results.entries`, key `url` → `id`, per-item `.url` → `.id`.
    let eachBlock = significant[0];
    let itemParam = eachBlock.program.blockParams[0];
    eachBlock.params[0] = b.path('results.entries');
    retargetEachKey(eachBlock);
    replacePaths(
      eachBlock.program,
      (p: any) =>
        p.head?.type === 'VarHead' &&
        p.head.name === itemParam &&
        p.tail.length === 1 &&
        Boolean(ITEM_FIELD_RENAMES[p.tail[0]]),
      (p: any) => b.path(`${itemParam}.${ITEM_FIELD_RENAMES[p.tail[0]]}`),
    );
    bodyChildren = [eachBlock];
  }

  let newChildren: any[] = [b.text('\n      ')];
  if (loadingBlock) {
    newChildren.push(
      b.block(
        b.path('if'),
        [b.path('results.isLoading')],
        b.hash([]),
        b.blockItself(loadingBlock.children),
      ),
      b.text('\n      '),
    );
  }
  newChildren.push(...bodyChildren, b.text('\n    '));
  element.children = newChildren;

  return true;
}

// ---------------------------------------------------------------------------
// TypeScript pass (gjsToPlaceholderJS → recast → placeholderJSToGJS)
// ---------------------------------------------------------------------------

function recastParseJs(src: string, filename: string): any {
  return recastParse(src, {
    parser: {
      parse: (source: string) =>
        babelParse(source, getBabelOptions({ sourceFilename: filename })),
    },
  });
}

function applyTsEdits(
  source: string,
  getterSpecs: GetterSpec[],
  filename: string,
  reasons: string[],
): { ok: boolean; output: string } {
  let placeholder = gjsToPlaceholderJS(source);
  let ast = recastParseJs(placeholder, filename);

  let extraValueImports: string[] = [];
  if (getterSpecs.some((s) => s.formatExpr))
    extraValueImports.push(FORMAT_GUARD);
  ensureRuntimeCommonImport(ast, filename, extraValueImports);

  // Emit the legacy-shape array adapter as a module-local function rather than
  // importing it from runtime-common, so no legacy shape is baked into the
  // platform and the migrated card carries everything it needs.
  if (getterSpecs.some((s) => s.usesArrayShim)) {
    insertArrayShim(ast, filename);
  }

  let classByTemplate = mapTemplatesToClasses(ast);
  for (let spec of getterSpecs) {
    let target = classByTemplate[spec.templateIndex];
    if (!target) {
      reasons.push(
        `${filename}: could not locate the component class hosting the search usage — left for hand migration`,
      );
      return { ok: false, output: source };
    }
    target.body.body.unshift(buildGetter(spec, filename));
  }

  let printed = recastPrint(ast).code;
  return { ok: true, output: placeholderJSToGJS(printed) };
}

function ensureRuntimeCommonImport(
  ast: any,
  filename: string,
  extraValueImports: string[] = [],
): void {
  let body = ast.program.body;
  let valueImports = [ADAPTER, ...extraValueImports];
  let snippet = recastParseJs(
    `import { ${valueImports.join(', ')}, type ${QUERY_TYPE} } from '${RUNTIME_COMMON}';`,
    filename,
  ).program.body[0];

  // Only merge into a value-level runtime-common import. Appending the
  // `searchEntryWireQueryFromQuery` value specifier to a declaration-level
  // `import type { … }` would make it type-only too (erased at runtime); in that
  // case fall through and add a separate value import instead.
  let existing = body.find(
    (n: any) =>
      n.type === 'ImportDeclaration' &&
      n.source.value === RUNTIME_COMMON &&
      n.importKind !== 'type',
  );

  if (!existing) {
    let lastImport = -1;
    body.forEach((n: any, i: number) => {
      if (n.type === 'ImportDeclaration') {
        lastImport = i;
      }
    });
    body.splice(lastImport + 1, 0, snippet);
    return;
  }

  let have = new Set(
    existing.specifiers
      .filter((s: any) => s.type === 'ImportSpecifier')
      .map((s: any) => s.imported.name),
  );
  for (let spec of snippet.specifiers) {
    if (spec.type === 'ImportSpecifier' && !have.has(spec.imported.name)) {
      existing.specifiers.push(spec);
    }
  }
}

// Insert the module-local legacy-shape array adapter once, after the imports.
// It maps each v2 `entry` to the legacy `PrerenderedCardLike` field names so a
// migrated body (and the components it hands rows to) keeps working unchanged.
function insertArrayShim(ast: any, filename: string): void {
  let body = ast.program.body;
  if (
    body.some(
      (n: any) => n.type === 'FunctionDeclaration' && n.id?.name === ARRAY_SHIM,
    )
  ) {
    return;
  }
  let fn = recastParseJs(
    `function ${ARRAY_SHIM}(entries) {
  return entries.map((entry) => ({
    url: entry.id,
    isError: entry.isError,
    realmUrl: entry.realmUrl,
    component: entry.component,
    cardType: entry.html?.cardType,
    iconHtml: entry.iconHtml,
    usedRenderType: entry.html?.renderType,
    hasHtml: Boolean(entry.html?.html),
  }));
}`,
    filename,
  ).program.body[0];
  let lastImport = -1;
  body.forEach((n: any, i: number) => {
    if (n.type === 'ImportDeclaration') {
      lastImport = i;
    }
  });
  body.splice(lastImport + 1, 0, fn);
}

function buildGetter(spec: GetterSpec, filename: string): any {
  let lines: string[] = [];
  if (spec.formatExpr) {
    // Dynamic format: bind it through `htmlQuery` only when it is a valid
    // prerendered format, mirroring the base CardsGrid getter.
    lines.push(`  get ${spec.name}(): ${QUERY_TYPE} {`);
    lines.push(`    let query = ${ADAPTER}(${spec.queryExpr});`);
    lines.push(`    if (!${FORMAT_GUARD}(${spec.formatExpr})) {`);
    lines.push(`      return {`);
    lines.push(`        ...query,`);
    if (spec.realmsExpr) lines.push(`        realms: ${spec.realmsExpr},`);
    if (spec.cardUrlsExpr)
      lines.push(`        cardUrls: ${spec.cardUrlsExpr},`);
    lines.push(`      };`);
    lines.push(`    }`);
    lines.push(`    return {`);
    lines.push(`      ...query,`);
    if (spec.realmsExpr) lines.push(`      realms: ${spec.realmsExpr},`);
    if (spec.cardUrlsExpr) lines.push(`      cardUrls: ${spec.cardUrlsExpr},`);
    lines.push(
      `      filter: { ...query.filter, eq: { ...query.filter?.eq, htmlQuery: { eq: { format: ${spec.formatExpr} } } } },`,
    );
    lines.push(`    };`);
    lines.push(`  }`);
  } else if (spec.format) {
    lines.push(`  get ${spec.name}(): ${QUERY_TYPE} {`);
    lines.push(`    let query = ${ADAPTER}(${spec.queryExpr});`);
    lines.push(`    return {`);
    lines.push(`      ...query,`);
    if (spec.realmsExpr) lines.push(`      realms: ${spec.realmsExpr},`);
    if (spec.cardUrlsExpr) lines.push(`      cardUrls: ${spec.cardUrlsExpr},`);
    // Rendering selection is bound through the `htmlQuery` field nested in the
    // filter's top-level `eq`; a bare `eq.format` would be read as an `item.`
    // field path and rejected.
    lines.push(
      `      filter: { ...query.filter, eq: { ...query.filter?.eq, htmlQuery: { eq: { format: '${spec.format}' } } } },`,
    );
    lines.push(`    };`);
    lines.push(`  }`);
  } else {
    lines.push(`  get ${spec.name}(): ${QUERY_TYPE} {`);
    lines.push(`    return {`);
    lines.push(`      ...${ADAPTER}(${spec.queryExpr}),`);
    if (spec.realmsExpr) lines.push(`      realms: ${spec.realmsExpr},`);
    if (spec.cardUrlsExpr) lines.push(`      cardUrls: ${spec.cardUrlsExpr},`);
    lines.push(`    };`);
    lines.push(`  }`);
  }
  let snippet = `class __Codemod {\n${lines.join('\n')}\n}`;
  let cls = recastParseJs(snippet, filename).program.body[0];
  return cls.body.body[0];
}

// Map each template (in document order, matching content-tag) to the class that
// hosts it, or `undefined` for a module-level template.
function mapTemplatesToClasses(ast: any): any[] {
  let result: any[] = [];
  walkBabel(ast.program, (node: any, enclosingClass: any) => {
    if (isTemplatePlaceholder(node)) {
      result.push(enclosingClass ?? undefined);
    }
  });
  return result;
}

function isTemplatePlaceholder(node: any): boolean {
  // As a class member: `[templatePlaceholder("…","templatePlaceholder")]`.
  if (
    (node.type === 'ClassProperty' || node.type === 'PropertyDefinition') &&
    node.computed &&
    isTemplatePlaceholderCall(node.key)
  ) {
    return true;
  }
  // As a module-level statement: `[templatePlaceholder(…)]`.
  if (
    node.type === 'ExpressionStatement' &&
    node.expression?.type === 'ArrayExpression' &&
    isTemplatePlaceholderCall(node.expression.elements?.[0])
  ) {
    return true;
  }
  return false;
}

function isTemplatePlaceholderCall(node: any): boolean {
  return (
    node?.type === 'CallExpression' &&
    node.callee?.type === 'Identifier' &&
    node.callee.name === 'templatePlaceholder'
  );
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

// A glimmer PathExpression attr value → a TS member expression string.
// `@query` → `this.args.query`; `this.query`/`this.a.b` → as written. Anything
// else (a local var, a subexpression, a literal) → null (caller reports).
function pathAttrToTs(attr: any): string | null {
  let value = attr.value;
  if (value?.type !== 'MustacheStatement') {
    return null;
  }
  let path = value.path;
  if (
    path?.type !== 'PathExpression' ||
    (value.params?.length ?? 0) > 0 ||
    (value.hash?.pairs?.length ?? 0) > 0
  ) {
    return null;
  }
  let tail = (path.tail ?? []).join('.');
  if (path.head?.type === 'AtHead') {
    let name = path.head.name.replace(/^@/, '');
    return tail ? `this.args.${name}.${tail}` : `this.args.${name}`;
  }
  if (path.head?.type === 'ThisHead') {
    return tail ? `this.${tail}` : 'this';
  }
  return null;
}

function staticString(attr: any): string | null {
  let value = attr.value;
  if (value?.type === 'TextNode') {
    return value.chars;
  }
  if (
    value?.type === 'MustacheStatement' &&
    value.path?.type === 'StringLiteral'
  ) {
    return value.path.value;
  }
  return null;
}

function significantChildren(node: any): any[] {
  return (node.children ?? []).filter(
    (c: any) => !(c.type === 'TextNode' && c.chars.trim() === ''),
  );
}

function countPathReferences(node: any, name: string): number {
  let count = 0;
  walkGlimmer(node, (n: any) => {
    if (
      n.type === 'PathExpression' &&
      n.head?.type === 'VarHead' &&
      n.head.name === name
    ) {
      count++;
    }
  });
  return count;
}

function retargetEachKey(eachBlock: any): void {
  let pair = (eachBlock.hash?.pairs ?? []).find((p: any) => p.key === 'key');
  if (
    pair &&
    pair.value?.type === 'StringLiteral' &&
    pair.value.value === 'url'
  ) {
    pair.value = b.string('id');
  }
}

function uniqueName(base: string, used: Set<string>): string {
  let name = base;
  let n = 2;
  while (used.has(name)) {
    name = `${base}${n++}`;
  }
  used.add(name);
  return name;
}

// --- node construction via etr.builders ---
//
// Builder nodes carry no original source span, so etr prints them structurally.
// (A node minted via `etr.parse(snippet)` keeps that snippet's loc and is
// reprinted verbatim from it, silently ignoring later mutations — e.g. dropping
// a reassigned block body.)

const b: any = (etr as any).builders;

function mintAttr(name: string, expr: string): any {
  return b.attr(name, b.mustache(b.path(expr)));
}

// Replace every PathExpression under `root` matching `predicate` with a freshly
// built path, reassigning it in its parent (an in-place field mutation keeps the
// node's original loc and so would print unchanged).
function replacePaths(
  root: any,
  predicate: (p: any) => boolean,
  make: (p: any) => any,
): void {
  for (let key of Object.keys(root)) {
    if (key === 'loc' || key === 'type') {
      continue;
    }
    let value = (root as any)[key];
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        let child = value[i];
        if (child && typeof child.type === 'string') {
          if (child.type === 'PathExpression' && predicate(child)) {
            value[i] = make(child);
          } else {
            replacePaths(child, predicate, make);
          }
        }
      }
    } else if (value && typeof value.type === 'string') {
      if (value.type === 'PathExpression' && predicate(value)) {
        (root as any)[key] = make(value);
      } else {
        replacePaths(value, predicate, make);
      }
    }
  }
}

// --- generic AST walks ---

function walkGlimmer(node: any, visit: (n: any) => void): void {
  if (!node || typeof node.type !== 'string') {
    return;
  }
  visit(node);
  for (let key of Object.keys(node)) {
    if (key === 'loc' || key === 'type') {
      continue;
    }
    let value = (node as any)[key];
    if (Array.isArray(value)) {
      for (let child of value) {
        if (child && typeof child.type === 'string') {
          walkGlimmer(child, visit);
        }
      }
    } else if (value && typeof value.type === 'string') {
      walkGlimmer(value, visit);
    }
  }
}

const BABEL_SKIP_KEYS = new Set([
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
  'original',
]);

function walkBabel(
  node: any,
  visit: (n: any, enclosingClass: any) => void,
  enclosingClass: any = null,
): void {
  if (!node || typeof node.type !== 'string') {
    return;
  }
  visit(node, enclosingClass);
  let nextClass =
    node.type === 'ClassDeclaration' || node.type === 'ClassExpression'
      ? node
      : enclosingClass;
  for (let key of Object.keys(node)) {
    if (BABEL_SKIP_KEYS.has(key)) {
      continue;
    }
    let value = (node as any)[key];
    if (Array.isArray(value)) {
      for (let child of value) {
        if (child && typeof child.type === 'string') {
          walkBabel(child, visit, nextClass);
        }
      }
    } else if (value && typeof value.type === 'string') {
      walkBabel(value, visit, nextClass);
    }
  }
}
