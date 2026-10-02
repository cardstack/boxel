'use strict';

// matches cardstack/boxel's prettier configuration
module.exports = {
  singleQuote: true,
  overrides: [{ files: ['*.yaml', '*.yml'], options: { singleQuote: false } }],
};
