const path = require('node:path');
const {
  babelCompatSupport,
  templateCompatSupport,
} = require('@embroider/compat/babel');
const {
  exportIdentityPlugin,
} = require('@cardstack/runtime-common/export-identity-plugin');

const baseDir = path.resolve(__dirname, '..', 'base') + path.sep;

// Only base realm modules compiled into the host bundle are tagged, with the
// identifier the loader gives a bundled base module:
// `/abs/packages/base/date/day.gts` → `@cardstack/base/date/day`.
function baseModuleIdentifier(filename) {
  let file = filename.split('?')[0];
  if (
    !file.startsWith(baseDir) ||
    file.includes(`${path.sep}node_modules${path.sep}`) ||
    !/\.(gts|ts)$/.test(file)
  ) {
    return null;
  }
  let name = file
    .slice(baseDir.length)
    .replace(/\.(gts|ts)$/, '')
    .split(path.sep)
    .join('/');
  return `@cardstack/base/${name}`;
}

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
    [exportIdentityPlugin, { moduleIdentifier: baseModuleIdentifier }],
  ],

  generatorOpts: {
    compact: false,
  },
};
