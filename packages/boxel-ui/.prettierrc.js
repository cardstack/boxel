'use strict';

module.exports = {
  overrides: [
    {
      files: '*.gts',
      options: {
        parser: 'ember-template-tag',
      },
    },
  ],
  plugins: ['prettier-plugin-ember-template-tag'],
  singleQuote: true,
};
