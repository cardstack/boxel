// Hand-rolled ES → AMD transpiler for the Loader. Replaces babel's
// `transformAsync(... TransformModulesAmdPlugin ...)` in `Loader.fetchModule`.
// ~10–15× faster than babel on real card sources (CS-10977).
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
//   - `export default <expression>` stripps the source statement to a
//     `var __default$N = (<expr>);` capture (so the identifier-rewrite
//     walk can rewrite imported names inside `<expr>`) and appends an
//     `_exports.default = __default$N` setter at the end of the body.
//     This avoids the TDZ trap when `<expr>` is a forward reference and
//     also avoids a magic-string overlap between the main statement
//     rewrite and the identifier-rewrite walk.
import { Parser, type Program, type Node } from 'acorn';
import MagicString from 'magic-string';

interface AmdTranspileOptions {
  // Module identifier embedded in the emitted `define(...)` call. Same role
  // as the `moduleId` option to babel's TransformModulesAmd plugin.
  moduleId: string;
}

// Sanitize a module specifier into something usable as a JS identifier
// for the dep parameter name. Collisions are still avoided by appending
// the dep index, so `_foo$1` and `_foo$2` cannot collide.
function sanitize(s: string): string {
  return '_' + String(s).replace(/[^a-zA-Z0-9_$]/g, '_');
}

// True if the given exported/imported name is a legal identifier (so we
// can emit `_exports.x = ...`); false means we must use bracket notation
// (`_exports['weird name'] = ...`).
function isIdentifier(name: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name);
}

function memberAccess(obj: string, prop: string): string {
  return isIdentifier(prop)
    ? `${obj}.${prop}`
    : `${obj}[${JSON.stringify(prop)}]`;
}

function exportLValue(name: string): string {
  return memberAccess('_exports', name);
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

  // Walk a binding pattern and call `cb` for every Identifier name bound
  // by the pattern (used for destructured `export const { a, b } = obj`).
  const collectPatternIdentifiers = (
    pattern: any,
    cb: (name: string) => void,
  ) => {
    if (!pattern) return;
    switch (pattern.type) {
      case 'Identifier':
        cb(pattern.name);
        break;
      case 'ObjectPattern':
        for (const prop of pattern.properties) {
          if (prop.type === 'RestElement') {
            collectPatternIdentifiers(prop.argument, cb);
          } else if (prop.type === 'Property') {
            collectPatternIdentifiers(prop.value, cb);
          }
        }
        break;
      case 'ArrayPattern':
        for (const el of pattern.elements) {
          if (el) collectPatternIdentifiers(el, cb);
        }
        break;
      case 'AssignmentPattern':
        collectPatternIdentifiers(pattern.left, cb);
        break;
      case 'RestElement':
        collectPatternIdentifiers(pattern.argument, cb);
        break;
    }
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
          collectPatternIdentifiers(d.id, (n) => topLevelDeclaredNames.add(n));
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
            collectPatternIdentifiers(d.id, (n) =>
              topLevelDeclaredNames.add(n),
            );
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
        // Pass 1 wrote the access expressions using `_foo$<index>` where
        // `<index>` matches `deps.length` at pass-1 time; pass 2 pushes in
        // the same order so the indices line up. Defensive:
        for (const spec of node.specifiers) {
          // The previously-recorded entry uses the same argName because
          // pass 1 and pass 2 see ast.body in the same order.
          // (No-op here; importedAccess is already populated.)
          void spec;
        }
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
              collectPatternIdentifiers(d.id, (name) => {
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
          // expression. Defer the `_exports.default` assignment to the end
          // of the AMD body via a setter (avoids TDZ when the expression
          // forward-references a `const`/`class` declared later in the
          // source).
          const tempName = freshDefaultName();
          // Replace just the prefix `export default ` with the var capture.
          // The expression body stays at its original source position, so
          // the walker visits it with the correct AST positions and no
          // magic-string overlap occurs.
          const exprStart = decl.start;
          ms.overwrite(node.start, exprStart, `var ${tempName} = (`);
          // Append `);` after the expression; if a trailing `;` already
          // exists in source we leave it alone (a stray extra `;` is fine).
          ms.appendRight(decl.end, ')');
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
        // walked by `rewriteIdentifierReferences`.
        break;
    }
  }

  // Rewrite `import.meta` references and every non-shadowed source-code
  // reference to an imported name. Single AST walk so each node is
  // visited at most once.
  const usesImportMeta = rewriteIdentifierReferences(ast, ms, importedAccess);
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

function defineGetter(exportedName: string, expr: string): string {
  return `Object.defineProperty(_exports, ${JSON.stringify(exportedName)}, { enumerable: true, configurable: true, get: function () { return ${expr}; } });`;
}

function defineLocalGetter(name: string): string {
  // The getter reads the local binding by name at access time, so mutations
  // to `name` (e.g. `counter++` inside an exported function) propagate to
  // importers. The local stays in the AMD body's lexical scope, so the
  // getter's closure can see it.
  return `Object.defineProperty(_exports, ${JSON.stringify(
    name,
  )}, { enumerable: true, configurable: true, get: function () { return ${name}; } });`;
}

// `export * from 'foo'` — install a getter for every key on the dep that
// isn't `default`/`__esModule` and isn't an explicit name on this module.
function reExportStarSnippet(argName: string): string {
  return (
    `Object.keys(${argName}).forEach(function (key) { ` +
    `if (key === "default" || key === "__esModule") return; ` +
    `if (Object.prototype.hasOwnProperty.call(_exportNames, key)) return; ` +
    `if (key in _exports && _exports[key] === ${argName}[key]) return; ` +
    `Object.defineProperty(_exports, key, { enumerable: true, get: function () { return ${argName}[key]; } }); ` +
    `});`
  );
}

// Walk the AST and rewrite every non-shadowed reference to an imported
// binding to its dep-arg property access. Also rewrites `import.meta` to
// `__import_meta__`. Returns true if `import.meta` was seen anywhere.
function rewriteIdentifierReferences(
  ast: Program,
  ms: MagicString,
  importedAccess: Map<string, string>,
): boolean {
  type Scope = { kind: 'function' | 'block'; names: Set<string> };
  const scopeChain: Scope[] = [];
  let usesImportMeta = false;

  const pushScope = (kind: 'function' | 'block') => {
    scopeChain.push({ kind, names: new Set() });
  };
  const popScope = () => {
    scopeChain.pop();
  };
  const declareInCurrent = (name: string) => {
    if (scopeChain.length > 0) {
      scopeChain[scopeChain.length - 1].names.add(name);
    }
  };
  const declareInFunction = (name: string) => {
    for (let i = scopeChain.length - 1; i >= 0; i--) {
      if (scopeChain[i].kind === 'function') {
        scopeChain[i].names.add(name);
        return;
      }
    }
  };
  const isShadowed = (name: string): boolean => {
    for (const scope of scopeChain) {
      if (scope.names.has(name)) return true;
    }
    return false;
  };

  const collectPatternBindings = (
    pattern: any,
    declareFn: (name: string) => void,
  ) => {
    if (!pattern) return;
    switch (pattern.type) {
      case 'Identifier':
        declareFn(pattern.name);
        break;
      case 'ObjectPattern':
        for (const prop of pattern.properties) {
          if (prop.type === 'RestElement') {
            collectPatternBindings(prop.argument, declareFn);
          } else if (prop.type === 'Property') {
            collectPatternBindings(prop.value, declareFn);
          }
        }
        break;
      case 'ArrayPattern':
        for (const el of pattern.elements) {
          if (el) collectPatternBindings(el, declareFn);
        }
        break;
      case 'AssignmentPattern':
        collectPatternBindings(pattern.left, declareFn);
        break;
      case 'RestElement':
        collectPatternBindings(pattern.argument, declareFn);
        break;
    }
  };

  // Recurse into a function body and collect var + function declarations
  // into the current (function) scope. Doesn't cross into nested function
  // bodies (they have their own scope).
  const collectFunctionScopeHoists = (body: any) => {
    if (!body) return;
    if (Array.isArray(body)) {
      for (const stmt of body) collectFunctionScopeHoists(stmt);
      return;
    }
    switch (body.type) {
      case 'VariableDeclaration':
        if (body.kind === 'var') {
          for (const d of body.declarations) {
            collectPatternBindings(d.id, declareInFunction);
          }
        }
        break;
      case 'FunctionDeclaration':
        if (body.id) declareInFunction(body.id.name);
        return;
      case 'BlockStatement':
        for (const s of body.body) collectFunctionScopeHoists(s);
        break;
      case 'IfStatement':
        collectFunctionScopeHoists(body.consequent);
        if (body.alternate) collectFunctionScopeHoists(body.alternate);
        break;
      case 'TryStatement':
        collectFunctionScopeHoists(body.block);
        if (body.handler) collectFunctionScopeHoists(body.handler.body);
        if (body.finalizer) collectFunctionScopeHoists(body.finalizer);
        break;
      case 'SwitchStatement':
        for (const c of body.cases) {
          for (const s of c.consequent) collectFunctionScopeHoists(s);
        }
        break;
      case 'WhileStatement':
      case 'DoWhileStatement':
      case 'ForStatement':
      case 'ForInStatement':
      case 'ForOfStatement':
      case 'WithStatement':
      case 'LabeledStatement':
        if (body.body) collectFunctionScopeHoists(body.body);
        if (body.init) collectFunctionScopeHoists(body.init);
        break;
    }
  };

  const collectBlockScopeDecls = (stmts: any[]) => {
    for (const stmt of stmts) {
      if (
        stmt.type === 'VariableDeclaration' &&
        (stmt.kind === 'let' || stmt.kind === 'const')
      ) {
        for (const d of stmt.declarations) {
          collectPatternBindings(d.id, declareInCurrent);
        }
      } else if (
        (stmt.type === 'ClassDeclaration' ||
          stmt.type === 'FunctionDeclaration') &&
        stmt.id
      ) {
        declareInCurrent(stmt.id.name);
      }
    }
  };

  // Returns true iff the Identifier at `node` is in a position where it's
  // referenced as a value (not a binding LHS, property key, or label).
  const isReferencePosition = (
    parent: any,
    parentKey: string,
    parentArrayKey: string | null,
  ): boolean => {
    if (!parent) return true;
    switch (parent.type) {
      case 'MemberExpression':
        if (parentKey === 'property' && !parent.computed) return false;
        return true;
      case 'Property':
        if (parentKey === 'key' && !parent.computed && !parent.shorthand) {
          return false;
        }
        return true;
      case 'MethodDefinition':
      case 'PropertyDefinition':
        if (parentKey === 'key' && !parent.computed) return false;
        return true;
      case 'LabeledStatement':
      case 'BreakStatement':
      case 'ContinueStatement':
        if (parentKey === 'label') return false;
        return true;
      case 'ImportSpecifier':
      case 'ImportDefaultSpecifier':
      case 'ImportNamespaceSpecifier':
        return false;
      case 'ExportSpecifier':
        return false;
      case 'VariableDeclarator':
        if (parentKey === 'id') return false;
        return true;
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ClassDeclaration':
      case 'ClassExpression':
      case 'ArrowFunctionExpression':
        if (parentKey === 'id') return false;
        if (parentArrayKey === 'params') return false;
        return true;
      case 'CatchClause':
        if (parentKey === 'param') return false;
        return true;
      case 'AssignmentPattern':
        if (parentKey === 'left') return false;
        return true;
      case 'RestElement':
        if (parentKey === 'argument') return false;
        return true;
      case 'ObjectPattern':
      case 'ArrayPattern':
        return false;
      default:
        return true;
    }
  };

  const walk = (
    node: any,
    parent: any,
    parentKey: string,
    parentArrayKey: string | null,
  ) => {
    if (!node || typeof node !== 'object') return;

    switch (node.type) {
      case 'Program': {
        for (const stmt of node.body) walk(stmt, node, 'body', 'body');
        return;
      }

      case 'ImportDeclaration':
        // The whole declaration was stripped by the main pass; don't walk
        // into its specifiers (they're bindings, not refs).
        return;

      case 'ExportNamedDeclaration':
        // `export const X = ...` / `export function f() {...}` — the
        // declaration body was kept (only `export ` keyword stripped), so
        // walk into it for identifier rewriting.
        if (node.declaration) {
          if (node.declaration.type === 'VariableDeclaration') {
            for (const d of node.declaration.declarations) {
              if (d.init) walk(d.init, d, 'init', null);
            }
          } else {
            walk(node.declaration, node, 'declaration', null);
          }
        }
        return;

      case 'ExportDefaultDeclaration':
        // For named function/class exports, the declaration stays in place;
        // for anonymous and arbitrary expressions, the source has been
        // wrapped as `var __default$N = (<expr>);` — the expression text is
        // intact at its original AST positions, so walking the declaration
        // is safe and correctly rewrites imported names within it.
        if (node.declaration) {
          walk(node.declaration, node, 'declaration', null);
        }
        return;

      case 'ExportAllDeclaration':
        return;

      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression': {
        pushScope('function');
        if (node.type === 'FunctionExpression' && node.id) {
          declareInCurrent(node.id.name);
        }
        for (const param of node.params) {
          collectPatternBindings(param, declareInCurrent);
        }
        for (const param of node.params) {
          walkPatternDefaults(param);
        }
        if (node.body && node.body.type === 'BlockStatement') {
          // For function bodies, treat the block scope as the function
          // scope (don't push a separate block scope inside).
          collectFunctionScopeHoists(node.body.body);
          collectBlockScopeDecls(node.body.body);
          for (const s of node.body.body) walk(s, node.body, 'body', 'body');
        } else if (node.body) {
          walk(node.body, node, 'body', null);
        }
        popScope();
        return;
      }

      case 'BlockStatement': {
        pushScope('block');
        collectBlockScopeDecls(node.body);
        for (const s of node.body) walk(s, node, 'body', 'body');
        popScope();
        return;
      }

      case 'ClassDeclaration':
      case 'ClassExpression': {
        if (node.superClass) walk(node.superClass, node, 'superClass', null);
        pushScope('block');
        if (node.id) declareInCurrent(node.id.name);
        if (node.body) walk(node.body, node, 'body', null);
        popScope();
        return;
      }

      case 'CatchClause': {
        pushScope('block');
        if (node.param) {
          collectPatternBindings(node.param, declareInCurrent);
          walkPatternDefaults(node.param);
        }
        if (node.body) walk(node.body, node, 'body', null);
        popScope();
        return;
      }

      case 'ForStatement':
      case 'ForInStatement':
      case 'ForOfStatement': {
        pushScope('block');
        if (node.init) walk(node.init, node, 'init', null);
        if (node.left) walk(node.left, node, 'left', null);
        if (node.test) walk(node.test, node, 'test', null);
        if (node.update) walk(node.update, node, 'update', null);
        if (node.right) walk(node.right, node, 'right', null);
        if (node.body) walk(node.body, node, 'body', null);
        popScope();
        return;
      }

      case 'VariableDeclaration': {
        for (const d of node.declarations) {
          walkPatternComputedKeys(d.id);
          if (d.init) walk(d.init, d, 'init', null);
        }
        return;
      }

      case 'MetaProperty': {
        if (
          node.meta &&
          node.meta.name === 'import' &&
          node.property &&
          node.property.name === 'meta'
        ) {
          usesImportMeta = true;
          ms.overwrite(node.start, node.end, '__import_meta__');
        }
        return;
      }

      case 'MemberExpression': {
        walk(node.object, node, 'object', null);
        if (node.computed) walk(node.property, node, 'property', null);
        return;
      }

      case 'Property': {
        if (node.computed) walk(node.key, node, 'key', null);
        walk(node.value, node, 'value', null);
        return;
      }

      case 'MethodDefinition':
      case 'PropertyDefinition': {
        if (node.computed) walk(node.key, node, 'key', null);
        if (node.value) walk(node.value, node, 'value', null);
        return;
      }

      case 'LabeledStatement': {
        if (node.body) walk(node.body, node, 'body', null);
        return;
      }
      case 'BreakStatement':
      case 'ContinueStatement':
        return;

      case 'Identifier': {
        if (
          isReferencePosition(parent, parentKey, parentArrayKey) &&
          !isShadowed(node.name)
        ) {
          const accessor = importedAccess.get(node.name);
          if (accessor) {
            ms.overwrite(node.start, node.end, accessor);
          }
        }
        return;
      }

      default: {
        for (const key of Object.keys(node)) {
          if (
            key === 'type' ||
            key === 'start' ||
            key === 'end' ||
            key === 'loc' ||
            key === 'range'
          ) {
            continue;
          }
          const child = (node as any)[key];
          if (Array.isArray(child)) {
            for (const c of child) {
              if (c && typeof c === 'object' && 'type' in c) {
                walk(c, node, key, key);
              }
            }
          } else if (child && typeof child === 'object' && 'type' in child) {
            walk(child, node, key, null);
          }
        }
      }
    }
  };

  const walkPatternDefaults = (pattern: any) => {
    if (!pattern) return;
    switch (pattern.type) {
      case 'AssignmentPattern':
        walkPatternDefaults(pattern.left);
        walk(pattern.right, pattern, 'right', null);
        break;
      case 'ObjectPattern':
        for (const prop of pattern.properties) {
          if (prop.type === 'RestElement') {
            walkPatternDefaults(prop.argument);
          } else if (prop.type === 'Property') {
            if (prop.computed) {
              walk(prop.key, prop, 'key', null);
            }
            walkPatternDefaults(prop.value);
          }
        }
        break;
      case 'ArrayPattern':
        for (const el of pattern.elements) {
          if (el) walkPatternDefaults(el);
        }
        break;
      case 'RestElement':
        walkPatternDefaults(pattern.argument);
        break;
    }
  };

  const walkPatternComputedKeys = (pattern: any) => {
    if (!pattern) return;
    switch (pattern.type) {
      case 'ObjectPattern':
        for (const prop of pattern.properties) {
          if (prop.type === 'Property' && prop.computed) {
            walk(prop.key, prop, 'key', null);
          }
          if (prop.type === 'Property') {
            walkPatternComputedKeys(prop.value);
          } else if (prop.type === 'RestElement') {
            walkPatternComputedKeys(prop.argument);
          }
        }
        break;
      case 'ArrayPattern':
        for (const el of pattern.elements) {
          if (el) walkPatternComputedKeys(el);
        }
        break;
      case 'AssignmentPattern':
        walkPatternComputedKeys(pattern.left);
        walk(pattern.right, pattern, 'right', null);
        break;
      case 'RestElement':
        walkPatternComputedKeys(pattern.argument);
        break;
    }
  };

  walk(ast, null, '', null);
  return usesImportMeta;
}
