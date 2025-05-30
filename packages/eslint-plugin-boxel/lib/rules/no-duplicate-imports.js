/**
 * @fileoverview Rule to prevent duplicate imports from the same module
 * @author GitHub Copilot
 *
 * This rule identifies and auto-fixes cases where the same specifiers are imported
 * multiple times from a single module. It's designed to help maintain cleaner code
 * by automatically removing duplicate import specifiers.
 *
 * For example, it will detect and fix code like:
 * ```js
 * import { a } from 'module';
 * import { a, b } from 'module';
 * ```
 *
 * The rule can:
 * 1. Remove individual duplicate specifiers from import statements
 * 2. Remove entire import statements if all specifiers are duplicates
 * 3. Handle various edge cases like first/last specifier placement and comma handling
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
      description: 'Prevent duplicate imports from the same module',
      category: 'ES6',
      recommended: true,
      url: 'https://github.com/cardstack/boxel/blob/main/packages/eslint-plugin-boxel/docs/rules/no-duplicate-imports.md',
    },
    fixable: 'code',
    schema: [],
    messages: {
      duplicateImport: "Duplicate import '{{name}}' from '{{source}}'",
    },
  },

  /**
   * Creates the rule handler.
   * @param {import('eslint').Rule.RuleContext} context - The rule context object.
   * @returns {object} The rule listeners.
   */
  create(context) {
    // Track imports by source
    const sourceImports = new Map(); // Maps source to a Map of specifier names to nodes
    // Store processed nodes to avoid duplicate reports
    const reported = new Set();

    return {
      /**
       * Program handler. Runs once for each file and resets tracking maps.
       */
      Program() {
        // Reset maps for each program
        sourceImports.clear();
        reported.clear();
      },

      /**
       * ImportDeclaration handler. Processes each import statement and checks for duplicates.
       * @param {import('estree').ImportDeclaration} node - The import declaration node.
       */
      ImportDeclaration(node) {
        const source = node.source.value;

        // Initialize tracking for this source if needed
        if (!sourceImports.has(source)) {
          sourceImports.set(source, new Map());
        }

        const importSpecifiersForSource = sourceImports.get(source);
        const namedSpecifiers = node.specifiers.filter(
          (spec) => spec.type === 'ImportSpecifier',
        );

        // Handle default imports
        const defaultSpecifier = node.specifiers.find(
          (spec) => spec.type === 'ImportDefaultSpecifier',
        );

        if (
          defaultSpecifier &&
          importSpecifiersForSource.has('default') &&
          !reported.has(defaultSpecifier)
        ) {
          reported.add(defaultSpecifier);
          context.report({
            node: defaultSpecifier,
            messageId: 'duplicateImport',
            data: {
              name: 'default import',
              source: source,
            },
            fix(fixer) {
              if (node.specifiers.length === 1) {
                return fixer.remove(node);
              } else if (node.specifiers.length > 1) {
                const nextIdx = node.specifiers.indexOf(defaultSpecifier) + 1;
                if (nextIdx < node.specifiers.length) {
                  // Remove the default import and the comma after it
                  const nextSpecifier = node.specifiers[nextIdx];
                  return fixer.removeRange([
                    defaultSpecifier.range[0],
                    nextSpecifier.range[0],
                  ]);
                }
              }
            },
          });
        } else if (defaultSpecifier) {
          importSpecifiersForSource.set('default', defaultSpecifier);
        }

        // Skip if there are no named specifiers
        if (namedSpecifiers.length === 0) {
          return;
        }

        // Track duplicates for this node to determine if entire import can be removed
        const duplicatesInThisNode = [];

        // Check each specifier for duplicates
        for (const specifier of namedSpecifiers) {
          const importedName = specifier.imported.name;

          // If we've seen this import already, report it
          if (
            importSpecifiersForSource.has(importedName) &&
            !reported.has(specifier)
          ) {
            duplicatesInThisNode.push(specifier);
            reported.add(specifier);

            context.report({
              node: specifier,
              messageId: 'duplicateImport',
              data: {
                name: importedName,
                source: source,
              },
              /**
               * Generates a fix for duplicate imports.
               * @param {import('eslint').Rule.RuleFixer} fixer - The fixer object.
               * @returns {import('eslint').Rule.Fix} The fix object.
               */
              fix(fixer) {
                // If this node has all the same specifiers as already imported ones
                // and has no other types of imports, remove the entire import declaration
                const allSpecifiersAreDuplicates = namedSpecifiers.every(
                  (spec) => importSpecifiersForSource.has(spec.imported.name),
                );

                const importHasOnlyNamedSpecifiers =
                  node.specifiers.length === namedSpecifiers.length;

                if (
                  allSpecifiersAreDuplicates &&
                  importHasOnlyNamedSpecifiers
                ) {
                  return fixer.remove(node);
                }

                // Otherwise, just remove this specific specifier
                if (node.specifiers.length > 1) {
                  // Find position in the specifiers list
                  const specifierIdx = node.specifiers.indexOf(specifier);

                  // Handle different cases based on position
                  if (specifierIdx === 0 && node.specifiers.length > 1) {
                    // If it's the first specifier and there are more, remove up to the next one
                    const end = node.specifiers[1].range[0];
                    return fixer.removeRange([specifier.range[0], end]);
                  } else if (specifierIdx > 0) {
                    // If it's not the first, remove from after the previous specifier
                    const prevSpecifier = node.specifiers[specifierIdx - 1];
                    const start = prevSpecifier.range[1];

                    // If it's the last specifier, we need to handle trailing comma
                    if (specifierIdx === node.specifiers.length - 1) {
                      // Remove from after the comma of the previous specifier
                      return fixer.removeRange([start, specifier.range[1]]);
                    } else {
                      // Remove up to the next specifier
                      const nextSpecifier = node.specifiers[specifierIdx + 1];
                      return fixer.removeRange([start, nextSpecifier.range[0]]);
                    }
                  }
                } else {
                  // If it's the only specifier, remove the entire import
                  return fixer.remove(node);
                }
              },
            });
          } else {
            // Record this import for future reference
            importSpecifiersForSource.set(importedName, specifier);
          }
        }
      },
    };
  },
};
