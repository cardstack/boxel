const {
  babelCompatSupport,
  templateCompatSupport,
} = require('@embroider/compat/babel');
const path = require('node:path');

const {
  moduleProvenancePlugin,
} = require('../runtime-common/loader-plugin.ts');

const baseDir = path.resolve(__dirname, '../base');

module.exports = {
  plugins: [
    [
      '@babel/plugin-transform-typescript',
      {
        allExtensions: true,
        onlyRemoveTypeImports: true,
        allowDeclareFields: true,
      },
    ],
    [
      'babel-plugin-ember-template-compilation',
      {
        compilerPath: 'ember-source/dist/ember-template-compiler.js',
        enableLegacyModules: [
          'ember-cli-htmlbars',
          'ember-cli-htmlbars-inline-precompile',
          'htmlbars-inline-precompile',
        ],
        transforms: [
          ...templateCompatSupport(),
          'glimmer-scoped-css/ast-transform',
        ],
      },
    ],
    'ember-concurrency/async-arrow-task-transform',
    [
      'module:decorator-transforms',
      {
        runtime: {
          import: require.resolve('decorator-transforms/runtime-esm'),
        },
      },
    ],
    [
      '@babel/plugin-transform-runtime',
      {
        absoluteRuntime: __dirname,
        useESModules: true,
        regenerator: false,
      },
    ],
    ...babelCompatSupport(),
  ],

  overrides: [
    {
      // A base module compiled into the host bundle is evaluated without a
      // loader, so it marks each class it declares with the identifier the
      // loader serves the module under, as the realm's transpiler does for a
      // module the loader fetches.
      test: (filename) =>
        Boolean(filename) &&
        filename.startsWith(`${baseDir}${path.sep}`) &&
        !filename.includes(`${path.sep}node_modules${path.sep}`),
      plugins: [
        [
          moduleProvenancePlugin,
          { moduleRoot: baseDir, modulePrefix: '@cardstack/base/' },
        ],
      ],
    },
  ],

  generatorOpts: {
    compact: false,
  },
};
