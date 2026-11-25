// Realm source that ESLint checks only for base-realm import specifiers.
import { defineConfig } from 'eslint/config';

import { baseImportsOnlyConfig } from '../../eslint/shared.mjs';

export default defineConfig(baseImportsOnlyConfig());
