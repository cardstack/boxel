'use strict';

module.exports = {
  singleQuote: true,
  plugins: ['prettier-plugin-ember-template-tag'],
  overrides: [
    {
      files: ['*.yaml', '*.yml'],
      options: {
        singleQuote: false
      },
    }
  ],
};
