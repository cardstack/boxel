/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'disallow usage of card-api with missing imports with auto-fix',
      category: 'Ember Octane',
      url: 'https://github.com/cardstack/boxel/blob/main/packages/eslint-plugin-boxel/docs/rules/missing-card-api-import.md',
      recommended: true,
    },
    fixable: 'code',
    schema: [
      {
        type: 'object',
        properties: {
          importMappings: {
            type: 'object',
            additionalProperties: {
              type: 'array',
              prefixItems: [
                {
                  type: 'string',
                  description: 'The name to import from the module',
                },
                { type: 'string', description: 'The module to import from' },
              ],
            },
          },
        },
      },
    ],
    messages: {
      'missing-card-api-import':
        'Not in scope. Did you forget to import this? Auto-fix may be configured.',
    },
  },

  create: (context) => {
    const sourceCode = context.sourceCode;

    function fixMissingImport(fixer, consumedName, exportedName, module) {
      // Check if an import from this module already exists
      const importDeclarations = sourceCode.ast.body.filter(
        node => node.type === 'ImportDeclaration' && 
               node.source.value === module &&
               // Skip type-only imports
               node.importKind !== 'type'
      );
      
      if (importDeclarations.length > 0) {
        // Module is already imported, so add to existing import
        // Use the first non-type import declaration
        const existingImport = importDeclarations[0];
        
        // If it's a default import that we need to add
        if (exportedName === 'default') {
          // Check if the default import already exists
          const hasDefaultImport = existingImport.specifiers.some(
            specifier => specifier.type === 'ImportDefaultSpecifier'
          );
          
          if (hasDefaultImport) {
            // Default import already exists - nothing to do
            return null;
          } else {
            // Add default import to existing named imports
            if (existingImport.specifiers.length > 0) {
              return fixer.insertTextBefore(existingImport.specifiers[0], `${consumedName}, `);
            } else {
              // Edge case: Empty import statement like `import {} from 'module'`
              // Preserve the semicolon and trailing comments
              const importText = sourceCode.getText(existingImport);
              const endsWithSemicolon = importText.trim().endsWith(';');
              
              return fixer.replaceText(
                existingImport, 
                `import ${consumedName} from '${module}'${endsWithSemicolon ? ';' : ''}`
              );
            }
          }
        } else {
          // It's a named import that we need to add
          // Check if it's already imported
          const hasNamedImport = existingImport.specifiers.some(
            specifier => 
              specifier.type === 'ImportSpecifier' &&
              (
                (specifier.imported && specifier.imported.name === exportedName && specifier.local.name === consumedName) || 
                (specifier.local && specifier.imported === null && specifier.local.name === consumedName)
              )
          );
          
          if (hasNamedImport) {
            // The specific import already exists - nothing to do
            return null;
          }
          
          // Create the new import specifier text
          const newSpecifier = consumedName === exportedName
            ? consumedName
            : `${exportedName} as ${consumedName}`;
            
          // Find where to insert the new import
          const namedImportSpecifiers = existingImport.specifiers.filter(
            spec => spec.type === 'ImportSpecifier'
          );
          
          if (namedImportSpecifiers.length > 0) {
            // Add to existing named imports at the end of the list
            const lastSpecifier = namedImportSpecifiers[namedImportSpecifiers.length - 1];
            return fixer.insertTextAfter(lastSpecifier, `, ${newSpecifier}`);
          } else if (existingImport.specifiers.length > 0) {
            // Has default import but no named imports
            const defaultImport = existingImport.specifiers.find(
              spec => spec.type === 'ImportDefaultSpecifier'
            );
            
            // Add named imports after default import
            return fixer.insertTextAfter(
              defaultImport,
              `, { ${newSpecifier} }`
            );
          } else {
            // Empty import statement, replace it completely
            // Preserve the semicolon and trailing comments
            const importText = sourceCode.getText(existingImport);
            const endsWithSemicolon = importText.trim().endsWith(';');
            
            return fixer.replaceText(
              existingImport, 
              `import { ${newSpecifier} } from '${module}'${endsWithSemicolon ? ';' : ''}`
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

    // Checks if a class extends another class and validates the base class is in scope
    function checkBaseClass(node) {
      if (node.superClass) {
        // For direct identifier references like "extends BaseClass"
        if (node.superClass.type === 'Identifier') {
          const baseClassName = node.superClass.name;
          if (!isBound(node.superClass, sourceCode.getScope(node))) {
            const matched = context.options[0]?.importMappings?.[baseClassName];
            if (matched) {
              const [name, module] = matched;
              context.report({
                node: node.superClass,
                messageId: 'missing-card-api-import',
                fix(fixer) {
                  return fixMissingImport(fixer, baseClassName, name, module);
                },
              });
            }
          }
        }
      }
    }

    return {
      // Handle regular JavaScript/TypeScript class declarations
      ClassDeclaration(node) {
        checkBaseClass(node);
      },
      // Handle class expressions (like in variable declarations)
      ClassExpression(node) {
        checkBaseClass(node);
      },
    };
  },
};

function isBound(node, scope) {
  const ref = scope.references.find((v) => v.identifier === node);
  if (!ref) {
    return false;
  }
  return Boolean(ref.resolved);
}

function buildImportStatement(consumedName, exportedName, module) {
  if (exportedName === 'default') {
    return `import ${consumedName} from '${module}'`;
  } else {
    return consumedName === exportedName
      ? `import { ${consumedName} } from '${module}'`
      : `import { ${exportedName} as ${consumedName} } from '${module}'`;
  }
}
