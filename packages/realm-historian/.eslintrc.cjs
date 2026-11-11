'use strict';

module.exports = {
  overrides: [
    {
      files: ['./.eslintrc.cjs'],
      parserOptions: {
        sourceType: 'script',
      },
      env: {
        browser: false,
        node: true,
      },
    },
    {
      files: ['tests/**/*-test.{js,ts}'],
      extends: ['plugin:qunit/recommended'],
      rules: {
        'qunit/require-expect': 'off',
        'qunit/no-conditional-assertions': 'off',
      },
    },
  ],
};
