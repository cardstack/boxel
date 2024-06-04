import { createOptions, addTestRealmHelperImport } from './steps/index.js';
import type { CodemodOptions } from './types/index.js';

export function runCodemod(codemodOptions: CodemodOptions): void {
  const options = createOptions(codemodOptions);
  addTestRealmHelperImport(options);
}
