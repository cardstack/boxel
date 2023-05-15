'use strict';

module.exports = {
  extends: 'recommended',
  overrides: [
    {
      files: '*.{js,ts}',
      options: {
        singleQuote: true,
      },
    },
  ],
};
