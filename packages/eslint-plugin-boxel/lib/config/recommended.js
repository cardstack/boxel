const baseConfig = require('./base');

module.exports = {
  // Extend the base config
  ...baseConfig,

  // Add recommended rule configurations
  rules: {
    ...baseConfig.rules,
    ...require('../recommended-rules'),
  },
};
