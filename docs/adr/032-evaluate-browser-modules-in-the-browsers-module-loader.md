---
status: proposed
date: 2026-11-12
scope:
  - packages/runtime-common/loader.ts
  - packages/runtime-common/loader-plugin.ts
  - packages/runtime-common/amd-transpile/**
  - packages/runtime-common/bundled-module-loader.ts
  - packages/runtime-common/package-shim-handler.ts
  - packages/runtime-common/virtual-network.ts
  - packages/runtime-common/scoped-css.ts
  - packages/runtime-common/transpile.ts
  - packages/runtime-common/realm.ts
  - packages/host/app/services/loader-service.ts
  - packages/host/app/services/network.ts
  - packages/host/app/services/store.ts
  - packages/host/app/services/card-service.ts
  - packages/host/app/lib/externals.ts
  - packages/host/app/lib/bundled-base.ts
  - packages/host/app/lib/prerender-util.ts
  - packages/host/app/tools/index.ts
  - packages/host/app/tools/evaluate-module.ts
  - packages/host/app/tools/instantiate-card.ts
  - packages/host/app/routes/module.ts
  - packages/host/app/routes/render.ts
  - packages/host/app/components/card-prerender.gts
  - packages/host/app/resources/file.ts
  - packages/host/lib/import-meta-loader-plugin.cjs
  - packages/host/vite.config.mjs
  - packages/base/**
  - packages/experiments-realm/poster-board/poster-board.test.gts
  - packages/host/tests/**
---

# 032. Evaluate every module a browser runs in the browser's module loader

The host page evaluates realm modules through Boxel's userspace Loader today.
In a browser, every ES module MUST instead be evaluated by the browser's own ES
module loader — a native `import()` or `<script type="module">` of the URL that
resolution produced — and the Loader MUST NOT evaluate modules there. Realm
modules therefore have to reach the page as plain ESM at importable URLs, which
retires the Loader's remaining extensions (ADR 010 §1.4) from the browser path.
Picking up an edited module stops being "throw away the Loader": the host
replaces that module's entry in the map, or evaluates the preview in a separate
browsing context with its own map, and the rest of the app's modules stay
evaluated.

## 1. Decision

### 1.1. The browser's loader evaluates modules in a browser

A module the host app runs in a browser MUST be evaluated by the browser's ES
module loader. The Loader MUST NOT evaluate a module in a browser: it MUST NOT
transpile a module for its own evaluation, `eval` it, or hold a module map for
it. This covers the host app page, the prerender page, and any preview
boundary.

The Loader MAY evaluate modules only where no browser module loader exists —
the realm server and the worker in Node. ADR 010 governs its semantics there.

New extensions to module evaluation MUST NOT be added to the Loader. A
capability a module needs belongs in the compile step (§1.2) or in a platform
API the module calls by name.

### 1.2. Modules reach the browser as importable URLs

The realm server's compile step stays: it turns a realm's source (`.gts`,
`.gjs`, `.hbs`, `.js`) into ECMAScript module source text and writes the
identity tags (ADR 010 §1.4.5). Compilation is not a loader extension.

A module a browser imports MUST be served at the URL resolution produced, with
`Content-Type: text/javascript`, and with a body the browser can evaluate as
written. The server MUST NOT wrap that body for a userspace loader, and MUST
NOT carry anything a module needs in a header.

A module's URL MUST change when its content changes, by a content hash or a
version segment. The browser's module map never re-fetches a URL it has already
evaluated, so a URL whose body can change can never be re-evaluated. A caller
MUST NOT force re-evaluation by cache-busting a URL one map already holds.

Specifiers a browser cannot resolve as written — extensionless relative paths,
bare specifiers such as `@cardstack/base/card-api`, npm packages — MUST be
resolved by an import map the host installs, whose entries are generated from
the realm's file listing (ADR 010 §1.2). Resolution MUST NOT fetch, probe for
files, or fold extensions.

A realm MUST answer a module request made from the app's origin: the module and
the app that imports it are served from different origins.

### 1.3. No loader-only extensions in the browser path

`import.meta.loader` MUST NOT exist. Card code's `fetch` and dynamic `import()`
MUST be the browser's. Whatever the Loader's `fetch` provided — authentication,
scoped-CSS handling, retries, caching — MUST come from the platform instead:
the browser's own credential and cache handling, or a platform API the module
calls by name.

Shimmed modules (ADR 010 §1.4.2) MUST NOT put a module into a browser's module
map. An npm package, a host module, or a bundled base module that realm code
imports MUST be reachable as a URL the import map names.

The Loader's observation APIs (ADR 010 §1.4.3) MUST NOT be how the platform
learns a module's dependencies in a browser. Dependency information MUST come
from the compile step, which reads the module's source text.

A module's identity MUST keep coming from the tags the compile step writes
(ADR 010 §1.4.5), never from which loader evaluated it.

### 1.4. Re-evaluating a module under edit

Editing a module MUST NOT discard a browser's module map or replace the Loader.
This ends ADR 010 §1.4.4 in the browser.

Re-evaluation MUST be scoped to the edited module and the modules that import
it. Editing one realm module MUST NOT re-evaluate the host app's own modules,
or a realm module that does not import it.

Re-evaluation MUST use one of two mechanisms: the dev server's module
invalidation (Vite's hot module replacement) for a module graph the dev server
serves, or a preview boundary — a separate browsing context, such as an iframe,
with its own module map that imports the edited module fresh. A preview
boundary MUST be a real JavaScript realm boundary; a Loader discard MUST NOT
stand in for one.

A module MUST have one instance per module map. Re-evaluating an edited module
MUST replace that map's entry, or happen in a different map. It MUST NOT add a
second instance of the same module to one map.

Reloading the page MUST NOT be how a code edit is picked up while someone is
editing.

## 2. Rationale

The host app's own modules already run this way: Vite builds them and the
browser evaluates them. This ADR extends that to the realm modules the page
loads today through the Loader.

Card authors, agents, bundlers, Node, and the browser all share one module
system. Every place Boxel's Loader differs from it is a fault that appears only
in Boxel (ADR 010 §2). Parity work on a userspace loader never ends: each new
ESM feature has to be re-implemented, and each re-implementation is a place
where a card behaves differently when the indexer runs it than when the browser
does. The browser's loader is already finished, and the platform does not have
to maintain it.

The Loader's exceptions and the Loader's discard are one problem. Shims,
`import.meta.loader`, extension folding, and the module-map bookkeeping exist to
make a module graph that is thrown away and rebuilt behave like a stable one.
The rebuild is what forces every module to be re-obtained through the Loader,
and so what forces every way of obtaining one to go through the Loader.
Remove the rebuild and most of the exceptions have no job left.

The rebuild is also the most expensive part of editing a card. One save drops
every module the page has loaded — hundreds of modules re-fetched, re-compiled,
and re-evaluated — rebuilds card instances, and flashes the UI, for one changed
file. Scoping re-evaluation to the edited module's dependents is the difference
between an editor that keeps up with typing and one that does not.

Finally, the Loader cannot isolate what it evaluates: it runs realm code with
the host's globals in the host's realm (ADR 010 §1.6). A preview boundary in a
separate browsing context is the first real boundary Boxel has for code the
platform does not trust.

## 3. Considered options

- **The browser's module loader for every module a browser runs (chosen).**
- **Bring the userspace Loader to full ESM parity and keep it.** ADR 010 is this
  road. An AMD emulation cannot reach parity — top-level await, import
  attributes, live bindings and namespace sealing under cycles all resist it —
  and parity must be re-earned for each new ESM feature while the browser's
  loader already ships it. It also leaves two module systems that card authors
  have to reason about separately.
- **Keep the Loader and add hot module replacement to it.** Hot module
  replacement works because the platform invalidates the map the code actually
  runs in. A userspace map needs its own invalidation protocol, its own
  registry, and its own identity rules, which is the Loader again.
- **Discard and rebuild the Loader on each edit (what happens today).** It
  re-evaluates the whole app for one file, and it is why the Loader's
  exceptions exist.
- **Reload the page on edit.** Slower than the module graph it replaces, and it
  destroys the editing session — open buffers, unsaved drafts, scroll position.
- **Import the edited module under a cache-busting query.** The browser hands
  back a second instance of that module and of everything it imports, so a card
  class stops matching the class the app holds and its identity tags disagree.
- **Compile card code into the app build.** A realm is chosen at runtime, and
  its files are not known to the build.
- **A preview iframe alone, with no invalidation of the live graph.** An iframe
  cannot hold the app's live card instances, so the app's own renders would
  still need the rebuild.
- **Node's module customization hooks (`module.register`) in place of the Loader
  in the realm server.** Not decided here. It is the likely shape of the Node
  half, and a later ADR should record it.

## 4. Remediation

Known gaps are listed in [remediation/032.md](remediation/032.md).
