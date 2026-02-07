module.exports = {
  // Export rules
  rules: {
    'template-missing-invokable': require('./lib/rules/template-missing-invokable'),
    'missing-card-api-import': require('./lib/rules/missing-card-api-import'),
    'no-duplicate-imports': require('./lib/rules/no-duplicate-imports'),
    'no-percy-direct-import': require('./lib/rules/no-percy-direct-import'),
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
