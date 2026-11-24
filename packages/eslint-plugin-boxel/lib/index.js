'use strict';

const requireIndex = require('requireindex');
const noop = require('ember-eslint-parser/noop');
const pkg = require('../package.json');

const plugin = {
  meta: {
    name: pkg.name,
    version: pkg.version,
  },
  rules: requireIndex(`${__dirname}/rules`),
  utils: {},
  processors: {
    // https://eslint.org/docs/developer-guide/working-with-plugins#file-extension-named-processor
    noop,
  },
};

// Flat configs. They name no parser: a consuming config sets the one its
// files need (`ember-eslint-parser` for `.gts` and `.gjs`).
plugin.configs = {
  base: {
    name: '@cardstack/boxel/base',
    plugins: { '@cardstack/boxel': plugin },
  },
  recommended: {
    name: '@cardstack/boxel/recommended',
    plugins: { '@cardstack/boxel': plugin },
    rules: require('./recommended-rules'),
  },
};

module.exports = plugin;
