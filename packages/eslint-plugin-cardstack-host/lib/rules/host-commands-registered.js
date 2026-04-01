const fs = require('fs');
const path = require('path');

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Ensure every host command module is imported, shimmed, and exported',
      category: 'Best Practices',
      recommended: false,
    },
    schema: [],
  },
  create(context) {
    const filename = context.getFilename();

    if (
      typeof filename !== 'string' ||
      filename === '<text>' ||
      !filename.endsWith(path.join('app', 'commands', 'index.ts'))
    ) {
      return {};
    }

    const commandsDir = path.dirname(filename);
    const importedModules = new Map(); // alias -> './module-name'
    const shimmedModules = new Set();
    const hostClassReferences = new Set();

    const registerArrayElement = (element) => {
      if (!element) {
        return;
      }

      switch (element.type) {
        case 'Identifier':
          hostClassReferences.add(element.name);
          break;
        case 'MemberExpression':
          if (
            element.object &&
            element.object.type === 'Identifier' &&
            element.object.name
          ) {
            hostClassReferences.add(element.object.name);
          }
          if (
            element.property &&
            element.property.type === 'Identifier' &&
            element.property.name
          ) {
            hostClassReferences.add(element.property.name);
          }
          break;
        case 'CallExpression':
          if (
            element.callee &&
            element.callee.type === 'MemberExpression' &&
            element.callee.object.type === 'Identifier'
          ) {
            hostClassReferences.add(element.callee.object.name);
          }
          break;
        default:
          break;
      }
    };

    return {
      ImportDeclaration(node) {
        if (
          node.source &&
          node.source.type === 'Literal' &&
          typeof node.source.value === 'string' &&
          node.source.value.startsWith('./') &&
          !/index$/.test(node.source.value)
        ) {
          node.specifiers.forEach((specifier) => {
            if (specifier.type === 'ImportNamespaceSpecifier') {
              importedModules.set(
                specifier.local.name,
                normalizeModuleSpecifier(node.source.value),
              );
            }
          });
        }
      },

      CallExpression(node) {
        if (
          node.callee &&
          node.callee.type === 'MemberExpression' &&
          node.callee.object &&
          node.callee.object.type === 'Identifier' &&
          node.callee.object.name === 'virtualNetwork' &&
          node.callee.property &&
          node.callee.property.type === 'Identifier' &&
          node.callee.property.name === 'shimModule' &&
          node.arguments.length >= 2
        ) {
          const moduleIdentifier = node.arguments[1];
          if (moduleIdentifier && moduleIdentifier.type === 'Identifier') {
            shimmedModules.add(moduleIdentifier.name);
          }
        }
      },

      ExportNamedDeclaration(node) {
        if (
          node.declaration &&
          node.declaration.type === 'VariableDeclaration'
        ) {
          node.declaration.declarations.forEach((declaration) => {
            if (
              declaration.id.type === 'Identifier' &&
              declaration.id.name === 'HostCommandClasses' &&
              declaration.init &&
              declaration.init.type === 'ArrayExpression'
            ) {
              declaration.init.elements.forEach(registerArrayElement);
            }
          });
        }
      },

      'Program:exit'(node) {
        const expectedModules = listCommandModules(commandsDir);
        const importedModuleSet = new Set(importedModules.values());

        expectedModules
          .filter((module) => !importedModuleSet.has(module.specifier))
          .forEach((missingModule) => {
            context.report({
              node,
              message: `Command module "${missingModule.specifier}" is missing from imports in commands/index.ts.`,
            });
          });

        for (const [alias, moduleName] of importedModules) {
          const moduleInfo = expectedModules.find(
            (module) => module.specifier === moduleName,
          );
          if (!moduleInfo) {
            continue;
          }

          if (!shimmedModules.has(alias)) {
            context.report({
              node,
              message: `Command module "${moduleName}" is imported but never shimmed with virtualNetwork.shimModule.`,
            });
          }
          if (moduleInfo.requiresHostClass && !hostClassReferences.has(alias)) {
            context.report({
              node,
              message: `Command module "${moduleName}" is imported but not referenced in HostCommandClasses.`,
            });
          }
        }
      },
    };
  },
};

function listCommandModules(commandsDir) {
  if (!fs.existsSync(commandsDir)) {
    return [];
  }

  return fs
    .readdirSync(commandsDir)
    .filter((filename) => filename.endsWith('.ts') && filename !== 'index.ts')
    .map((filename) => {
      const fullPath = path.join(commandsDir, filename);
      let requiresHostClass = false;

      try {
        const source = fs.readFileSync(fullPath, 'utf8');
        requiresHostClass = /extends\s+HostBaseCommand/.test(source);

        if (requiresHostClass) {
          const constructorMatch = source.match(
            /constructor\s*\(([^)]*)\)/m,
          );
          if (constructorMatch) {
            const params = constructorMatch[1]
              .split(',')
              .map((param) => param.trim())
              .filter(Boolean);
            if (params.length > 1) {
              const secondParam = params[1];
              const isOptionalSecondParam =
                /\?/.test(secondParam) || /=/.test(secondParam);
              if (!isOptionalSecondParam) {
                requiresHostClass = false;
              }
            }
          }
        }
      } catch (err) {
        // Ignore read failures but default to requiring a HostCommandClass entry.
        requiresHostClass = true;
      }

      return {
        specifier: `./${filename.replace(/\.ts$/, '')}`,
        requiresHostClass,
      };
    });
}

function normalizeModuleSpecifier(specifier) {
  if (specifier.endsWith('.ts')) {
    return specifier.replace(/\.ts$/, '');
  }
  return specifier;
}
