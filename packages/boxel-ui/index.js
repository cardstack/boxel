'use strict';
const { installScopedCSS } = require('glimmer-scoped-css');

module.exports = {
  name: require('./package').name,
  options: {
    'ember-cli-babel': {
      enableTypeScriptTransform: true,
    },
  },
  isDevelopingAddon() {
    return true;
  },
};
