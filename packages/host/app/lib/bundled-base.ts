// Bundles the @cardstack/base realm's modules into the host build and
// registers them as loader shims, so importing a base module (whether as
// `@cardstack/base/card-api` or its resolved base-realm URL) resolves to
// the compiled-in module instead of a network fetch of realm-server-
// transpiled source. This trades two properties of the fetched path for
// speed:
//
// - Base modules become singletons shared by every loader generation.
//   A loader reset (test isolation, code-change flush) no longer
//   re-evaluates base module state; whatever module-level state card-api
//   and friends hold persists across resets.
// - The running base realm's *source* is no longer what executes in the
//   host: editing base code in a realm (or reindexing it) has no effect
//   until the host is rebuilt. This includes indexing — the prerender
//   renders with the host dist, so index output reflects the bundled base,
//   not the realm-served source.
//
// The eager glob in bundled-base-modules.js compiles every base module
// into the host's initial bundle through the same vite/embroider pipeline
// as host app code.

import type { VirtualNetwork } from '@cardstack/runtime-common';

import BASE_MODULES from './bundled-base-modules';

const GLOB_PREFIX = '../../../base/';

// Registers on the virtual network (not per loader) so that every loader
// sharing the network serves the bundled modules — including loaders
// constructed outside the loader service (test-realm adapters, in-browser
// indexing). Must run after the network's `@cardstack/base/` realm mapping
// is registered, since shim identifiers resolve at registration time.
//
// Known gap: only the RRI-resolved identifier form is registered. An
// import that names a base module by its canonical
// `https://cardstack.com/base/` URL misses the shim (resolveImport passes
// URL-form identifiers through unchanged; URL→URL mapping happens at the
// network's fetch boundary, which shim lookup precedes) and falls through
// to a network fetch that evaluates a second copy of the module.
// Registering the canonical form as a second shim entry is NOT the fix:
// loaders capture export identities under whichever identifier form they
// fetched, so dual registration makes a def's identified module URL
// depend on import order. The durable fix is normalizing the identifier
// through the network's URL mappings in the loader's module-fetch path so
// both forms converge on one module state.
export function shimBundledBase(virtualNetwork: VirtualNetwork) {
  for (let [path, module] of Object.entries(BASE_MODULES)) {
    let name = path.slice(GLOB_PREFIX.length).replace(/\.(gts|ts)$/, '');
    virtualNetwork.shimModule(`@cardstack/base/${name}`, module);
  }
}
