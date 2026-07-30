/**
 * This babel config is only used when building dist/ for publishing.
 *
 * Workspace consumers compile the .gts source themselves (see
 * package.json#exports); babel.config.json remains their reference config.
 */
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
        targetFormat: 'hbs',
        transforms: ['glimmer-scoped-css/ast-transform'],
      },
    ],
    [
      'module:decorator-transforms',
      {
        runtime: {
          import: 'decorator-transforms/runtime-esm',
        },
      },
    ],
  ],

  generatorOpts: {
    compact: false,
  },
};
