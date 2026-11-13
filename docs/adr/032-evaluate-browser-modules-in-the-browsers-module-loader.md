---
status: proposed
date: 2026-11-12
supersedes: 010
scope:
  - packages/runtime-common/loader.ts
  - packages/runtime-common/loader-epoch.ts
  - packages/runtime-common/loader-plugin.ts
  - packages/runtime-common/amd-transpile/**
  - packages/runtime-common/bundled-module-loader.ts
  - packages/runtime-common/package-shim-handler.ts
  - packages/runtime-common/virtual-network.ts
  - packages/runtime-common/scoped-css.ts
  - packages/runtime-common/transpile.ts
  - packages/runtime-common/export-identity-plugin.ts
  - packages/runtime-common/realm.ts
  - packages/runtime-common/index-runner.ts
  - packages/runtime-common/create-response.ts
  - packages/runtime-common/authorization-middleware.ts
  - packages/runtime-common/code-ref.ts
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
  - packages/host/app/tools/capture.ts
  - packages/host/app/lib/visual-capture.ts
  - packages/host/app/routes/module.ts
  - packages/host/app/routes/render.ts
  - packages/host/app/components/card-prerender.gts
  - packages/host/app/components/operator-mode/code-submode/**
  - packages/host/app/resources/file.ts
  - packages/host/public/auth-service-worker.js
  - packages/host/app/utils/auth-service-worker-registration.ts
  - packages/host/app/instance-initializers/register-auth-service-worker.ts
  - packages/host/lib/import-meta-loader-plugin.cjs
  - packages/host/vite.config.mjs
  - packages/base/**
  - packages/experiments-realm/**
  - packages/host/tests/**
  - packages/realm-server/tests/loader-dynamic-import-test.ts
  - packages/realm-server/tests/index-loader-reset-test.ts
  - packages/runtime-common/helpers/const.ts
---

# 032. Evaluate every module a browser runs in the browser's module loader

Boxel's userspace Loader evaluates realm modules in the host page and in the
prerender page. Every module a browser runs MUST instead be evaluated by the
browser's own ES module loader, and the Loader MUST be deleted. Each module has
exactly one URL. The app never re-evaluates a module: new code reaches it
through a full page load, and the app says when the code it renders is out of
date. The one exception is a preview jail, a module graph that exists only
while a live edit is previewed.

## 1. Decision

### 1.1. The browser's loader evaluates modules

A module a browser runs MUST be evaluated by the browser's ES module loader,
through a native `import()` or `<script type="module">`. This covers the host
app's page, the prerender page, and every preview jail (§1.5).

The Loader MUST NOT evaluate a module, in a browser or in Node. Its module map,
shim registry, module-graph observation APIs, and `fetch` and `resolveImport`
extension points go with it. New code MUST NOT construct a Loader. The Loader
MUST be deleted when its last caller is gone.

The realm server and the worker MUST NOT evaluate realm modules in Node. When
indexing needs a module evaluated, it asks the prerender browser to render it.

### 1.2. Each module has one URL

The browser keeps one instance per request URL. Two spellings of one module
give two instances and two sets of classes. So every module MUST have exactly
one canonical URL: its realm's canonical URL plus its file path, with the file
extension. Every import of a module MUST reach that URL, and the module MUST NOT
be served at any other URL.

- **Relative and URL specifiers.** The realm server's compile step turns a
  realm's source (`.gts`, `.gjs`, `.hbs`, `.js`) into ECMAScript module source
  text. It MUST rewrite each static import, and each dynamic `import()` of a
  string literal, that names a module of the same realm to that module's
  canonical URL. It resolves an extensionless specifier against the realm's
  files with a documented precedence, or refuses. It MUST NOT otherwise
  rewrite specifiers.
- **Bare specifiers and alias URLs.** An import map, installed once when the
  page loads, MUST map each bare specifier (`lodash`,
  `@cardstack/boxel-icons/plus`, `@cardstack/base/card-api`) and each alias
  URL prefix (such as `https://cardstack.com/base/`) to a canonical URL. A
  module that the host also imports, such as a bundled base module, MUST map
  to the same URL the host's own code imports it at. The app MUST NOT extend
  or change the map while the page lives. An unmapped bare specifier MUST fail
  to resolve.
- **Requests at other URLs.** A realm MUST NOT answer a module request at a
  non-canonical URL with module source. It MUST refuse it with an error that
  names the canonical URL. A redirect is not enough, because the browser keys
  the module by the URL it requested.
- **Code refs.** Code that imports the module a code ref names MUST resolve
  the ref to the canonical URL first, for example from the index.

A realm MUST answer module requests from the app's origin, including the CORS
preflight for an `Authorization` header (§1.3). A realm MUST NOT serve
CommonJS.

A realm MUST publish a revision token that changes when one of its modules is
written. `realm_generations.loader_epoch`
(`packages/runtime-common/loader-epoch.ts`) is that token today.

### 1.3. No loader-only extensions

`import.meta.loader` MUST NOT exist. Card code's `fetch` and dynamic
`import()` MUST be the browser's.

A module request that needs the realm's `Authorization` header MUST get it from
the auth service worker (`packages/host/public/auth-service-worker.js`). A
native `import()` cannot set a header. The page MUST NOT import a realm module
that needs authorization until the service worker controls the page. The
worker MUST inject the token for the session the page serves, never another
session's.

A scoped stylesheet import MUST be answered by a URL the realm serves, with a
JavaScript module that installs the stylesheet. The page's fetch layer MUST
NOT answer a module request. Shims MUST NOT put a module into a browser's
module map.

Dependency information MUST come from the compile step and the index. Code MUST
NOT read a module graph from the loader that evaluates it.

A module's identity MUST come only from the tags the compile step writes. A
realm is given its canonical name when it is mounted, and the compile step
writes that name into its tags. A definition that a module gets from a call
is tagged only when the module wraps the call in `markDefinition`, imported
from `@cardstack/base/mark-definition` by that exact specifier. The compiler
MUST refuse a `markDefinition` that it cannot tag.

### 1.4. The app never re-evaluates a module

The app MUST NOT re-evaluate a module or hold two revisions of one module. New
code reaches the app's own module graph only through a full page load, which
the dev server MAY trigger. The app MUST NOT adopt a change partially, with
some cards on new code and some on old.

A module the page has never imported is imported normally, at its canonical
URL. The browser can remember a failed import for the life of the page. So the
app MUST NOT import a module before the write that creates it succeeds, and
MUST treat a failed import as final for that page.

When a realm's revision token moves, the app MUST show that the cards it
renders from that realm run a superseded revision, and MUST offer the page
load. It MUST NOT reload the page without the user's action while they edit.

A browsing context that renders cards for a realm MUST render them from one
revision of that realm. A warm prerender tab MUST be retired or reloaded
before it serves another render after its realm's revision moves.

A test that writes a module and expects new code MUST write it at a URL the
page has not imported.

### 1.5. The preview jail

A live edit is previewed in a **preview jail**, a module graph that exists only
while the preview is open.

The browser's module loader MUST build the jail. A userspace module map MUST
NOT, because the preview would then run the edit by a different rule than
production. Jailed modules are imported at **preview URLs**, which name the
revision previewed and which the app's own graph never imports. The preview
compile step rewrites the jailed modules' specifiers to those URLs. A
separate browsing context MAY serve as the jail.

The jail MUST hold every module that the preview's root reaches and whose
revision differs from the one the page evaluated, together with each module on
an import path from the root to one of them. Every other module MUST be
imported at its canonical URL, so the preview and the app share its instance.

The jail MUST NOT change what the app holds. A module in the app's graph MUST NOT
import a preview URL. A card instance built from a jailed class MUST NOT enter
the app's store; the preview keeps its own. A jailed definition carries the
same identity tags as the definition it revises (§1.3).

When the preview closes, or its revision moves, the jail MUST stop being used,
and the app MUST NOT still refer to it.

The code editor's preview, and the tools that evaluate a module or create a
card from one, MUST use the jail, so that they run the revision they wrote.

## 2. Rationale

The host app's own modules already run this way: Vite builds them, and the
browser evaluates them. This ADR extends that to realm modules.

Card authors, agents, bundlers, Node, and the browser share one module system.
Each place where the Loader differs from it is a fault that appears only in
Boxel (ADR 010 §2). Parity with the browser is possible, but each ESM feature
must be built again and kept in step forever. The browser's loader is finished,
and no one here has to maintain it.

Most of the Loader's exceptions (shims, `import.meta.loader`, extension
folding, module-map bookkeeping) exist to make a graph that is discarded and
rebuilt behave like a stable one. Without the rebuild, they have no job.

Not re-evaluating keeps the rest cheap. When the app's graph is fixed for the
life of a page, one import map is enough, and a module URL needs no revision
in it. The cost is that a card can render with code that no longer exists.
§1.4 makes the app say so, and §1.5 makes the module being edited exact.

One URL per module was a rule of ADR 010 §1.2, which the Loader met by folding
spellings into one module. The browser does not fold, so the compile step and
the import map must produce one spelling. A realm that serves a module at a
second URL would make a second set of classes, so it refuses instead.

The Loader also cannot isolate what it evaluates (ADR 010 §1.6). The jail is a
real boundary.

## 3. Considered options

- **Never re-evaluate in the app, with a preview jail (chosen).**
- **Re-evaluate the edited module's importers in the live graph, with each
  URL naming its dependencies' URLs.** It rewrites every module's specifiers,
  needs a protocol to converge the live graph, and leaves the app with two
  revisions of one realm, all to avoid a page load.
- **Discard and rebuild the Loader on each edit (current).** It re-evaluates
  everything for one file, and it is why the Loader's exceptions exist.
- **Reload the page on every edit.** It loses open buffers, drafts and scroll
  position.
- **A userspace loader for the preview only.** The preview would run the edit
  by a different rule than production.
- **Leave specifiers as authored, and let the realm answer extensionless
  requests.** `./foo` and `./foo.gts` become two instances.
- **Extensionless entries in the import map, generated from realm listings.**
  The map is fixed for the life of the page, so a file created later has no
  entry.
- **Install or extend import maps while the page lives.** A later map cannot
  override an earlier mapping, so a renamed file cannot be remapped.
- **Keep the Loader and reach ESM parity (ADR 010), adopt SystemJS, or add
  hot module replacement to it.** Each keeps a second module system in the
  page, with its own registry and identity rules.

## 4. Consequences

- After an edit, live renders run the code the page loaded, while the index
  describes the new code. The app must show this, which it does not do today.
- The first render after a code edit pays a prerender tab launch.
  `passInvalidatesExecutables` decides whether a tab may be kept.
- Host tests share one `testRealmURL` (`packages/runtime-common/helpers/const.ts`)
  and rely on a Loader reset between tests. They need a URL per test.
- Card code that dynamically imports a computed extensionless specifier fails,
  and must name the canonical URL.

## 5. Remediation

Known gaps are listed in [remediation/032.md](remediation/032.md).
