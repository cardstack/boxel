const mockWindowOnly = require('./mock-window-only');
const wrappedSetupHelpersOnly = require('./wrapped-setup-helpers-only');

module.exports = {
  rules: {
    'mock-window-only': mockWindowOnly,
    'wrapped-setup-helpers-only': wrappedSetupHelpersOnly,
  },
};
