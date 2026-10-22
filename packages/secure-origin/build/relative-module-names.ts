// The template compiler names each component's template by its file's
// absolute path, which would put the path the package was built from into
// the pages the origin serves, and make the build, and so the build record,
// differ from one checkout to the next. This names it from the package root
// instead, as the build record names modules.
import type { Plugin } from 'vite';

import { PACKAGE_ROOT } from './module-package.ts';

export function relativeModuleNames(): Plugin {
  let prefix = `${PACKAGE_ROOT}/`;
  return {
    name: 'secure-origin-relative-module-names',
    enforce: 'post',
    // Only the package's own source modules, where templates are compiled.
    // An entry document's generated modules import each other by absolute
    // path, which has to stay as it is.
    transform(code, id) {
      if (!id.startsWith(`${prefix}src/`) || !code.includes(prefix)) {
        return null;
      }
      return { code: code.replaceAll(prefix, ''), map: null };
    },
  };
}
