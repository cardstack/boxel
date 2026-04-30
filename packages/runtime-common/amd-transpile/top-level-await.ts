// Top-level-await detector. Used by `transpileAmd` to reject TLA at
// transpile time with a clear error, instead of letting it fall through
// to a confusing `SyntaxError: await is only valid in async functions`
// from inside the loader's `eval(src)` call.
import type { Program } from 'acorn';

type WalkNode = unknown;

// Detect a top-level form that requires an async enclosing scope:
//   - `AwaitExpression` (the obvious case)
//   - `for await (...) {}` — `ForOfStatement` with `await: true`, NOT an
//     AwaitExpression child, but still requires async context
//   - `await using r = ...` — `VariableDeclaration` with kind
//     `'await using'` (ES2024 explicit-resource-management proposal)
export function hasTopLevelAwait(ast: Program): boolean {
  let found = false;
  const visit = (node: WalkNode): void => {
    if (found || !node || typeof node !== 'object') return;
    const n = node as { type: string; [key: string]: unknown };
    // Don't cross function boundaries — `await` inside a regular or
    // async function is a non-issue for the AMD wrapper.
    if (
      n.type === 'FunctionDeclaration' ||
      n.type === 'FunctionExpression' ||
      n.type === 'ArrowFunctionExpression'
    ) {
      return;
    }
    if (n.type === 'AwaitExpression') {
      found = true;
      return;
    }
    if (n.type === 'ForOfStatement' && n.await) {
      found = true;
      return;
    }
    if (n.type === 'VariableDeclaration' && n.kind === 'await using') {
      found = true;
      return;
    }
    for (const key of Object.keys(n)) {
      if (
        key === 'type' ||
        key === 'start' ||
        key === 'end' ||
        key === 'loc' ||
        key === 'range'
      ) {
        continue;
      }
      const child = n[key];
      if (Array.isArray(child)) {
        for (const c of child) visit(c);
      } else if (child && typeof child === 'object' && 'type' in child) {
        visit(child);
      }
    }
  };
  for (const stmt of ast.body) visit(stmt);
  return found;
}
