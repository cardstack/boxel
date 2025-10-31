const mockWindowOnly = require('./mock-window-only');
const wrappedSetupHelpersOnly = require('./wrapped-setup-helpers-only');
const hostCommandsRegistered = require('./host-commands-registered');

module.exports = {
  rules: {
    'mock-window-only': mockWindowOnly,
    'wrapped-setup-helpers-only': wrappedSetupHelpersOnly,
    'host-commands-registered': hostCommandsRegistered,
  },
};
