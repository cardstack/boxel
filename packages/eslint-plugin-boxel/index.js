module.exports = {
  // Export rules
  rules: {
    'template-missing-invokable': require('./lib/rules/template-missing-invokable'),
    'missing-card-api-import': require('./lib/rules/missing-card-api-import'),
    // Add other rules here
  },

  // Export configurations
  configs: {
    base: require('./lib/config/base'),
    recommended: require('./lib/config/recommended'),
  },

  // Add processors if needed
  processors: {
    // Define processors here if needed
    'ember/noop': {
      preprocess: (text) => [text],
      postprocess: (messages) => messages.flat(),
    },
  },
};
