/**
 * This babel.config is not used for publishing.
 * It's only for the local editing experience
 * (and linting)
 */

const {
  babelCompatSupport,
  templateCompatSupport,
} = require('@embroider/compat/babel');

module.exports = {
  plugins: [
    'ember-concurrency/async-arrow-task-transform',
    [
      '@babel/plugin-transform-typescript',
      {
        allExtensions: true,
        allowDeclareFields: true,
        onlyRemoveTypeImports: true,
      },
    ],
    [
      'babel-plugin-ember-template-compilation',
      {
        transforms: [
          ...templateCompatSupport(),
          'glimmer-scoped-css/ast-transform',
        ],
      },
    ],
    [
      'module:decorator-transforms',
      {
        runtime: {
          import: require.resolve('decorator-transforms/runtime-esm'),
        },
      },
    ],
    ...babelCompatSupport(),
  ],

  generatorOpts: {
    compact: false,
  },
};
