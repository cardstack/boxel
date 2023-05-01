'use strict';
// eslint-disable-next-line node/no-missing-require
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
