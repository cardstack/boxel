/**
 * @fileoverview Rule to remove unused import bindings without discarding
 * module evaluation.
 *
 * Unlike a plain "delete the import" autofix, this rule is careful about
 * side effects: importing a module executes its top-level code, so a
 * declaration whose bindings are all unused cannot simply be deleted unless
 * the module is known to be safe. The fix therefore:
 *
 * 1. Removes only the unused specifiers when other specifiers of the same
 *    declaration are still used.
 * 2. Deletes the whole declaration when it is type-only (type imports are
 *    erased at runtime, so nothing ever evaluates) or when the module
 *    matches the `sideEffectFreeModules` option.
 * 3. Otherwise rewrites the declaration to a bare side-effect import
 *    (`import 'module';`), preserving module evaluation.
 *
 * A binding is considered used when it has any reference — including
 * references from a `<template>` tag recorded by ember-eslint-parser — or
 * when another rule or the parser marked it as used.
 */
'use strict';

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Remove unused import bindings while preserving module evaluation',
      category: 'ES6',
      recommended: false,
      url: 'https://github.com/cardstack/boxel/blob/main/packages/eslint-plugin-boxel/docs/rules/no-unused-imports.md',
    },
    fixable: 'code',
    schema: [
      {
        type: 'object',
        properties: {
          sideEffectFreeModules: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      unusedImport: "'{{names}}' imported from '{{source}}' but never used",
    },
  },

  /**
   * Creates the rule handler.
   * @param {import('eslint').Rule.RuleContext} context - The rule context object.
   * @returns {object} The rule listeners.
   */
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();
    const options = context.options[0] || {};
    /** @type {string[]} */
    const sideEffectFreeModules = options.sideEffectFreeModules || [];

    /**
     * A module matches when an option entry equals it exactly, or when an
     * entry ends in `*` and is a prefix of it (e.g. `@cardstack/base/*`).
     * @param {string} source - The import source string.
     * @returns {boolean} Whether deleting the declaration is safe.
     */
    function isSideEffectFree(source) {
      return sideEffectFreeModules.some((entry) =>
        entry.endsWith('*')
          ? source.startsWith(entry.slice(0, -1))
          : source === entry,
      );
    }

    /**
     * @param {import('estree').ImportDeclaration} node - The declaration.
     * @returns {boolean} Whether the declaration never evaluates at runtime.
     */
    function isTypeOnly(node) {
      return (
        node.importKind === 'type' ||
        node.specifiers.every((spec) => spec.importKind === 'type')
      );
    }

    /**
     * @param {import('estree').ImportDeclaration} node - The declaration.
     * @returns {{ used: object[], unused: object[] }} Specifiers partitioned
     * by whether their binding has any reference.
     */
    function partitionSpecifiers(node) {
      const variables = context.getDeclaredVariables(node);
      const used = [];
      const unused = [];
      for (const spec of node.specifiers) {
        const variable = variables.find((v) =>
          v.defs.some((def) => def.node === spec),
        );
        // No matching variable means the scope analysis didn't cover this
        // specifier; treat it as used rather than risk deleting a live one.
        if (
          !variable ||
          variable.eslintUsed ||
          variable.references.length > 0
        ) {
          used.push(spec);
        } else {
          unused.push(spec);
        }
      }
      return { used, unused };
    }

    /**
     * Removes the unused specifiers by deleting their source ranges, leaving
     * the rest of the declaration byte-for-byte intact. Deleting ranges
     * rather than re-emitting the statement preserves everything a rebuild
     * would have to reproduce: import attributes (`with { type: 'json' }`,
     * whose loss makes a JSON import throw at runtime), the `type` keyword,
     * inline `type` markers, and comments between the kept specifiers.
     * @param {import('eslint').Rule.RuleFixer} fixer - The fixer object.
     * @param {import('estree').ImportDeclaration} node - The declaration.
     * @param {object[]} unused - The specifiers to remove, in source order.
     * @returns {import('eslint').Rule.Fix[]} The fix objects.
     */
    function removeUnusedSpecifiers(fixer, node, unused) {
      const text = sourceCode.getText();
      const fixes = [];
      const named = node.specifiers.filter((s) => s.type === 'ImportSpecifier');
      const unusedSet = new Set(unused);
      const namedUnused = named.filter((s) => unusedSet.has(s));
      const consumeSpace = (end) => (text[end] === ' ' ? end + 1 : end);
      const isComma = (t) => t.type === 'Punctuator' && t.value === ',';
      // When a removal spans everything on its line (a one-specifier-per-
      // line import), take the whole line so no whitespace-only line is
      // left behind.
      const expandToWholeLine = (range) => {
        let [start, end] = range;
        let lineStart = start;
        while (lineStart > 0 && text[lineStart - 1] !== '\n') {
          if (text[lineStart - 1] !== ' ' && text[lineStart - 1] !== '\t') {
            return range;
          }
          lineStart--;
        }
        if (text[end] === '\r' && text[end + 1] === '\n') {
          return [lineStart, end + 2];
        }
        if (text[end] === '\n') {
          return [lineStart, end + 1];
        }
        return range;
      };

      if (namedUnused.length > 0 && namedUnused.length === named.length) {
        // No named specifier survives: the whole brace group goes, along
        // with the comma tying it to the used default specifier before it.
        const openBrace = sourceCode.getTokenBefore(
          named[0],
          (t) => t.type === 'Punctuator' && t.value === '{',
        );
        const closeBrace = sourceCode.getTokenAfter(
          named[named.length - 1],
          (t) => t.type === 'Punctuator' && t.value === '}',
        );
        const before = sourceCode.getTokenBefore(openBrace);
        const start = isComma(before) ? before.range[0] : openBrace.range[0];
        fixes.push(fixer.removeRange([start, closeBrace.range[1]]));
      } else if (namedUnused.length > 0) {
        // Remove runs of consecutive unused specifiers so each separating
        // comma is deleted exactly once.
        for (let i = 0; i < named.length; i++) {
          if (!unusedSet.has(named[i])) {
            continue;
          }
          let j = i;
          while (j + 1 < named.length && unusedSet.has(named[j + 1])) {
            j++;
          }
          const commaAfter = sourceCode.getTokenAfter(named[j]);
          if (j < named.length - 1 || isComma(commaAfter)) {
            // A kept specifier follows the run, or a trailing comma closes
            // it: remove through the comma. Going forward rather than
            // backward keeps a comment above the run (it may annotate the
            // kept specifiers around it).
            fixes.push(
              fixer.removeRange(
                expandToWholeLine([
                  named[i].range[0],
                  consumeSpace(commaAfter.range[1]),
                ]),
              ),
            );
          } else {
            // The run ends the list with no trailing comma: remove from
            // the comma after the last kept specifier.
            const comma = sourceCode.getTokenBefore(named[i], isComma);
            fixes.push(fixer.removeRange([comma.range[0], named[j].range[1]]));
          }
          i = j;
        }
      }

      for (const spec of unused) {
        if (spec.type === 'ImportDefaultSpecifier') {
          const comma = sourceCode.getTokenAfter(spec, isComma);
          fixes.push(
            fixer.removeRange([spec.range[0], consumeSpace(comma.range[1])]),
          );
        } else if (spec.type === 'ImportNamespaceSpecifier') {
          const comma = sourceCode.getTokenBefore(spec, isComma);
          fixes.push(fixer.removeRange([comma.range[0], spec.range[1]]));
        }
      }
      return fixes;
    }

    /**
     * Removes the declaration together with the line break that follows it
     * and any comments directly above it. A directive comment left behind —
     * an `eslint-disable-next-line` or `@ts-ignore` — would silently
     * re-target the next statement, so a comment attached to the import
     * (immediately above it, on its own line) goes with it; a comment that
     * shares a line with earlier code belongs to that code and stays.
     * @param {import('eslint').Rule.RuleFixer} fixer - The fixer object.
     * @param {import('estree').ImportDeclaration} node - The declaration.
     * @returns {import('eslint').Rule.Fix} The fix object.
     */
    function removeWithNewline(fixer, node) {
      const text = sourceCode.getText();
      let start = node.range[0];
      let expectedLine = node.loc.start.line;
      const comments = sourceCode.getCommentsBefore(node);
      for (let i = comments.length - 1; i >= 0; i--) {
        const comment = comments[i];
        if (comment.loc.end.line !== expectedLine - 1) {
          break;
        }
        const tokenBefore = sourceCode.getTokenBefore(comment, {
          includeComments: true,
        });
        if (tokenBefore && tokenBefore.loc.end.line === comment.loc.start.line) {
          break;
        }
        start = comment.range[0];
        expectedLine = comment.loc.start.line;
      }
      let end = node.range[1];
      if (text[end] === '\r' && text[end + 1] === '\n') {
        end += 2;
      } else if (text[end] === '\n') {
        end += 1;
      }
      return fixer.removeRange([start, end]);
    }

    return {
      // Runs at exit so every reference — including ones the parser records
      // for `<template>` bodies — is in the scope manager before we judge
      // a binding unused.
      'Program:exit'(program) {
        for (const node of program.body) {
          if (node.type !== 'ImportDeclaration' || node.specifiers.length === 0) {
            continue;
          }
          const { used, unused } = partitionSpecifiers(node);
          if (unused.length === 0) {
            continue;
          }
          const source = node.source.value;
          context.report({
            node: unused[0],
            messageId: 'unusedImport',
            data: {
              names: unused.map((spec) => spec.local.name).join("', '"),
              source,
            },
            fix(fixer) {
              if (used.length > 0) {
                return removeUnusedSpecifiers(fixer, node, unused);
              }
              if (isTypeOnly(node) || isSideEffectFree(source)) {
                return removeWithNewline(fixer, node);
              }
              // The module may rely on being evaluated; keep the import,
              // drop only the bindings. Replacing only up to the module
              // string leaves everything after it — import attributes and
              // the terminator — untouched.
              return fixer.replaceTextRange(
                [node.range[0], node.source.range[0]],
                'import ',
              );
            },
          });
        }
      },
    };
  },
};
