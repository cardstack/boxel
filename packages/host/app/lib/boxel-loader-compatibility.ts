import { currencyCodeSymbolMapping } from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common/loader';

/**
 * Installs compatibility modules required by deployed trusted Boxel code.
 *
 * Keep this independent of execution level: Direct, Capsule, and Sandbox
 * loaders must resolve the same trusted dependencies even though they expose
 * different authority to authored code.
 */
export function installBoxelLoaderCompatibilityModules(loader: Loader) {
  // Older deployed Base realms import this data-only package from esm.run.
  // Host-owning it keeps trusted Currency fields deterministic and avoids a
  // third-party network dependency during card deserialization and rendering.
  loader.shimModule('https://esm.run/currency-code-symbol-map', {
    currencyCodeSymbolMapping,
  });
}
