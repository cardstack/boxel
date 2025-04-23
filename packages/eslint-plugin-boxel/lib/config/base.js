const plugin = require('../index');
// Don't directly require the parser here

// Export using traditional ESLint config format
module.exports = {
  // In traditional format, plugins is an array of strings
  plugins: ['@cardstack/boxel'],

  // Parser should be a string
  parser: 'ember-eslint-parser',

  // ParserOptions is at the top level
  parserOptions: {},

  // Rules remain the same
  rules: {},

  // Add overrides for specific file patterns if needed
  overrides: [
    {
      files: ['**/*.{gts,gjs}'],
      parser: 'ember-eslint-parser',
    },
  ],
};
