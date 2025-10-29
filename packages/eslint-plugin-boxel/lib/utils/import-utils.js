/** @type {import('eslint').Rule.RuleModule} */

/**
 * Adds an import statement for a missing import, or augments an existing import statement
 * @param {import('eslint').Rule.RuleFixer} fixer The fixer instance
 * @param {import('eslint').SourceCode} sourceCode The source code object
 * @param {string} consumedName The local name that will be used in the code
 * @param {string} exportedName The name that is exported from the module
 * @param {string} module The module to import from
 * @returns {import('eslint').Rule.Fix | null}
 */
function fixMissingImport(
  fixer,
  sourceCode,
  consumedName,
  exportedName,
  module,
) {
  // Check if an import from this module already exists
  const importDeclarations = sourceCode.ast.body.filter(
    (node) =>
      node.type === 'ImportDeclaration' &&
      node.source.value === module &&
      // Skip type-only imports
      node.importKind !== 'type',
  );

  if (importDeclarations.length > 0) {
    // Module is already imported, so add to existing import
    // Use the first non-type import declaration
    const existingImport = importDeclarations[0];

    // If it's a default import that we need to add
    if (exportedName === 'default') {
      // Check if the default import already exists
      const hasDefaultImport = existingImport.specifiers.some(
        (specifier) => specifier.type === 'ImportDefaultSpecifier',
      );

      if (hasDefaultImport) {
        // Default import already exists - nothing to do
        return null;
      } else {
        // Add default import to existing named imports
        if (existingImport.specifiers.length > 0) {
          return fixer.insertTextBefore(
            existingImport.specifiers[0],
            `${consumedName}, `,
          );
        } else {
          // Edge case: Empty import statement like `import {} from 'module'`
          // Preserve the semicolon and trailing comments
          const importText = sourceCode.getText(existingImport);
          const endsWithSemicolon = importText.trim().endsWith(';');

          return fixer.replaceText(
            existingImport,
            `import ${consumedName} from '${module}'${endsWithSemicolon ? ';' : ''}`,
          );
        }
      }
    } else {
      // It's a named import that we need to add
      // Check if it's already imported
      const hasNamedImport = existingImport.specifiers.some(
        (specifier) =>
          specifier.type === 'ImportSpecifier' &&
          ((specifier.imported &&
            specifier.imported.name === exportedName &&
            specifier.local.name === consumedName) ||
            (specifier.local &&
              specifier.imported === null &&
              specifier.local.name === consumedName)),
      );

      if (hasNamedImport) {
        // The specific import already exists - nothing to do
        return null;
      }

      // Create the new import specifier text
      const newSpecifier =
        consumedName === exportedName
          ? consumedName
          : `${exportedName} as ${consumedName}`;

      // Find where to insert the new import
      const namedImportSpecifiers = existingImport.specifiers.filter(
        (spec) => spec.type === 'ImportSpecifier',
      );

      if (namedImportSpecifiers.length > 0) {
        // Add to existing named imports at the end of the list
        const lastSpecifier =
          namedImportSpecifiers[namedImportSpecifiers.length - 1];
        return fixer.insertTextAfter(lastSpecifier, `, ${newSpecifier}`);
      } else if (existingImport.specifiers.length > 0) {
        // Has default import but no named imports
        const defaultImport = existingImport.specifiers.find(
          (spec) => spec.type === 'ImportDefaultSpecifier',
        );

        // Add named imports after default import
        return fixer.insertTextAfter(defaultImport, `, { ${newSpecifier} }`);
      } else {
        // Empty import statement, replace it completely
        // Preserve the semicolon and trailing comments
        const importText = sourceCode.getText(existingImport);
        const endsWithSemicolon = importText.trim().endsWith(';');

        return fixer.replaceText(
          existingImport,
          `import { ${newSpecifier} } from '${module}'${endsWithSemicolon ? ';' : ''}`,
        );
      }
    }
  } else {
    // No existing import from this module, create a new import statement
    const importStatement = buildImportStatement(
      consumedName,
      exportedName,
      module,
    );
    return fixer.insertTextBeforeRange([0, 0], `${importStatement};\n`);
  }
}

/**
 * Checks if a node is bound in the current scope
 * @param {object} node The AST node to check
 * @param {object} scope The scope object
 * @returns {boolean}
 */
function isBound(node, scope) {
  if (!scope) {
    return false;
  }

  const identifierName = node.name;

  let currentScope = scope;
  while (currentScope) {
    if (currentScope.set && currentScope.set.has(identifierName)) {
      return true;
    }
    currentScope = currentScope.upper;
  }

  const ref = scope.references.find((v) => v.identifier === node);
  if (!ref) {
    return false;
  }
  return Boolean(ref.resolved);
}

/**
 * Builds an import statement
 * @param {string} consumedName The local name to use
 * @param {string} exportedName The name exported from the module
 * @param {string} module The module to import from
 * @returns {string}
 */
function buildImportStatement(consumedName, exportedName, module) {
  if (exportedName === 'default') {
    return `import ${consumedName} from '${module}'`;
  } else {
    return consumedName === exportedName
      ? `import { ${consumedName} } from '${module}'`
      : `import { ${exportedName} as ${consumedName} } from '${module}'`;
  }
}

module.exports = {
  fixMissingImport,
  isBound,
  buildImportStatement,
};
