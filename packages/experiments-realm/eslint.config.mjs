// Realm source that ESLint checks only for base-realm import specifiers.
import { defineConfig } from 'eslint/config';

import { baseImportsOnlyConfig } from '../../eslint/shared.mjs';

export default defineConfig(
  baseImportsOnlyConfig({
    // Format fixtures, served byte-for-byte as sample file content rather
    // than loaded as modules.
    ignores: ['filedef-fixtures/samples/'],
  }),
);
