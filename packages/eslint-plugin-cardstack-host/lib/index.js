'use strict';

const requireIndex = require('requireindex');
const pkg = require('../package.json');

const plugin = {
  meta: {
    name: pkg.name,
    version: pkg.version,
  },
  rules: requireIndex(`${__dirname}/rules`),
};

plugin.configs = {
  recommended: {
    name: '@cardstack/host/recommended',
    plugins: { '@cardstack/host': plugin },
    rules: require('./recommended-rules'),
  },
};

module.exports = plugin;
