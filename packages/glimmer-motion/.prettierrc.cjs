'use strict';

// matches cardstack/boxel's prettier configuration
module.exports = {
  singleQuote: true,
  plugins: ['prettier-plugin-ember-template-tag'],
  overrides: [{ files: ['*.yaml', '*.yml'], options: { singleQuote: false } }],
};
