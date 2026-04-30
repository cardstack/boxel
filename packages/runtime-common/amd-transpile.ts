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
//     This avoids the TDZ trap when `<expr>` is a forward reference and
//     also avoids a magic-string overlap between the main statement
//     rewrite and the identifier-rewrite walk.
import {
  Parser,
  type Program,
  type Node,
  type AnyNode,
  type Pattern,
} from 'acorn';
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

// Walk a binding pattern (the LHS of a `let`/`const`/`var`/parameter/
// destructured-assignment) and call `cb` for every Identifier name bound
// by the pattern. Pure — used by both `transpileAmd`'s pass 1 (top-level
// declared names + destructured-export emission) and the
// `IdentifierRewriter` (scope tracking).
function collectPatternBindings(
  pattern: Pattern | null | undefined,
  cb: (name: string) => void,
): void {
  if (!pattern) return;
  switch (pattern.type) {
    case 'Identifier':
      cb(pattern.name);
      break;
    case 'ObjectPattern':
      for (const prop of pattern.properties) {
        if (prop.type === 'RestElement') {
          collectPatternBindings(prop.argument, cb);
        } else {
          collectPatternBindings(prop.value as Pattern, cb);
        }
      }
      break;
    case 'ArrayPattern':
      for (const el of pattern.elements) {
        if (el) collectPatternBindings(el, cb);
      }
      break;
    case 'AssignmentPattern':
      collectPatternBindings(pattern.left, cb);
      break;
    case 'RestElement':
      collectPatternBindings(pattern.argument, cb);
      break;
    // MemberExpression can appear as a pattern in destructure-assignment
    // (e.g. `[obj.x] = arr`) but binds no new name; nothing to do.
  }
}

// Returns true iff an Identifier at the given position is a value
// reference (not a binding LHS, property key, or label).
function isReferencePosition(
  parent: AnyNode | null,
  parentKey: string,
  parentArrayKey: string | null,
): boolean {
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
          // expression. Defer the `_exports.default` assignment to the end
          // of the AMD body via a setter (avoids TDZ when the expression
          // forward-references a `const`/`class` declared later in the
          // source).
          //
          // Replace just the `export default ` keyword (15 chars) with the
          // var capture, then append `)` before any trailing `;`. We do
          // NOT trim to `decl.start..decl.end` because acorn's positions
          // SKIP source-level parens — for `export default (foo);`, decl
          // points at `foo` (inside the parens), so consuming
          // `[node.start..decl.start]` would eat the source `(` while
          // leaving the source `)` untouched, producing `var X = (foo));`
          // (double-paren SyntaxError). Replacing only the keyword and
          // appending before `;` leaves source-level parens intact, which
          // is harmless: `var X = ((foo));` parses fine.
          const tempName = freshDefaultName();
          const headEnd = node.start + 'export default '.length;
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

// One scope on the rewriter's scope stack. `function` scopes own `var` /
// function-decl / parameter bindings; `block` scopes own let/const/class
// declarations.
type Scope = { kind: 'function' | 'block'; names: Set<string> };

// Loose alias for AST node parents — most of the walker's `parent`
// argument can be any AST node, but generic recursion in the default arm
// can also pass a Program/BlockStatement etc. Keep it as `AnyNode` since
// every AST node we visit has a `type` discriminator.
type WalkNode = AnyNode | null | undefined;

// Rewrite AST identifiers in place via magic-string edits.
//
// For each non-shadowed source-code reference to an imported name, replace
// it with `_dep.name`. Also rewrites `import.meta` to `__import_meta__`.
// Maintains a scope chain so a `let x` (or function parameter, catch
// param, etc.) inside a function/block correctly shadows an imported `x`.
//
// Construction is cheap; one IdentifierRewriter is used per `transpileAmd`
// call. `run(ast)` returns true iff at least one `import.meta` usage was
// rewritten (so the caller can declare the `__import_meta__` AMD dep).
class IdentifierRewriter {
  private readonly scopeChain: Scope[] = [];
  private usesImportMeta = false;

  constructor(
    private readonly ms: MagicString,
    private readonly importedAccess: ReadonlyMap<string, string>,
  ) {}

  run(ast: Program): boolean {
    this.walk(ast, null, '', null);
    return this.usesImportMeta;
  }

  // ---- scope helpers ----

  private pushScope(kind: 'function' | 'block'): void {
    this.scopeChain.push({ kind, names: new Set() });
  }

  private popScope(): void {
    this.scopeChain.pop();
  }

  private declareInCurrent(name: string): void {
    if (this.scopeChain.length > 0) {
      this.scopeChain[this.scopeChain.length - 1].names.add(name);
    }
  }

  private declareInFunction(name: string): void {
    for (let i = this.scopeChain.length - 1; i >= 0; i--) {
      if (this.scopeChain[i].kind === 'function') {
        this.scopeChain[i].names.add(name);
        return;
      }
    }
  }

  private isShadowed(name: string): boolean {
    for (const scope of this.scopeChain) {
      if (scope.names.has(name)) return true;
    }
    return false;
  }

  // Recurse into a function body and collect var + function declarations
  // into the current (function) scope. Doesn't cross into nested function
  // bodies (they have their own scope).
  private collectFunctionScopeHoists(
    body: WalkNode | readonly WalkNode[],
  ): void {
    if (!body) return;
    if (Array.isArray(body)) {
      for (const stmt of body) this.collectFunctionScopeHoists(stmt);
      return;
    }
    const node = body as AnyNode;
    switch (node.type) {
      case 'VariableDeclaration':
        if (node.kind === 'var') {
          for (const d of node.declarations) {
            collectPatternBindings(d.id, (n) => this.declareInFunction(n));
          }
        }
        break;
      case 'FunctionDeclaration':
        if (node.id) this.declareInFunction(node.id.name);
        return;
      case 'BlockStatement':
        for (const s of node.body) this.collectFunctionScopeHoists(s);
        break;
      case 'IfStatement':
        this.collectFunctionScopeHoists(node.consequent);
        if (node.alternate) this.collectFunctionScopeHoists(node.alternate);
        break;
      case 'TryStatement':
        this.collectFunctionScopeHoists(node.block);
        if (node.handler) this.collectFunctionScopeHoists(node.handler.body);
        if (node.finalizer) this.collectFunctionScopeHoists(node.finalizer);
        break;
      case 'SwitchStatement':
        for (const c of node.cases) {
          for (const s of c.consequent) this.collectFunctionScopeHoists(s);
        }
        break;
      case 'WhileStatement':
      case 'DoWhileStatement':
      case 'WithStatement':
      case 'LabeledStatement':
        if (node.body) this.collectFunctionScopeHoists(node.body);
        break;
      case 'ForStatement':
        if (node.init) this.collectFunctionScopeHoists(node.init);
        if (node.body) this.collectFunctionScopeHoists(node.body);
        break;
      case 'ForInStatement':
      case 'ForOfStatement':
        // `var x` in the LHS hoists to function scope just like any other.
        if (node.left) this.collectFunctionScopeHoists(node.left);
        if (node.body) this.collectFunctionScopeHoists(node.body);
        break;
    }
  }

  // Collect block-scoped declarations (let/const/using/await using/class/
  // function decls in a block) from the given statement list into the
  // current scope.
  private collectBlockScopeDecls(stmts: readonly AnyNode[]): void {
    for (const stmt of stmts) {
      if (
        stmt.type === 'VariableDeclaration' &&
        // `let` / `const` plus the ES2024 explicit-resource-management
        // forms `using` / `await using` are all block-scoped.
        (stmt.kind === 'let' ||
          stmt.kind === 'const' ||
          stmt.kind === 'using' ||
          stmt.kind === 'await using')
      ) {
        for (const d of stmt.declarations) {
          collectPatternBindings(d.id, (n) => this.declareInCurrent(n));
        }
      } else if (
        (stmt.type === 'ClassDeclaration' ||
          stmt.type === 'FunctionDeclaration') &&
        stmt.id
      ) {
        this.declareInCurrent(stmt.id.name);
      }
    }
  }

  // Walk only the binding-default expressions (`= rhs`) and computed
  // property keys inside a pattern. Used when entering a function/catch
  // scope: parameter identifiers themselves are bindings (handled by
  // collectPatternBindings), but defaults are reference-position
  // expressions that need normal walking.
  private walkPatternDefaults(pattern: WalkNode): void {
    if (!pattern) return;
    const node = pattern as AnyNode;
    switch (node.type) {
      case 'AssignmentPattern':
        this.walkPatternDefaults(node.left);
        this.walk(node.right, node, 'right', null);
        break;
      case 'ObjectPattern':
        for (const prop of node.properties) {
          if (prop.type === 'RestElement') {
            this.walkPatternDefaults(prop.argument);
          } else {
            if (prop.computed) this.walk(prop.key, prop, 'key', null);
            this.walkPatternDefaults(prop.value);
          }
        }
        break;
      case 'ArrayPattern':
        for (const el of node.elements) {
          if (el) this.walkPatternDefaults(el);
        }
        break;
      case 'RestElement':
        this.walkPatternDefaults(node.argument);
        break;
    }
  }

  // Walk only the computed-key expressions and assignment-pattern defaults
  // inside a pattern. Used when the surrounding context is a binding LHS
  // (variable declarator, destructure-assignment) — the binding identifiers
  // themselves stay as-is, but `[expr]` keys and `= rhs` defaults are
  // reference-position expressions that must be rewritten.
  private walkPatternComputedKeys(pattern: WalkNode): void {
    if (!pattern) return;
    const node = pattern as AnyNode;
    switch (node.type) {
      case 'ObjectPattern':
        for (const prop of node.properties) {
          if (prop.type === 'Property') {
            if (prop.computed) this.walk(prop.key, prop, 'key', null);
            this.walkPatternComputedKeys(prop.value);
          } else if (prop.type === 'RestElement') {
            this.walkPatternComputedKeys(prop.argument);
          }
        }
        break;
      case 'ArrayPattern':
        for (const el of node.elements) {
          if (el) this.walkPatternComputedKeys(el);
        }
        break;
      case 'AssignmentPattern':
        this.walkPatternComputedKeys(node.left);
        this.walk(node.right, node, 'right', null);
        break;
      case 'RestElement':
        this.walkPatternComputedKeys(node.argument);
        break;
    }
  }

  // ---- the main visitor ----

  private walk(
    node: WalkNode,
    parent: AnyNode | null,
    parentKey: string,
    parentArrayKey: string | null,
  ): void {
    if (!node || typeof node !== 'object') return;

    switch (node.type) {
      case 'Program': {
        for (const stmt of node.body) {
          this.walk(stmt, node, 'body', 'body');
        }
        return;
      }

      case 'ImportDeclaration':
        // Whole declaration was stripped by the main pass; don't walk
        // into specifiers (they're bindings, not refs).
        return;

      case 'ExportNamedDeclaration':
        // `export const X = ...` / `export function f() {...}` — the
        // declaration body was kept (only `export ` keyword stripped), so
        // walk into it for identifier rewriting. For destructured forms
        // like `export const { [k]: v } = obj`, we also need to walk
        // computed keys in the pattern (the `k` reference, not the `v`
        // binding LHS).
        if (node.declaration) {
          if (node.declaration.type === 'VariableDeclaration') {
            for (const d of node.declaration.declarations) {
              this.walkPatternComputedKeys(d.id);
              if (d.init) this.walk(d.init, d, 'init', null);
            }
          } else {
            this.walk(node.declaration, node, 'declaration', null);
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
          this.walk(node.declaration, node, 'declaration', null);
        }
        return;

      case 'ExportAllDeclaration':
        return;

      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression': {
        this.pushScope('function');
        if (node.type === 'FunctionExpression' && node.id) {
          this.declareInCurrent(node.id.name);
        }
        for (const param of node.params) {
          collectPatternBindings(param, (n) => this.declareInCurrent(n));
        }
        for (const param of node.params) {
          this.walkPatternDefaults(param);
        }
        if (node.body && node.body.type === 'BlockStatement') {
          // For function bodies, treat the block scope as the function
          // scope (don't push a separate block scope inside).
          this.collectFunctionScopeHoists(node.body.body);
          this.collectBlockScopeDecls(node.body.body);
          for (const s of node.body.body) {
            this.walk(s, node.body, 'body', 'body');
          }
        } else if (node.body) {
          this.walk(node.body, node, 'body', null);
        }
        this.popScope();
        return;
      }

      case 'BlockStatement': {
        this.pushScope('block');
        this.collectBlockScopeDecls(node.body);
        for (const s of node.body) this.walk(s, node, 'body', 'body');
        this.popScope();
        return;
      }

      case 'ClassDeclaration':
      case 'ClassExpression': {
        if (node.superClass) {
          this.walk(node.superClass, node, 'superClass', null);
        }
        this.pushScope('block');
        if (node.id) this.declareInCurrent(node.id.name);
        if (node.body) this.walk(node.body, node, 'body', null);
        this.popScope();
        return;
      }

      case 'CatchClause': {
        this.pushScope('block');
        if (node.param) {
          collectPatternBindings(node.param, (n) => this.declareInCurrent(n));
          this.walkPatternDefaults(node.param);
        }
        if (node.body) this.walk(node.body, node, 'body', null);
        this.popScope();
        return;
      }

      case 'StaticBlock': {
        // Class static initializer block — ES2022 `class C { static { ... } }`.
        // It has its own var + lexical environment (like a function body)
        // so `let x` inside MUST shadow imports only within the block, not
        // in surrounding instance methods. Treat as function scope.
        this.pushScope('function');
        this.collectFunctionScopeHoists(node.body);
        this.collectBlockScopeDecls(node.body);
        for (const s of node.body) this.walk(s, node, 'body', 'body');
        this.popScope();
        return;
      }

      case 'SwitchStatement': {
        // JS treats the entire switch body as one block scope. `let`/
        // `const`/`class` declared in `case 1:` are still in scope (in
        // TDZ) during `case 2:`. Without this, a `let x` declared in a
        // case where `x` is also imported would let the walker rewrite
        // post-loop references to `_foo.x`.
        this.pushScope('block');
        const allCaseStmts: AnyNode[] = [];
        for (const c of node.cases) {
          for (const s of c.consequent) allCaseStmts.push(s);
        }
        this.collectBlockScopeDecls(allCaseStmts);
        this.walk(node.discriminant, node, 'discriminant', null);
        for (const c of node.cases) {
          if (c.test) this.walk(c.test, c, 'test', null);
          for (const s of c.consequent) {
            this.walk(s, c, 'consequent', 'consequent');
          }
        }
        this.popScope();
        return;
      }

      case 'ForStatement':
      case 'ForInStatement':
      case 'ForOfStatement': {
        this.pushScope('block');
        // Pull `let` / `const` / `using` / `await using` bindings out of
        // the for-head into the block scope BEFORE walking init/test/
        // update/body — otherwise the loop variable would still be
        // visible as a top-level (potentially imported) name and
        // references inside the body would get rewritten to `_dep.x`.
        const heads: WalkNode[] =
          node.type === 'ForStatement'
            ? [node.init]
            : [(node as { left: AnyNode }).left];
        for (const head of heads) {
          if (
            head &&
            head.type === 'VariableDeclaration' &&
            (head.kind === 'let' ||
              head.kind === 'const' ||
              head.kind === 'using' ||
              head.kind === 'await using')
          ) {
            for (const d of head.declarations) {
              collectPatternBindings(d.id, (n) => this.declareInCurrent(n));
            }
          }
        }
        if (node.type === 'ForStatement') {
          if (node.init) this.walk(node.init, node, 'init', null);
          if (node.test) this.walk(node.test, node, 'test', null);
          if (node.update) this.walk(node.update, node, 'update', null);
        } else {
          // `for (... of/in ...)` LHS without a declarator is a
          // destructure-assignment to existing bindings — same Lvalue
          // rule as `AssignmentExpression`. If the LHS is an
          // ObjectPattern / ArrayPattern, walk only computed keys and
          // assignment-pattern defaults so imported names in
          // shorthand-property positions (e.g. `for ({ a } of items)`)
          // aren't rewritten to `_dep.a`, which would silently mutate
          // the dep namespace.
          const left = node.left;
          if (left.type === 'ObjectPattern' || left.type === 'ArrayPattern') {
            this.walkPatternComputedKeys(left);
          } else {
            this.walk(left, node, 'left', null);
          }
          this.walk(node.right, node, 'right', null);
        }
        if (node.body) this.walk(node.body, node, 'body', null);
        this.popScope();
        return;
      }

      case 'VariableDeclaration': {
        for (const d of node.declarations) {
          this.walkPatternComputedKeys(d.id);
          if (d.init) this.walk(d.init, d, 'init', null);
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
          this.usesImportMeta = true;
          this.ms.overwrite(node.start, node.end, '__import_meta__');
        }
        return;
      }

      case 'MemberExpression': {
        this.walk(node.object, node, 'object', null);
        if (node.computed) this.walk(node.property, node, 'property', null);
        return;
      }

      case 'Property': {
        if (node.computed) this.walk(node.key, node, 'key', null);
        this.walk(node.value, node, 'value', null);
        return;
      }

      case 'MethodDefinition':
      case 'PropertyDefinition': {
        if (node.computed) this.walk(node.key, node, 'key', null);
        if (node.value) this.walk(node.value, node, 'value', null);
        return;
      }

      case 'LabeledStatement': {
        if (node.body) this.walk(node.body, node, 'body', null);
        return;
      }
      case 'BreakStatement':
      case 'ContinueStatement':
        return;

      case 'AssignmentExpression': {
        // The LHS is an Lvalue, not a reference. We must NOT rewrite
        // imported names there — that would silently mutate the dep's
        // _exports namespace (`imp = 1` would compile to `_foo.imp = 1`).
        // ESM treats imports as read-only; mirror that by leaving the
        // identifier alone. At runtime the unbound name will throw
        // ReferenceError under strict mode (AMD modules ARE strict).
        const left = node.left;
        if (left.type === 'ObjectPattern' || left.type === 'ArrayPattern') {
          // Destructuring assignment, e.g. `({ x } = obj)`. Walk only
          // computed keys + assignment-pattern defaults; the binding
          // identifiers themselves stay as-is.
          this.walkPatternComputedKeys(left);
        } else if (left.type === 'Identifier') {
          // `imp = 1` — leave the LHS untouched.
        } else {
          // MemberExpression or other — walk normally so e.g.
          // `obj.x = imp` rewrites `imp` (it's a reference there).
          this.walk(left, node, 'left', null);
        }
        this.walk(node.right, node, 'right', null);
        return;
      }

      case 'UpdateExpression': {
        // `imp++` / `++imp` / `imp--` / `--imp`. Same rule as
        // AssignmentExpression: the argument is an LValue, not a
        // reference. Leave Identifier arguments alone; walk
        // MemberExpression arguments normally.
        const arg = node.argument;
        if (arg.type !== 'Identifier') {
          this.walk(arg, node, 'argument', null);
        }
        return;
      }

      case 'Identifier': {
        if (
          isReferencePosition(parent, parentKey, parentArrayKey) &&
          !this.isShadowed(node.name)
        ) {
          const accessor = this.importedAccess.get(node.name);
          if (accessor) {
            // Shorthand property `{ x }` where `x` is an imported name:
            // the AST has `key` and `value` both pointing at the same
            // Identifier node. Naive `ms.overwrite(start, end, '_foo.x')`
            // would emit `{ _foo.x }` — a SyntaxError. Insert the
            // explicit `key:` prefix so we get `{ x: _foo.x }`.
            if (
              parent &&
              parent.type === 'Property' &&
              parent.shorthand &&
              parentKey === 'value'
            ) {
              this.ms.overwrite(
                node.start,
                node.end,
                `${node.name}: ${accessor}`,
              );
            } else {
              this.ms.overwrite(node.start, node.end, accessor);
            }
          }
        }
        return;
      }

      default: {
        // Generic recursion over child nodes — fallback for any AST type
        // not handled explicitly above. Keys we know are non-AST metadata
        // are skipped.
        const fields = node as unknown as Record<string, unknown>;
        for (const key of Object.keys(fields)) {
          if (
            key === 'type' ||
            key === 'start' ||
            key === 'end' ||
            key === 'loc' ||
            key === 'range'
          ) {
            continue;
          }
          const child = fields[key];
          if (Array.isArray(child)) {
            for (const c of child) {
              if (c && typeof c === 'object' && 'type' in c) {
                this.walk(c as AnyNode, node, key, key);
              }
            }
          } else if (child && typeof child === 'object' && 'type' in child) {
            this.walk(child as AnyNode, node, key, null);
          }
        }
      }
    }
  }
}

// Detect a top-level form that requires an async enclosing scope:
//   - `AwaitExpression` (the obvious case)
//   - `for await (...) {}` — `ForOfStatement` with `await: true`, NOT an
//     AwaitExpression child, but still requires async context
//   - `await using r = ...` — `VariableDeclaration` with kind `'await using'`
//     (ES2024 explicit-resource-management proposal)
// Used to reject TLA at transpile time — see `transpileAmd`.
function hasTopLevelAwait(ast: Program): boolean {
  let found = false;
  const visit = (node: WalkNode): void => {
    if (found || !node || typeof node !== 'object') return;
    // Don't cross function boundaries — `await` inside a regular or
    // async function is a non-issue for the AMD wrapper.
    if (
      node.type === 'FunctionDeclaration' ||
      node.type === 'FunctionExpression' ||
      node.type === 'ArrowFunctionExpression'
    ) {
      return;
    }
    if (node.type === 'AwaitExpression') {
      found = true;
      return;
    }
    if (node.type === 'ForOfStatement' && node.await) {
      found = true;
      return;
    }
    if (node.type === 'VariableDeclaration' && node.kind === 'await using') {
      found = true;
      return;
    }
    const fields = node as unknown as Record<string, unknown>;
    for (const key of Object.keys(fields)) {
      if (
        key === 'type' ||
        key === 'start' ||
        key === 'end' ||
        key === 'loc' ||
        key === 'range'
      ) {
        continue;
      }
      const child = fields[key];
      if (Array.isArray(child)) {
        for (const c of child) visit(c as WalkNode);
      } else if (child && typeof child === 'object' && 'type' in child) {
        visit(child as WalkNode);
      }
    }
  };
  for (const stmt of ast.body) visit(stmt);
  return found;
}
