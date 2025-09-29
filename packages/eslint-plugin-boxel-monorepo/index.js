const mockWindowOnly = require('./mock-window-only');
const wrappedSetupHelpersOnly = require('./wrapped-setup-helpers-only');
const noPauseTest = require('./no-pause-test');

module.exports = {
  rules: {
    'mock-window-only': mockWindowOnly,
    'wrapped-setup-helpers-only': wrappedSetupHelpersOnly,
    'no-pause-test': noPauseTest,
  },
};
