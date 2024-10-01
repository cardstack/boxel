'use strict';

module.exports = {
  overrides: [
    {
      files: ['./.eslintrc.js', 'esbuild.js'],
      parserOptions: {
        sourceType: 'script',
      },
      env: {
        browser: false,
        node: true,
      },
    },
  ],
};
