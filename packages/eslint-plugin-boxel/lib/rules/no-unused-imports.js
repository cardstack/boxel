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
     * Rebuilds the declaration's text from its used specifiers.
     * @param {import('estree').ImportDeclaration} node - The declaration.
     * @param {object[]} used - The specifiers to keep, in source order.
     * @returns {string} The replacement statement.
     */
    function rebuildDeclaration(node, used) {
      const parts = [];
      const named = [];
      for (const spec of used) {
        if (spec.type === 'ImportDefaultSpecifier') {
          parts.push(spec.local.name);
        } else if (spec.type === 'ImportNamespaceSpecifier') {
          parts.push(sourceCode.getText(spec));
        } else {
          named.push(sourceCode.getText(spec));
        }
      }
      if (named.length > 0) {
        parts.push(`{ ${named.join(', ')} }`);
      }
      const typePrefix = node.importKind === 'type' ? ' type' : '';
      return `import${typePrefix} ${parts.join(', ')} from ${sourceCode.getText(
        node.source,
      )};`;
    }

    /**
     * Removes the declaration together with the line break that follows it,
     * so the fix doesn't leave a blank line behind.
     * @param {import('eslint').Rule.RuleFixer} fixer - The fixer object.
     * @param {import('estree').ImportDeclaration} node - The declaration.
     * @returns {import('eslint').Rule.Fix} The fix object.
     */
    function removeWithNewline(fixer, node) {
      const text = sourceCode.getText();
      let end = node.range[1];
      if (text[end] === '\r' && text[end + 1] === '\n') {
        end += 2;
      } else if (text[end] === '\n') {
        end += 1;
      }
      return fixer.removeRange([node.range[0], end]);
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
                return fixer.replaceText(node, rebuildDeclaration(node, used));
              }
              if (isTypeOnly(node) || isSideEffectFree(source)) {
                return removeWithNewline(fixer, node);
              }
              // The module may rely on being evaluated; keep the import,
              // drop only the bindings.
              return fixer.replaceText(
                node,
                `import ${sourceCode.getText(node.source)};`,
              );
            },
          });
        }
      },
    };
  },
};
