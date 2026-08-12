import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildMacros } from '@embroider/macros/babel';

const macros = buildMacros();

/**
 * This babel config drives the vite dev/test pipeline (see vite.config.mjs).
 *
 * Publishing uses babel.publish.config.cjs instead, and workspace consumers
 * compile the .gts source with their own configs.
 */
export default {
  plugins: [
    [
      '@babel/plugin-transform-typescript',
      {
        allExtensions: true,
        onlyRemoveTypeImports: true,
        allowDeclareFields: true,
      },
    ],
    'ember-concurrency/async-arrow-task-transform',
    [
      'babel-plugin-ember-template-compilation',
      {
        transforms: [
          ...macros.templateMacros,
          'glimmer-scoped-css/ast-transform',
        ],
      },
    ],
    [
      'module:decorator-transforms',
      {
        runtime: {
          import: fileURLToPath(
            import.meta.resolve('decorator-transforms/runtime-esm'),
          ),
        },
      },
    ],
    [
      '@babel/plugin-transform-runtime',
      {
        absoluteRuntime: dirname(fileURLToPath(import.meta.url)),
        useESModules: true,
        regenerator: false,
      },
    ],
    ...macros.babelMacros,
  ],

  generatorOpts: {
    compact: false,
  },
};
