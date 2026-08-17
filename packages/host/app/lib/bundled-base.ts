// Bundles the @cardstack/base realm's modules into the host build and
// registers them as loader shims, so importing a base module (whether as
// `@cardstack/base/card-api` or its resolved base-realm URL) resolves to
// the compiled-in module instead of a network fetch of realm-server-
// transpiled source. This trades three properties of the fetched path for
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
// - An indexed instance's dependencies lose their transitive closure
//   through base. The loader records `consumedModules` while evaluating
//   fetched source; a shim carries no dependency chain, so a card's deps
//   stop at the base modules it names directly and the base-internal and
//   npm-package entries the fetched path records are absent. Three
//   `Integration | realm indexing` tests assert the full closure and fail
//   on that difference. Restoring it needs a *post-compile* dep map:
//   the fetched closure includes deps the gts/babel transforms inject
//   (`@ember/template-factory`, `@ember/component/template-only`,
//   ember-concurrency's async-arrow runtime), which a scan of base's own
//   import statements can't see. Whether the closure is worth restoring is
//   a separate question — a bundled base module can't change without a
//   host rebuild, so nothing in it can invalidate an index entry.
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
// Shim registration order doubles as identity-capture order (loaders
// replay the network's shim inventory dependency-first — see the loader's
// captureVirtualNetworkShimIdentities). The def classes that serialization
// identifies are declared in card-api (several modules re-export them:
// file-api, markdown, image-file-def) and cards-grid (re-exported by
// index), so those two register ahead of the alphabetical remainder.
const DECLARING_MODULES_FIRST = ['card-api', 'cards-grid'];

export function shimBundledBase(virtualNetwork: VirtualNetwork) {
  let entries = Object.entries(BASE_MODULES)
    .map(([path, module]) => ({
      name: path.slice(GLOB_PREFIX.length).replace(/\.(gts|ts)$/, ''),
      module,
    }))
    .sort((a, b) => {
      let ai = DECLARING_MODULES_FIRST.indexOf(a.name);
      let bi = DECLARING_MODULES_FIRST.indexOf(b.name);
      if (ai !== bi) {
        return (ai === -1 ? Infinity : ai) < (bi === -1 ? Infinity : bi)
          ? -1
          : 1;
      }
      return a.name < b.name ? -1 : 1;
    });
  for (let { name, module } of entries) {
    virtualNetwork.shimModule(`@cardstack/base/${name}`, module);
  }
}
