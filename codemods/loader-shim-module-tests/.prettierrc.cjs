'use strict';

module.exports = {
  overrides: [
    {
      files: '*.{cjs,cts,js,mjs,mts,ts}',
      options: {
        printWidth: 80,
        singleQuote: true,
      },
    },
  ],
};
