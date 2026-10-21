---
status: proposed
date: 2026-10-21
scope:
  - packages/runtime-common/loader.ts
  - packages/runtime-common/loader-plugin.ts
  - packages/runtime-common/amd-transpile/**
  - packages/runtime-common/virtual-network.ts
  - packages/runtime-common/package-shim-handler.ts
  - packages/host/app/services/loader-service.ts
  - packages/host/app/services/network.ts
  - packages/host/app/lib/externals.ts
  - packages/host/app/tools/index.ts
  - packages/host/app/tools/capture.ts
  - packages/host/app/lib/visual-capture.ts
  - packages/runtime-common/code-ref.ts
  - packages/base/card-api.gts
---

# 010. Give the modules the Loader loads native ES module semantics

The Boxel `Loader` evaluates card code and other realm modules at runtime. A
module it loads MUST behave as it would under a native ES module loader, with
only the exceptions this ADR lists. The Loader's only inputs, and its two
extension points, are the `fetch` and the `resolveImport` it is constructed
with. `resolveImport` does only what an import map can, and everything about
obtaining source happens in `fetch`. This ADR lists the exceptions we support, the ESM features still
missing, and the things the Loader will not do.

## 1. Decision

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD",
"SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in this
document are to be interpreted as described in BCP 14 (RFC 2119, RFC 8174) when,
and only when, they appear in all capitals, as shown here.

### 1.1. Native ESM semantics by default

A module the Loader evaluates MUST observe the semantics of ECMAScript source
text module records, as a browser runs them under the HTML module map. This
covers specifier resolution, one instance per module map key (the request
URL and module type, as the HTML module map defines them), evaluation order,
cycles, live bindings, the temporal dead zone, hoisted function exports,
module namespace objects, and error propagation. The ES-to-AMD transform in
`amd-transpile/` is an implementation detail. It MUST preserve these semantics.

Each departure from native ESM MUST be listed in §1.4. A change that adds a
departure MUST add it to §1.4 in the same PR.

### 1.2. `resolveImport` is an import map

Resolution MUST follow the HTML algorithm to resolve a module specifier.
`resolveImport` MUST take the specifier and the URL of the module that imports
it (the referrer). A specifier that starts with `/`, `./` or `../`, or that is
an absolute URL, MUST be parsed against the referrer's URL before any mapping
is matched. The mappings are then matched against the resulting URL. A bare
specifier is matched as written. Static imports, dynamic imports, and a shim's
declared dependencies (§1.4.2) MUST all go through this one algorithm. A call
to `Loader.import` from outside a module has no referrer. It MUST pass an
absolute URL or a bare specifier.

`resolveImport` MUST only do what an import map can: map exact specifiers and
URL prefixes to URLs, optionally scoped by the referrer's URL. It MUST NOT read
the network, probe for files, rewrite the remainder of a matched prefix, or
depend on any state other than its mappings. An unmapped bare specifier MUST
fail to resolve, as it does in a browser.

`resolveImport` MUST map every spelling of one module (a realm prefix, an
alias URL, the real URL) to the same URL. That is what gives one module one
instance and one set of classes. ADR 002 governs the form identifiers take
when they leave the Loader.

An extensionless specifier MAY be mapped to a file URL with an exact entry.
For example, an entry from `https://example.test/realm/foo` to
`https://example.test/realm/foo.gts` makes `./foo` and `./foo.gts`, imported
from that realm, resolve to one URL and share one instance. An implementation
MAY generate those entries ahead of time from a realm's file listing. It MUST
NOT discover them by fetching during resolution. When more than one file could
match, the generator MUST apply a documented precedence or refuse the
ambiguity. The Loader takes no part in that choice.

The Loader MUST key modules only by the URL that resolution returns and the
module type (§1.1). It MUST NOT fold extensions, or any other spelling, into
one module. Distinct resolved URLs stay distinct modules, even when fetching
one redirects to the other.

### 1.3. `fetch` obtains source

Everything about obtaining a module's source MUST happen in the `fetch`
implementation the Loader is constructed with. That includes retries,
authentication, redirects, serving shims at a URL, and rewriting error
responses. The Loader MUST NOT retry a fetch, and it MUST treat a non-2xx
response as a failure to fetch that URL.

A failure to fetch a URL MUST fail every later import of that URL in the same
Loader, as an evaluation error does.

### 1.4. Supported exceptions

This is the closed list of ways the Loader departs from native ESM.

1. **`import.meta.loader`.** The Loader injects itself into each module's
   `import.meta`. `loaderPlugin` rewrites bare `fetch()` and dynamic
   `import()` in card code to go through it. A dynamic `import()` MUST still
   resolve with the importing module as its referrer (§1.2), whatever
   expression its specifier is.
2. **Shimmed responses.** The `fetch` implementation MAY answer a module URL
   with a pre-evaluated module. It does so by setting a property keyed by
   `Symbol.for('shimmed-module')` on the `Response` it resolves with. When that
   property is defined, the Loader MUST use its value as the module's namespace
   and MUST NOT read the body. A property keyed by
   `Symbol.for('shimmed-module-deps')` MAY list the specifiers the shim
   imports. The Loader resolves them against the module's URL, records them as
   its dependencies, and does not load them. These two properties are the only
   way to provide a shim. The Loader MUST NOT offer another way to put a module
   into its module map.
3. **Observation APIs.** `identify`, `getConsumedModules`,
   `getKnownConsumedModules`, runtime dependency tracking, and evaluation
   timing read the module graph. They MUST NOT change what any module
   observes, and they MUST NOT load or evaluate a module. A caller that needs
   a module's whole graph imports the module first. They report each module by the URL `resolveImport` gave it. A
   caller that needs the RRI form (ADR 002) converts the URL itself. We intend
   to phase out `identify`. New code SHOULD NOT add callers of it.
4. **Discarding modules.** The host MAY replace a Loader to pick up changed
   modules. The host MAY also tell a Loader to clear its module map, for
   example when a realm mapping changes. No other path removes a module from a
   Loader.

### 1.5. ESM features the Loader must gain

Top-level `await`, import attributes (including JSON and CSS modules), and
`import.meta.resolve` are part of §1.1 and are not supported yet. Until they
are, new code MUST NOT add a non-standard substitute for any of them.

### 1.6. Out of scope by design

The Loader MUST NOT support CommonJS (`require`, `module.exports`). A CommonJS
package reaches card code only as a shim (§1.4.2).

The Loader is not a security boundary. It evaluates modules in the host's
JavaScript realm, with the host's globals. Code MUST NOT rely on the Loader to
isolate or restrict the modules it evaluates.

### 1.7. `fetch` and `resolveImport` are the Loader's only inputs

The Loader MUST be constructed from a `fetch` and a `resolveImport`, and from
nothing else that changes how it loads modules. It MUST NOT hold or reach a
`VirtualNetwork`, realm mappings, a shim registry, or retry timing such as a
sleep function. Whatever those provide belongs inside the `fetch` or
`resolveImport` the host builds from them. The Loader MUST NOT expose a way
for a module to reach them through it.

## 2. Rationale

Card code is ordinary JavaScript written by people and agents who expect ESM
to behave as it does everywhere else. Each place where the Loader differs is a
bug that appears only in Boxel, is hard to diagnose, and makes card code less
portable to bundlers, Node, and the browser's own loader. A closed list makes
each departure a decision someone made on purpose, rather than one that grew
inside the Loader.

Both extension points mirror a standard the browser already defines: import
maps for resolution, and `fetch` for transport. A loader that stays within
them can be replaced by the browser's loader. It also keeps policy
(retries, auth, which host serves a module) where the host can change it
without touching module semantics.

The exceptions in §1.4 exist because Boxel needs them today. §1.4.4 is the
largest. We expect to replace it with cooperative hot module replacement in
the style of Vite, where modules take part in their own update, or by running
the volatile parts of the application in an iframe with its own loader.

## 3. Considered options

- **Native ESM semantics with a closed list of exceptions (chosen).**
- **Match ESM as a SHOULD.** Each departure would need only a reason in its
  PR. That is how the current departures accumulated.
- **Fold extensions implicitly inside the Loader.** The Loader would merge
  `./foo`, `./foo.gts` and `./foo.ts` into one module, which no browser does:
  they are distinct URLs, and a redirect between them still gives two
  modules. It also stops a failed fetch from being cached, because one
  spelling's 404 would then fail its siblings. Explicit import-map entries for
  extensionless specifiers (§1.2) give the same sharing without either cost.
- **A Loader method that registers shims (`shimModule`).** It is a second way
  into the module map that bypasses both `resolveImport` and `fetch`, and it
  makes shims a Loader feature instead of a `fetch` detail. A shimmed response
  keeps the exception to the one place the Loader reads a response.
- **Probe for extensions while resolving.** An import map cannot do this, and
  it would put network access into resolution.
- **Let the Loader fold alias and prefix spellings itself.** This hides from
  the import map which URL a module really has, so two resolvers can disagree
  about whether two spellings are one module.
- **Cache only evaluation errors, and let a failed fetch retry on the next
  import.** This differs from ESM. A transient failure is the `fetch`
  implementation's to retry (§1.3), and a Loader replacement starts clean.

## 4. Remediation

- `packages/runtime-common/loader.ts` (`fetchModule`, dependency resolution)
  breaks §1.2: it calls `resolveImport` on the raw specifier and only then
  parses the result against the importing module. An exact entry for a
  module's URL then misses relative static imports of it.
- `packages/runtime-common/loader.ts` (the `resolveImport` constructor
  parameter) and `packages/runtime-common/virtual-network.ts`
  (`resolveImport`) break §1.2: the resolver takes no referrer, so it cannot
  support mappings scoped by referrer.
- `packages/runtime-common/loader-plugin.ts` (`createLoaderImportCall`) breaks
  §1.4.1: only a literal relative specifier is resolved against
  `import.meta.url`. `import(path)` with a variable loses its referrer.
- `packages/runtime-common/loader.ts` (`getConsumedModules`) breaks §1.4.3: it
  imports a module that is not loaded yet, which evaluates it.
- `packages/runtime-common/loader.ts` (the `virtualNetwork` and `retrySleep`
  constructor options) breaks §1.7.
- `packages/runtime-common/loader.ts` (the `onMappingChange` subscription)
  breaks §1.7: the Loader listens for realm-mapping changes itself.
- `packages/runtime-common/loader.ts` (`canonicalIdentifier`, `trackingKey`,
  `getConsumedModules`) breaks §1.7: the observation APIs convert URLs to RRIs
  through the `VirtualNetwork`.
- `packages/runtime-common/loader.ts` (`getVirtualNetwork`) breaks §1.7.
- `packages/runtime-common/code-ref.ts`, `packages/base/card-api.gts`,
  `packages/host/app/tools/capture.ts` and
  `packages/host/app/lib/visual-capture.ts` break §1.7: they reach the
  `VirtualNetwork` through `getVirtualNetwork`.
- `packages/runtime-common/loader.ts` (`load`, `fetchWithTransientRetry`)
  breaks §1.3: the Loader retries 502/503/504 responses itself.
- `packages/runtime-common/loader.ts` (`load`, the missing-icon error rewrite)
  breaks §1.3.
- `packages/runtime-common/loader.ts` (`_fetch`, the virtual-network shim
  lookup) breaks §1.3.
- `packages/runtime-common/loader.ts` (`shimModule`, `moduleShims`,
  `cloneLoader`) breaks §1.4.2: modules can be put into the module map without
  a fetch.
- `packages/host/app/lib/externals.ts` and `packages/host/app/tools/index.ts`
  break §1.4.2: they register shims with `shimModule`.
- `packages/runtime-common/loader.ts` (`fetchModule`) breaks §1.3: a failed
  fetch deletes the module entry, so the next import fetches again.
- `packages/runtime-common/loader.ts` (`moduleCacheKey`) breaks §1.2: the
  Loader folds alias and prefix spellings through `unresolveURL`.
- `packages/runtime-common/loader.ts` (`trimModuleIdentifier`) breaks §1.2:
  the Loader folds extensionless and extension spellings into one module.
- `packages/runtime-common/package-shim-handler.ts` (`trimModuleIdentifier`)
  breaks §1.2: shims are registered and looked up under extension-folded keys.
- `packages/runtime-common/virtual-network.ts` (`resolveImport`) breaks §1.2:
  it has no entries for extensionless specifiers, which the Loader's folding
  and the realm server answer instead.
- `packages/runtime-common/loader.ts` (`readOnlyProxy`) breaks §1.1: the
  namespace object traps only `set`. It is extensible and allows
  `defineProperty` and `delete`, and it has no `Symbol.toStringTag`.
- `packages/runtime-common/loader.ts` (`evaluate`, the `__import_meta__`
  object) breaks §1.5: it has no `resolve`.
- `packages/runtime-common/amd-transpile/index.ts` (`transpileAmd`) breaks
  §1.1: exports are installed at the end of the module body. During a cycle,
  an importer that reads a hoisted function export gets `undefined`, and one
  that reads an uninitialized `let`, `const`, or `class` export gets
  `undefined` instead of a `ReferenceError`.
- `packages/runtime-common/amd-transpile/index.ts` (`transpileAmd`) breaks
  §1.1: the namespace object carries an `__esModule` property, and
  `export * from` copies the dependency's keys once, at evaluation.
- `packages/runtime-common/amd-transpile/index.ts` (`transpileAmd`) breaks
  §1.5: top-level `await` is rejected.
- `packages/runtime-common/amd-transpile/index.ts` (`transpileAmd`) breaks
  §1.5: import attributes are not supported.
- `packages/runtime-common/virtual-network.ts` (`resolveImport`) breaks §1.2:
  an unmapped bare specifier resolves to the fake packages origin instead of
  failing.
- `packages/host/app/services/network.ts` (the `@cardstack/boxel-icons/`
  import-map handler) breaks §1.2: it appends `.js` to the remainder of the
  matched prefix.
