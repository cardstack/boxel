'use strict';

module.exports = {
  overrides: [
    {
      files: ['./.eslintrc.js'],
      parserOptions: {
        sourceType: 'script',
      },
      env: {
        browser: false,
        node: true,
      },
      extends: ['plugin:n/recommended'],
      rules: {
        '@typescript-eslint/no-var-requires': 'off',
        '@typescript-eslint/consistent-type-imports': [
          'error',
          {
            disallowTypeAnnotations: false,
          },
        ],
        '@typescript-eslint/no-import-type-side-effects': 'error',
      },
    },
  ],
};
