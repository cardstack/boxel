// Walks the AST and rewrites identifier references to imported names
// in place via magic-string edits. This is the heart of the live-
// binding mechanism — see the architectural notes in `index.ts` for
// why we rewrite source references to `_dep.name` instead of
// destructuring imports at body entry.
//
// The walker maintains a scope chain so a `let x` (or function param,
// catch param, etc.) inside a function/block correctly shadows an
// imported `x`. Each `walk()` call dispatches on `node.type`; the
// default arm generic-recurses for any AST shape we don't handle
// explicitly.
//
// One IdentifierRewriter is constructed per `transpileAmd` call and
// thrown away after `run()`. Construction is cheap.
import type { Program, AnyNode } from 'acorn';
import type MagicString from 'magic-string';
import { collectPatternBindings, isReferencePosition } from './pattern-helpers';

// One scope on the rewriter's scope stack. `function` scopes own `var`
// / function-decl / parameter bindings; `block` scopes own
// let/const/class declarations.
type Scope = { kind: 'function' | 'block'; names: Set<string> };

// Loose alias for AST node parents — most of the walker's `parent`
// argument can be any AST node, but generic recursion in the default
// arm can also pass a Program/BlockStatement etc. Keep it as `AnyNode`
// since every AST node we visit has a `type` discriminator.
type WalkNode = AnyNode | null | undefined;

export class IdentifierRewriter {
  private readonly scopeChain: Scope[] = [];
  private usesImportMeta = false;

  constructor(
    private readonly ms: MagicString,
    private readonly importedAccess: ReadonlyMap<string, string>,
  ) {}

  // Walk the AST. Returns true iff at least one `import.meta` usage
  // was rewritten — caller uses that to decide whether to declare the
  // `__import_meta__` AMD dep.
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

  // Collect block-scoped declarations (let/const/using/await using/
  // class/function decls in a block) from the given statement list into
  // the current scope.
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
  // property keys inside a pattern. Used when entering a function /
  // catch scope: parameter identifiers themselves are bindings (handled
  // by `collectPatternBindings`), but defaults are reference-position
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

  // Walk only the computed-key expressions and assignment-pattern
  // defaults inside a pattern. Used when the surrounding context is a
  // binding LHS (variable declarator, destructure-assignment) — the
  // binding identifiers themselves stay as-is, but `[expr]` keys and
  // `= rhs` defaults are reference-position expressions that must be
  // rewritten.
  walkPatternComputedKeys(pattern: WalkNode): void {
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
      case 'MemberExpression':
        // Destructure-assignment to a member of an existing binding,
        // e.g. `({ x: obj.field } = src)` or `[obj.field] = src`. The
        // MemberExpression's `object` is a reference position — if
        // `obj` names an import we must rewrite it, otherwise the
        // emitted AMD body references an undeclared name. Walk the
        // MemberExpression normally (the regular `MemberExpression`
        // arm of `walk()` only rewrites `object`, plus `property` if
        // computed — which is what we want).
        this.walk(node, null, '', null);
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
        // declaration body was kept (only `export ` keyword stripped),
        // so walk into it for identifier rewriting. For destructured
        // forms like `export const { [k]: v } = obj`, we also need to
        // walk computed keys in the pattern (the `k` reference, not
        // the `v` binding LHS).
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
        // For named function/class exports, the declaration stays in
        // place; for anonymous and arbitrary expressions, the source
        // has been wrapped as `var __default$N = (<expr>);` — the
        // expression text is intact at its original AST positions, so
        // walking the declaration is safe and correctly rewrites
        // imported names within it.
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
        // Both FunctionDeclaration and (named) FunctionExpression bind
        // their own name inside the function body so recursive
        // `f()` self-references are visible there. For
        // FunctionDeclaration this also defends top-level functions
        // whose name matches an imported binding from being rewritten
        // to the import accessor in the body — the enclosing Program
        // scope isn't tracked here, so the self-decl is the only
        // shadow available at the recursive call site.
        if (
          (node.type === 'FunctionExpression' ||
            node.type === 'FunctionDeclaration') &&
          node.id
        ) {
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
        // Class static initializer block — ES2022 `class C { static {
        // ... } }`. It has its own var + lexical environment (like a
        // function body) so `let x` inside MUST shadow imports only
        // within the block, not in surrounding instance methods. Treat
        // as function scope.
        this.pushScope('function');
        this.collectFunctionScopeHoists(node.body);
        this.collectBlockScopeDecls(node.body);
        for (const s of node.body) this.walk(s, node, 'body', 'body');
        this.popScope();
        return;
      }

      case 'SwitchStatement': {
        // JS treats the entire switch body as one block scope. `let` /
        // `const` / `class` declared in `case 1:` are still in scope
        // (in TDZ) during `case 2:`. Without this, a `let x` declared
        // in a case where `x` is also imported would let the walker
        // rewrite later references to `_foo.x`.
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
        // the for-head into the block scope BEFORE walking init / test /
        // update / body — otherwise the loop variable would still be
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
        // _exports namespace (`imp = 1` would compile to
        // `_foo.imp = 1`). ESM treats imports as read-only; mirror
        // that by leaving the identifier alone. At runtime the
        // unbound name will throw ReferenceError under strict mode
        // (AMD modules ARE strict).
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
            // Shorthand property `{ x }` where `x` is an imported
            // name: the AST has `key` and `value` both pointing at
            // the same Identifier node. Naive
            // `ms.overwrite(start, end, '_foo.x')` would emit
            // `{ _foo.x }` — a SyntaxError. Insert the explicit
            // `key:` prefix so we get `{ x: _foo.x }`.
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
        // Generic recursion over child nodes — fallback for any AST
        // type not handled explicitly above. Keys we know are non-AST
        // metadata are skipped.
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
