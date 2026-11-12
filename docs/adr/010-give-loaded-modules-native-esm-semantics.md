---
status: proposed
date: 2026-10-21
scope:
  - packages/runtime-common/loader.ts
  - packages/runtime-common/loader-plugin.ts
  - packages/runtime-common/cached-fetch.ts
  - packages/runtime-common/amd-transpile/**
  - packages/runtime-common/virtual-network.ts
  - packages/runtime-common/package-shim-handler.ts
  - packages/runtime-common/code-ref.ts
  - packages/runtime-common/index.ts
  - packages/runtime-common/export-identity-plugin.ts
  - packages/runtime-common/transpile.ts
  - packages/runtime-common/realm.ts
  - packages/realm-server/main.ts
  - packages/base/mark-definition.ts
  - packages/host/babel.config.cjs
  - packages/host/lib/import-meta-loader-plugin.cjs
  - packages/runtime-common/bundled-module-loader.ts
  - packages/host/app/services/loader-service.ts
  - packages/host/app/services/network.ts
  - packages/host/app/services/operations.ts
  - packages/host/app/lib/externals.ts
  - packages/host/app/lib/visual-capture.ts
  - packages/host/app/tools/index.ts
  - packages/host/app/tools/capture.ts
  - packages/host/app/tools/patch-fields.ts
  - packages/base/card-api.gts
  - packages/experiments-realm/poster-board/poster-board.test.gts
  - packages/host/tests/live-test.js
  - packages/host/tests/helpers/adapter.ts
  - packages/host/tests/acceptance/prerender-module-test.gts
  - packages/host/tests/integration/components/card-basics-test.gts
  - packages/host/tests/integration/components/get-relationship-membership-state-test.gts
  - packages/host/tests/integration/components/linksto-many-per-slot-access-test.gts
  - packages/host/tests/integration/components/markdown-preview-test.gts
  - packages/host/tests/integration/components/prerender-serialize-cycle-test.gts
  - packages/host/tests/integration/components/preview-test.gts
  - packages/host/tests/unit/garbage-collection-test.ts
  - packages/host/tests/unit/index-query-engine-test.ts
  - packages/host/tests/unit/instance-filter-matcher-test.ts
  - packages/host/tests/unit/loader-test.ts
  - packages/host/tests/unit/operation-lowering-test.ts
  - packages/host/tests/unit/searchable-option-test.ts
---

# 010. Give the modules the Loader loads native ES module semantics

The Boxel `Loader` evaluates card code and other realm modules at runtime. A
module it loads MUST behave as it would under a native ES module loader, with
only the exceptions this ADR lists. The Loader's only inputs, and its two
extension points, are the `fetch` and the `resolveImport` it is constructed
with. `resolveImport` does only what an import map can, and everything about
obtaining source happens in `fetch`. [ADR 032](032-evaluate-browser-modules-in-the-browsers-module-loader.md)
removes the Loader from the browser's module path; where it still evaluates
modules, this ADR governs it.

## 1. Decision

### 1.1. Native ESM semantics by default

A module the Loader evaluates MUST observe the semantics of ECMAScript source
text module records, as a browser runs them under the HTML module map. This
covers specifier resolution, one instance per module map key (the request
URL and module type, as the HTML module map defines them), evaluation order,
cycles, live bindings, the temporal dead zone, hoisted function exports,
module namespace objects, and error propagation. The ES-to-AMD transform in
`amd-transpile/` MUST preserve these semantics.

Each departure from native ESM MUST be listed in §1.4, in the PR that adds it.

### 1.2. `resolveImport` is an import map

Resolution MUST follow the HTML algorithm to resolve a module specifier.
`resolveImport` MUST take the specifier and the referrer's URL. A specifier
that starts with `/`, `./` or `../`, or that is an absolute URL, MUST be parsed
against the referrer's URL before any mapping is matched. A bare specifier is
matched as written. Static imports, dynamic imports, and a shim's declared
dependencies (§1.4.2) MUST all go through this one algorithm. A call to
`Loader.import` from outside a module has no referrer, and MUST pass an
absolute URL or a bare specifier.

A module's referrer URL MUST be the URL of the response `fetch` returned for
it, as HTML uses the response URL as a module script's base URL. The same URL
MUST be its `import.meta.url`. The Loader MUST NOT take it from anywhere else,
such as a response header.

`resolveImport` MUST only do what an import map can: map exact specifiers and
URL prefixes to URLs, optionally scoped by the referrer's URL, with the
longest matching prefix winning and no remainder escaping its target. It MUST
NOT read the network, probe for files, rewrite the remainder of a matched
prefix, or depend on any state other than its mappings. An unmapped bare
specifier MUST fail to resolve.

`resolveImport` MUST map every spelling of one module (a realm prefix, an
alias URL, the real URL) to the same URL, so that one module has one instance
and one set of classes. ADR 002 governs the form identifiers take when they
leave the Loader.

An extensionless specifier MAY be mapped to a file URL with an exact entry,
for example `https://example.test/realm/foo` to
`https://example.test/realm/foo.gts`. Such entries MAY be generated from a
realm's file listing, and MUST NOT be discovered by fetching during
resolution. When more than one file could match, the generator MUST apply a
documented precedence or refuse.

The Loader MUST key modules only by the URL that resolution returns and the
module type. It MUST NOT fold extensions, or any other spelling, into one
module, even when fetching one URL redirects to another.

### 1.3. `fetch` obtains source

Everything about obtaining a module's source MUST happen in the `fetch`
implementation the Loader is constructed with: retries, caching,
authentication, redirects, serving shims, and rewriting error responses. The
Loader MUST NOT retry a fetch, and it MUST treat a non-2xx response or a
rejected `fetch` as a failure to fetch that URL. Such a failure MUST fail every
later import of that URL in the same Loader, as an evaluation error does.

The Loader MUST NOT hold or reach a `VirtualNetwork`, realm mappings, a shim
registry, or retry timing. Whatever those provide belongs inside the `fetch` or
`resolveImport` the host builds from them, and no module can reach them
through the Loader.

### 1.4. Supported exceptions

This is the closed list of ways the Loader departs from native ESM.

1. **`import.meta.loader`.** The Loader injects itself into each module's
   `import.meta`. `loaderPlugin` rewrites bare `fetch()` and dynamic
   `import()` in card code to go through it. A dynamic `import()` MUST still
   resolve with the importing module as its referrer (§1.2), whatever
   expression its specifier is.
2. **Shimmed responses.** `fetch` MAY answer a module URL with a pre-evaluated
   module, by setting a property keyed by `Symbol.for('shimmed-module')` on
   the `Response`. The Loader MUST then use that value as the module's
   namespace and MUST NOT read the body. A property keyed by
   `Symbol.for('shimmed-module-deps')` MAY list the specifiers the shim
   imports. The Loader resolves them through `resolveImport` (§1.2), with the
   shim's URL as referrer, and records them as dependencies without loading
   them. These properties are the only way into the module map. A bundled
   module that a shim serves is evaluated by the platform, not a Loader, so
   the host's build compiles its `import.meta.loader` (§1.4.1) to a global
   that holds the host's current Loader
   (`packages/runtime-common/bundled-module-loader.ts`).
3. **Observation APIs.** The module-map queries
   (`isModuleLoaded`, `moduleKey`, `loadedModuleKeys`, `canonicalURLFor`),
   `getConsumedModules`, `getKnownConsumedModules`, runtime dependency
   tracking, and evaluation timing read the module graph. They MUST NOT change
   what any module observes, and MUST NOT load or evaluate a module. They
   report each module by the URL `resolveImport` gave it. A caller that needs
   the RRI form (ADR 002) converts the URL itself. A Loader MUST NOT record
   which Loader a value came from: code that needs a Loader reads
   `import.meta.loader`.
4. **Discarding modules.** The host MAY replace a Loader to pick up changed
   modules, or tell a Loader to clear its module map, for example when a realm
   mapping changes. No other path removes a module from a Loader.
5. **Identity tags.** A class a module exports carries a static member keyed
   by `Symbol.for('cardstack-ident')`, whose value is the module's canonical identifier
   (ADR 002) and the name the class is exported under. The compiler that
   produces the module writes it, in
   `packages/runtime-common/export-identity-plugin.ts`:
   - A realm MUST be given its canonical name when it is mounted: its
     registered prefix, or its own URL when it has none. It compiles that
     name into its modules' tags, so a tag never depends on the URL a client
     reaches the realm by, and no reader converts it.
   - A definition a module gets from a call, rather than a class it writes,
     is tagged only when the module wraps the call in `markDefinition`,
     imported from `@cardstack/base/mark-definition` by that exact
     specifier. The compiler MUST NOT recognize such definitions any other
     way, and MUST refuse a `markDefinition` it cannot tag.
   - The Loader MUST NOT write, read or rewrite identity tags. `identify` in
     `code-ref.ts` reads them.

### 1.5. ESM features the Loader must gain

Top-level `await` and import attributes (including JSON and CSS modules) are
part of §1.1 and are not supported yet. Until they are, new code MUST NOT add a
non-standard substitute for either of them.

### 1.6. Out of scope by design

The Loader MUST NOT support CommonJS. A CommonJS package reaches card code only
as a shim (§1.4.2).

The Loader is not a security boundary: it evaluates modules in the host's
JavaScript realm, with the host's globals. Code MUST NOT rely on it to isolate
or restrict the modules it evaluates.

## 2. Rationale

Card code is ordinary JavaScript written by people and agents who expect ESM
to behave as it does everywhere else. Each place where the Loader differs is a
bug that appears only in Boxel, and makes card code less portable to bundlers,
Node, and the browser's own loader. A closed list makes each departure a
decision rather than drift.

Both extension points mirror a browser standard: import maps for resolution,
and `fetch` for transport. A Loader that stays within them can be replaced by
the browser's, and keeps policy (retries, auth, which host serves a module)
where the host can change it without touching module semantics.

§1.4.4 is a stopgap. [ADR 032](032-evaluate-browser-modules-in-the-browsers-module-loader.md)
records what replaces it: in a browser the browser's own module loader
evaluates modules, and re-evaluation is scoped to the edited module's
dependents.

## 3. Considered options

- **Native ESM semantics with a closed list of exceptions (chosen).**
- **Match ESM as a SHOULD.** That is how the current departures accumulated.
- **Fold extensions implicitly inside the Loader.** No browser does: `./foo`
  and `./foo.gts` are distinct URLs, even across a redirect. One spelling's
  404 would also fail its siblings. Exact import-map entries (§1.2) give the
  same sharing without either cost.
- **A Loader method that registers shims (`shimModule`).** It is a second way
  into the module map that bypasses `resolveImport` and `fetch`.
- **Probe for extensions while resolving.** An import map cannot, and it puts
  network access into resolution.
- **Let the Loader fold alias and prefix spellings itself.** It hides which URL
  a module really has, so two resolvers can disagree about whether two
  spellings are one module.
- **Let a failed fetch retry on the next import.** This differs from ESM.
  Retrying a transient failure is `fetch`'s job (§1.3).
- **Tag modules by URL and canonicalize the tag where it is read.** Every
  reader then needs a `VirtualNetwork` (§1.3 forbids the Loader one), and a
  class's identity varies with the reader's mappings. A realm's canonical name
  is constant, so it is compiled in (§1.4.5).
- **Recognize the results of a fixed list of class factories.** The list lives
  in the platform, so a realm's own factory needs a platform change, and the
  compiler has to resolve where each call's callee was imported from.
  `markDefinition` says so at the call (§1.4.5).

## 4. Remediation

Known gaps are listed in [remediation/010.md](remediation/010.md).
