'use strict';
const { installScopedCSS } = require('glimmer-scoped-css');

module.exports = {
  name: require('./package').name,
  isDevelopingAddon() {
    return true;
  },
  setupPreprocessorRegistry(type, registry) {
    if (type === 'self') {
      installScopedCSS(registry);
    }
  },
};
