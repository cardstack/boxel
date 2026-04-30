// Hand-rolled ES → AMD transpiler for the Loader. Replaces babel's
// `transformAsync(... TransformModulesAmdPlugin ...)` in `Loader.fetchModule`.
// ~10× faster than babel on real card sources (CS-10977).
//
// Input contract: post-realm-server-transpiled JS — TS, JSX, decorators,
// glimmer templates and scoped CSS have already been lowered by
// `transpile.ts` on the way in. What's left is plain ES2022+ JS with
// static `import` / `export` declarations and `import.meta` references.
//
// Output: AMD `define(moduleId, [...deps], function (...args) { ... })`
// matching the loader's `define()` callback contract in `loader.ts`.
//
// Live-binding semantics:
//   - Imports are NOT bound via `let` destructuring at body entry — that
//     would snapshot `undefined` for circular dependencies. Instead, every
//     non-shadowed reference to an imported name in the source body is
//     rewritten to `_dep.name`. The lookup happens at use time, so by the
//     time a function references `field(...)`, the dep has finished
//     evaluating and the export is populated. Matches babel.
//   - Mutable local exports (`export let`/`export var`) install a getter
//     on `_exports` so mutations to the local propagate to importers.
//   - Re-exports of imported names (`export { x }`, `export { x } from`,
//     `export *`) install getters that read through the dep arg.
//   - `export default <expression>` strips the source statement to a
//     `var __default$N = (<expr>);` capture (so the identifier-rewrite
//     walk can rewrite imported names inside `<expr>`) and appends an
//     `_exports.default = __default$N` setter at the end of the body.
//     This avoids a magic-string overlap between the in-place statement
//     rewrite and the identifier-rewrite walk and gives a uniform
//     pattern with named declarations. The `<expr>` itself still
//     evaluates at its source position, so a forward reference to a
//     `const`/`class` declared later is still a TDZ error — same as
//     native ESM (`export default foo; const foo = ...` throws there
//     too).
//
// File layout:
//   - `index.ts`              — `transpileAmd` (public entry) — this file
//   - `identifier-rewriter.ts` — scope-aware AST walk that rewrites
//                                imported names + `import.meta`
//   - `pattern-helpers.ts`     — pure AST helpers shared by the main
//                                pass and the rewriter
//   - `emit-helpers.ts`        — pure string utilities for emitting
//                                AMD-wrapper text
//   - `top-level-await.ts`     — TLA detector (`hasTopLevelAwait`)
import { Parser, type Program, type Node } from 'acorn';
import MagicString from 'magic-string';
import {
  sanitize,
  memberAccess,
  exportLValue,
  defineGetter,
  defineLocalGetter,
  reExportStarSnippet,
} from './emit-helpers';
import { collectPatternBindings } from './pattern-helpers';
import { IdentifierRewriter } from './identifier-rewriter';
import { hasTopLevelAwait } from './top-level-await';

interface AmdTranspileOptions {
  // Module identifier embedded in the emitted `define(...)` call. Same role
  // as the `moduleId` option to babel's TransformModulesAmd plugin.
  moduleId: string;
}

export function transpileAmd(
  src: string,
  { moduleId }: AmdTranspileOptions,
): string {
  const ast = Parser.parse(src, {
    ecmaVersion: 'latest',
    sourceType: 'module',
    allowImportExportEverywhere: false,
    allowAwaitOutsideFunction: true,
  }) as Program;

  // Top-level await isn't supported by the AMD wrapper (the emitted
  // factory is a non-async function — `await` at the top level becomes
  // a SyntaxError at `eval(src)` time). Reject at transpile time with a
  // clear message instead of letting it fall through to a confusing
  // eval error.
  if (hasTopLevelAwait(ast)) {
    throw new Error(
      `amd-transpile: top-level await is not supported by the loader (${moduleId})`,
    );
  }

  const ms = new MagicString(src);

  // AMD dep list and the matching factory parameter names. We always
  // reserve `exports` first; `__import_meta__` is appended at the end
  // if used.
  const deps: string[] = ['exports'];
  const argNames: string[] = ['_exports'];

  // local-name → expression that reads its live value from the dep arg
  // (e.g. `_foo$1.field`). Source-code references to these names are
  // rewritten by the identifier-rewrite walk; the same map is consulted
  // when wiring up `export { x }` re-exports of an imported binding.
  const importedAccess = new Map<string, string>();

  // Collect names declared at module top level (for `_default$N` collision
  // avoidance). Populated during the import-collection pass.
  const topLevelDeclaredNames = new Set<string>();

  // Statements appended to the AMD body that wire up `_exports`. Order
  // matters: function/class declarations stay in source position; we
  // append exports afterwards so all source bindings are initialised by
  // the time the export setters run.
  const exportStatements: string[] = [];

  // Names this module exports locally; consulted by the `export *` filter
  // so re-exported keys can't shadow explicit ones.
  const localExportNames: string[] = [];

  // True if any `export *` (without `as ns`) is present.
  let hasExportStar = false;

  // Synthesize a fresh top-level identifier for `__default$N` etc. that
  // doesn't collide with any name already declared at the module level.
  let defaultCounter = 0;
  const freshDefaultName = (): string => {
    for (;;) {
      const candidate = `__default$${defaultCounter++}`;
      if (!topLevelDeclaredNames.has(candidate)) {
        topLevelDeclaredNames.add(candidate);
        return candidate;
      }
    }
  };

  // Helper: strip a top-level statement and a single trailing newline.
  const stripStatement = (node: Node) => {
    let end = node.end;
    while (src[end] === ' ' || src[end] === '\t') end++;
    if (src[end] === '\n') end++;
    ms.remove(node.start, end);
  };

  // -----------------------------------------------------------------
  // Pass 1 — collect every `ImportDeclaration` binding into
  // `importedAccess`, plus every top-level declared name into
  // `topLevelDeclaredNames`. This makes export-handling and the
  // identifier-rewrite walk both order-independent w.r.t. source
  // statement order.
  //
  // We mirror pass 2's deps counter via `passOneDepCount` so the argName
  // we record (`_foo$<index>`) matches what pass 2 will actually emit. It
  // increments for every node that contributes a dep slot — that is, every
  // `ImportDeclaration` and every export-from / `export *` declaration.
  // -----------------------------------------------------------------
  let passOneDepCount = 1; // index 0 is reserved for `exports`
  for (const node of ast.body) {
    if (node.type === 'ImportDeclaration') {
      const source = node.source.value as string;
      const argName = sanitize(source) + '$' + passOneDepCount;
      passOneDepCount++;

      for (const spec of node.specifiers) {
        if (spec.type === 'ImportDefaultSpecifier') {
          importedAccess.set(spec.local.name, `${argName}.default`);
        } else if (spec.type === 'ImportNamespaceSpecifier') {
          importedAccess.set(spec.local.name, argName);
        } else {
          const importedName =
            spec.imported.type === 'Identifier'
              ? spec.imported.name
              : (spec.imported.value as string);
          importedAccess.set(
            spec.local.name,
            memberAccess(argName, importedName),
          );
        }
      }
    } else if (
      (node.type === 'ExportNamedDeclaration' && node.source) ||
      node.type === 'ExportAllDeclaration'
    ) {
      // Export-from and `export *` also consume a dep slot in pass 2.
      passOneDepCount++;
    }
    // Record top-level declared names for collision avoidance.
    switch (node.type) {
      case 'VariableDeclaration':
        for (const d of node.declarations) {
          collectPatternBindings(d.id, (n) => topLevelDeclaredNames.add(n));
        }
        break;
      case 'FunctionDeclaration':
      case 'ClassDeclaration':
        if (node.id) topLevelDeclaredNames.add(node.id.name);
        break;
      case 'ImportDeclaration':
        for (const spec of node.specifiers) {
          topLevelDeclaredNames.add(spec.local.name);
        }
        break;
      case 'ExportNamedDeclaration':
        if (node.declaration?.type === 'VariableDeclaration') {
          for (const d of node.declaration.declarations) {
            collectPatternBindings(d.id, (n) => topLevelDeclaredNames.add(n));
          }
        } else if (
          (node.declaration?.type === 'FunctionDeclaration' ||
            node.declaration?.type === 'ClassDeclaration') &&
          node.declaration.id
        ) {
          topLevelDeclaredNames.add(node.declaration.id.name);
        }
        break;
      case 'ExportDefaultDeclaration':
        if (
          (node.declaration.type === 'FunctionDeclaration' ||
            node.declaration.type === 'ClassDeclaration') &&
          node.declaration.id
        ) {
          topLevelDeclaredNames.add(node.declaration.id.name);
        }
        break;
    }
  }

  // -----------------------------------------------------------------
  // Pass 2 — emit dep parameters, strip imports, transform exports.
  // -----------------------------------------------------------------
  for (const node of ast.body) {
    switch (node.type) {
      case 'ImportDeclaration': {
        const source = node.source.value as string;
        const argName = sanitize(source) + '$' + deps.length;
        deps.push(source);
        argNames.push(argName);
        stripStatement(node);
        break;
      }

      case 'ExportNamedDeclaration': {
        if (node.declaration) {
          // `export const X = ...` | `export function f() {...}` |
          // `export class C {...}` | `export const { a, b } = obj`
          // Strip the `export ` keyword + space and keep the declaration.
          ms.remove(node.start, node.start + 'export '.length);
          const decl = node.declaration;
          if (decl.type === 'VariableDeclaration') {
            const isMutable = decl.kind !== 'const';
            for (const d of decl.declarations) {
              collectPatternBindings(d.id, (name) => {
                exportStatements.push(
                  isMutable
                    ? defineLocalGetter(name)
                    : `${exportLValue(name)} = ${name};`,
                );
                localExportNames.push(name);
              });
            }
          } else if (
            decl.type === 'FunctionDeclaration' ||
            decl.type === 'ClassDeclaration'
          ) {
            const name = decl.id!.name;
            // Use a getter so reassigning `name` (rare but legal) propagates.
            exportStatements.push(defineLocalGetter(name));
            localExportNames.push(name);
          }
        } else if (node.source) {
          // `export { x, y as z } from 'foo'`
          const source = node.source.value as string;
          const argName = sanitize(source) + '$' + deps.length;
          deps.push(source);
          argNames.push(argName);
          for (const spec of node.specifiers) {
            const localName =
              spec.local.type === 'Identifier'
                ? spec.local.name
                : (spec.local.value as string);
            const exportedName =
              spec.exported.type === 'Identifier'
                ? spec.exported.name
                : (spec.exported.value as string);
            exportStatements.push(
              defineGetter(exportedName, memberAccess(argName, localName)),
            );
            localExportNames.push(exportedName);
          }
          stripStatement(node);
        } else {
          // `export { x, y as z }` — local re-export. Now that pass 1 has
          // populated `importedAccess` regardless of source order, we can
          // safely choose between dep-arg getters (for imported bindings)
          // and local-binding getters (for module-locals).
          for (const spec of node.specifiers) {
            const localName =
              spec.local.type === 'Identifier'
                ? spec.local.name
                : (spec.local.value as string);
            const exportedName =
              spec.exported.type === 'Identifier'
                ? spec.exported.name
                : (spec.exported.value as string);
            const importAccess = importedAccess.get(localName);
            if (importAccess) {
              exportStatements.push(defineGetter(exportedName, importAccess));
            } else {
              exportStatements.push(
                `Object.defineProperty(_exports, ${JSON.stringify(
                  exportedName,
                )}, { enumerable: true, configurable: true, get: function () { return ${localName}; } });`,
              );
            }
            localExportNames.push(exportedName);
          }
          stripStatement(node);
        }
        break;
      }

      case 'ExportDefaultDeclaration': {
        const decl = node.declaration;
        localExportNames.push('default');
        if (
          (decl.type === 'FunctionDeclaration' ||
            decl.type === 'ClassDeclaration') &&
          decl.id
        ) {
          // `export default function foo() {}` / `export default class C {}`
          // — keep the named declaration in place (so `foo` / `C` is still
          // accessible inside the module body), strip just `export default`.
          ms.remove(node.start, decl.start);
          exportStatements.push(`_exports.default = ${decl.id.name};`);
        } else {
          // Anonymous function/class OR arbitrary expression. Capture the
          // value in a fresh top-level `var` at the source position so the
          // identifier-rewrite walk can transform names inside the
          // expression. The `_exports.default = __default$N` assignment
          // is appended to the end of the AMD body so we have a single,
          // uniform emit pattern with named-declaration exports. The
          // `<expr>` itself still evaluates in source position — that
          // matches native ESM, where `export default foo; const foo =
          // ...` is also a TDZ error.
          //
          // Replace `export <ws/comments> default` with the var capture,
          // then append `)` before any trailing `;`. We do NOT trim to
          // `decl.start..decl.end` because acorn's positions SKIP
          // source-level parens — for `export default (foo);`, decl
          // points at `foo` (inside the parens), so consuming
          // `[node.start..decl.start]` would eat the source `(` while
          // leaving the source `)` untouched, producing `var X = (foo));`
          // (double-paren SyntaxError). Replacing only the keyword
          // sequence (no trailing whitespace) and appending before `;`
          // leaves source-level parens, comments and whitespace intact.
          //
          // Compute the keyword end by regex-scanning from `node.start`:
          // `export` + (whitespace | block-comment | line-comment)+ +
          // `default`. Tolerates `export\ndefault`,
          // `export /* c */ default`, etc. Hardcoding 15 chars (the
          // length of `'export default '`) was fragile — any non-canonical
          // whitespace or comment between the two keywords would mis-align
          // the rewrite.
          const tempName = freshDefaultName();
          const kwMatch =
            /^export(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\n]*\n)+default\b/.exec(
              src.slice(node.start, decl.start),
            );
          if (!kwMatch) {
            throw new Error(
              `amd-transpile: could not locate \`default\` keyword at offset ${node.start} in ${moduleId}`,
            );
          }
          const headEnd = node.start + kwMatch[0].length;
          ms.overwrite(node.start, headEnd, `var ${tempName} = (`);
          let tail = node.end;
          if (src[tail - 1] === ';') tail -= 1;
          ms.appendRight(tail, ')');
          exportStatements.push(`_exports.default = ${tempName};`);
        }
        break;
      }

      case 'ExportAllDeclaration': {
        // `export * from 'foo'`  |  `export * as ns from 'foo'`
        const source = node.source.value as string;
        const argName = sanitize(source) + '$' + deps.length;
        deps.push(source);
        argNames.push(argName);
        if (node.exported) {
          const exportedName =
            node.exported.type === 'Identifier'
              ? node.exported.name
              : (node.exported.value as string);
          exportStatements.push(defineGetter(exportedName, argName));
          localExportNames.push(exportedName);
        } else {
          hasExportStar = true;
          exportStatements.push(reExportStarSnippet(argName));
        }
        stripStatement(node);
        break;
      }

      default:
        // Other top-level node — leave alone. Identifiers inside are
        // walked by `IdentifierRewriter`.
        break;
    }
  }

  // Rewrite `import.meta` references and every non-shadowed source-code
  // reference to an imported name. Single AST walk so each node is
  // visited at most once.
  const usesImportMeta = new IdentifierRewriter(ms, importedAccess).run(ast);
  if (usesImportMeta) {
    deps.push('__import_meta__');
    argNames.push('__import_meta__');
  }

  // Compose the AMD wrapper.
  const headerLines: string[] = [
    `define(${JSON.stringify(moduleId)}, ${JSON.stringify(deps)}, function (${argNames.join(', ')}) {`,
    `  "use strict";`,
    `  Object.defineProperty(_exports, "__esModule", { value: true });`,
  ];

  if (hasExportStar) {
    headerLines.push(
      `  var _exportNames = ${JSON.stringify(
        Object.fromEntries(localExportNames.map((n) => [n, true])),
      )};`,
    );
  }

  ms.prepend(headerLines.join('\n') + '\n');
  ms.append(
    '\n' + exportStatements.map((s) => '  ' + s).join('\n') + '\n});\n',
  );

  return ms.toString();
}
