'use strict';

module.exports = {
  singleQuote: true,
  overrides: [
    {
      files: '*.gts',
      plugins: ['prettier-plugin-ember-template-tag'],
      options: {
        parser: 'ember-template-tag',
      },
    },
    {
      files: ['*.yaml', '*.yml'],
      options: {
        singleQuote: false
      },
    }
  ],
};
