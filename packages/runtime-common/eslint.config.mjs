import { defineConfig, globalIgnores } from 'eslint/config';

import { boxel, rootConfig } from '../../eslint/shared.mjs';

export default defineConfig([
  globalIgnores(['scripts/bench-amd/fixtures/']),
  ...rootConfig('runtime-common'),
  {
    // Type-aware: `no-url-from-realm-identifier` needs a TypeScript program.
    files: ['**/*.ts'],
    ignores: ['**/*.d.ts'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { '@cardstack/boxel': boxel },
    rules: {
      '@cardstack/boxel/no-url-from-realm-identifier': 'error',
    },
  },
  {
    files: ['**/*.ts', 'etc/**/*.js'],
    rules: {
      '@cardstack/boxel/no-url-form-base-imports': 'error',
      '@cardstack/boxel/no-literal-realm-urls': 'error',
    },
  },
  {
    files: ['tests/**'],
    rules: {
      '@cardstack/boxel/no-literal-realm-urls': 'off',
    },
  },
]);
