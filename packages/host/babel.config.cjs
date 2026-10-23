const path = require('node:path');
const {
  babelCompatSupport,
  templateCompatSupport,
} = require('@embroider/compat/babel');
const { externalName } = require('@embroider/reverse-exports');
const {
  exportIdentityPlugin,
} = require('@cardstack/runtime-common/export-identity-plugin');
const {
  CLASS_FACTORIES,
} = require('@cardstack/runtime-common/class-factories');

const baseDir = path.resolve(__dirname, '..', 'base') + path.sep;
const basePackageJSON = require('../base/package.json');
const toolsDir = path.resolve(__dirname, 'app', 'tools') + path.sep;

// The name a base realm file is imported by, without its extension:
// `/abs/packages/base/date/day.gts` → `@cardstack/base/date/day`.
function baseModuleName(file) {
  let relative = path.relative(baseDir, file).split(path.sep).join('/');
  return externalName(basePackageJSON, `./${relative}`)?.replace(
    /\.(gts|ts)$/,
    '',
  );
}

// The modules tagged are the ones the loader serves by name, each tagged with
// the identifier the loader gives it; everything else in the host bundle is
// untagged.
function moduleIdentifier(filename) {
  let file = filename.split('?')[0];
  if (
    file.includes(`${path.sep}node_modules${path.sep}`) ||
    !/\.(gts|ts)$/.test(file)
  ) {
    return null;
  }
  // A base realm module compiled into the bundle, by the name it is imported
  // by.
  if (file.startsWith(baseDir)) {
    return baseModuleName(file) ?? null;
  }
  // A host tool, which app/tools/index.ts shims under its bare file name
  // wherever in app/tools the file sits:
  // `/abs/packages/host/app/tools/bot-requests/send-bot-trigger-event.ts` →
  // `@cardstack/boxel-host/tools/send-bot-trigger-event`. The pre-rename
  // `@cardstack/boxel-host/commands/` spelling shims the same module.
  if (file.startsWith(toolsDir)) {
    let name = path.basename(file).replace(/\.(gts|ts)$/, '');
    return name === 'index' ? null : `@cardstack/boxel-host/tools/${name}`;
  }
  return null;
}

// A base module imports its siblings relatively (`./enum`), and the class
// factories it calls are named by the module's package name, so a relative
// import inside base is named the same way.
function importedModule(specifier, { filename }) {
  if (!filename || !/^\.\.?\//.test(specifier)) {
    return undefined;
  }
  let file = path.resolve(path.dirname(filename.split('?')[0]), specifier);
  return file.startsWith(baseDir) ? baseModuleName(file) : undefined;
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
    [
      exportIdentityPlugin,
      { moduleIdentifier, importedModule, classFactories: CLASS_FACTORIES },
    ],
  ],

  generatorOpts: {
    compact: false,
  },
};
