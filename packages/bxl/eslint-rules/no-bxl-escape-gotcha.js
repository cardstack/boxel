// ESLint rule: flag plain-string BXL expressions containing `\(`.
//
// JS string literals (and untagged template literals) silently drop
// the backslash before `(`, so a user-typed `"\(.foo)"` becomes
// `"(.foo)"` by the time the BXL runtime sees it — the interpolation
// never fires. The fix is to use the `jq` or `fx` tagged template,
// which exposes the raw source to the tag function via String.raw.
//
// Targets: calls to `expression(...)`, `expr(...)`, `bxl(...)` whose
// first argument is:
//   - a string literal containing `\(`
//   - an untagged template literal containing `\(`
//
// Tagged template arguments (e.g. `expression(jq\`...\`)`) are
// always allowed — the tag controls escape behavior.

const TARGET_CALLEES = new Set(['expression', 'expr', 'bxl']);

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow `\\(` inside plain-string BXL expressions — the JS escape silently drops the backslash. Use `jq`…`` instead.',
    },
    messages: {
      escapeGotcha:
        "Plain BXL expression contains `\\(` — JS strips the backslash before `(`, so the runtime never sees the jq interpolation. Use `jq`…`` to preserve it verbatim.",
    },
    schema: [],
  },
  create(context) {
    function isTargetCall(node) {
      const callee = node.callee;
      return callee.type === 'Identifier' && TARGET_CALLEES.has(callee.name);
    }

    return {
      CallExpression(node) {
        if (!isTargetCall(node)) return;
        const arg = node.arguments[0];
        if (!arg) return;

        // Plain string literal — `expression('"\(.foo)"')`.
        if (
          arg.type === 'Literal' &&
          typeof arg.value === 'string' &&
          typeof arg.raw === 'string' &&
          arg.raw.includes('\\(')
        ) {
          context.report({ node: arg, messageId: 'escapeGotcha' });
          return;
        }

        // Untagged template literal — `expression(\`"\(.foo)"\`)`.
        // Tagged ones (`expression(jq\`...\`)`) parse as a
        // TaggedTemplateExpression, not a TemplateLiteral, and never
        // reach this branch.
        if (arg.type === 'TemplateLiteral') {
          for (const quasi of arg.quasis) {
            if (quasi.value.raw.includes('\\(')) {
              context.report({ node: quasi, messageId: 'escapeGotcha' });
              return;
            }
          }
        }
      },
    };
  },
};

export default rule;
