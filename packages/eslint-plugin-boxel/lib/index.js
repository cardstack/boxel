'use strict';

const requireIndex = require('requireindex');
const noop = require('ember-eslint-parser/noop');
const pkg = require('../package.json');  

module.exports = {
  meta: {
    name: pkg.name,
    version: pkg.version,
  },
  rules: requireIndex(`${__dirname}/rules`),
  configs: requireIndex(`${__dirname}/config`),
  utils: {},
  processors: {
    // https://eslint.org/docs/developer-guide/working-with-plugins#file-extension-named-processor
    noop,
  },
};
