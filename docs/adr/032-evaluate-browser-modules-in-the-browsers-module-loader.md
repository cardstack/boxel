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
  - packages/runtime-common/helpers/const.ts
---

# 032. Evaluate every module a browser runs in the browser's module loader

Boxel's userspace Loader evaluates realm modules inside the host page, and the
host page is the only place a Loader is constructed. Every module a browser runs
MUST instead be evaluated by the browser's own ES module loader, and the Loader
MUST NOT evaluate modules anywhere. The app MUST NOT re-evaluate a module: new
code reaches the app only through a full page load, and the app says so when the
code it is rendering has moved on. The one exception is a preview jail — a
module graph that exists only for a live edit, only while that edit is being
previewed, and only for the modules the preview actually needs.

## 1. Decision

### 1.1. The browser's loader evaluates modules; the Loader goes away

A module a browser runs MUST be evaluated by the browser's ES module loader: a
native `import()` or `<script type="module">` of a URL. This covers the host
app's page, the prerender page, and any preview jail.

The Loader MUST NOT evaluate a module, in a browser or in Node: it MUST NOT
transpile a module for its own evaluation, `eval` it, or hold a module map. Its
shim registry, its module-graph observation APIs, and its `fetch` and
`resolveImport` extension points go with it. No new code MAY construct a Loader,
and the Loader MUST be deleted once its last caller is gone.

The realm server and the worker MUST NOT evaluate realm modules in Node. Where
indexing needs a module evaluated, it asks the prerender browser to render it,
as it does today through `lookupDefinition` and the host's module route.

[ADR 010](010-give-loaded-modules-native-esm-semantics.md) governed how the
Loader evaluated modules. This ADR supersedes it.

### 1.2. A module reaches the browser at its realm URL

The realm server's compile step stays, and it is where a module becomes
importable. It turns a realm's source (`.gts`, `.gjs`, `.hbs`, `.js`) into
ECMAScript module source text and writes the identity tags (§1.3). It MUST NOT
rewrite a module's import specifiers: the browser is given the authored
specifiers and resolves them itself.

A realm MUST answer the URL the browser resolves. An extensionless relative
specifier (`./foo` from `./TestCard.gts`) is answered with the file the author
meant; the realm already resolves a request that carries no executable extension
to its candidates.

A bare specifier (`lodash`, `@cardstack/boxel-icons/plus`,
`@cardstack/base/fields/links-to`) MUST be answered by an import map the app
installs once, when the page loads. The app MUST NOT extend or re-point that map
while the page lives: it is rebuilt by the next page load. An npm package, a
host tool, and a bundled base module that realm code imports MUST each be
reachable at a URL the map can name.

A realm MUST answer a module request made from the app's origin: the module and
the app that imports it are served from different origins.

A realm MUST NOT serve CommonJS.

The realm MUST publish a revision token that changes whenever one of its modules
is written, so that a page can tell that the graph it evaluated is not the
current one. `realm_generations.loader_epoch` (`packages/runtime-common/loader-epoch.ts`)
is that token today.

### 1.3. No loader-only extensions

`import.meta.loader` MUST NOT exist. Card code's `fetch` and dynamic `import()`
MUST be the browser's.

A module request that needs the realm's `Authorization` header MUST get it from
the host's auth service worker (`packages/host/public/auth-service-worker.js`),
which already injects the header for realm requests an `<img>` cannot
authenticate — a native `import()` can attach no header either. The token it
injects MUST be the one for the render that page is serving: a page that serves
renders for several sessions MUST NOT inject another session's token.

A scoped stylesheet MUST be fetched from a URL the realm serves. The page's own
fetch layer MUST NOT answer a module request.

Shims MUST NOT put a module into a browser's module map.

Dependency information MUST come from the compile step, which reads the module's
source text, and from the index. Nothing may read a module graph out of the
loader that is evaluating it.

A module's identity MUST come from the tags the compile step writes and from
nothing that runs at evaluation time. A realm is given its canonical name when
it is mounted, and that name is compiled into its tags, so a tag never depends
on the URL a reader reached the realm by. A definition a module gets from a call
rather than a class it writes is tagged only when the module wraps the call in
`markDefinition`, imported from `@cardstack/base/mark-definition` by that exact
specifier.

### 1.4. The app never re-evaluates a module

A module URL is evaluated at most once per page. The app MUST NOT re-evaluate a
module it has already evaluated, and MUST NOT hold two revisions of the same
module.

New code reaches the app's own module graph only through a full page load. The
dev server MAY trigger that load. The app MUST NOT adopt a changed module
partially — some cards on the new code and some on the old.

A module the page has never evaluated is not a re-evaluation: it is imported
normally, at its own URL. Creating a card from a module that was just written
needs no exception.

When a realm's revision token moves, the app MUST say so. It MUST show that the
cards it is rendering from that realm run a superseded revision, and MUST offer
the page load that would pick up the new code. It MUST NOT keep rendering them
as though they were current. Reloading the page on every edit is not required,
and MUST NOT yank the page out from under someone mid-edit.

A browsing context that renders cards for a realm MUST render them from one
revision of that realm. When the realm's revision moves, the context MUST be
retired or reloaded before it serves another render — this is what a warm
prerender tab does when its realm's epoch moves, except that it retires the
context instead of discarding a module map.

A test that writes a module and expects the app to see new code for it MUST
write it at a URL the page has not evaluated.

### 1.5. The preview jail

A module under live edit is evaluated in a **preview jail**: a module graph that
exists only for that edit's preview, and only while the preview is open.

The jail MUST be built by the browser's module loader. The jailed modules are
imported at **preview URLs** — URLs that name the revision being previewed and
that the app's own module graph never imports — and the preview compile step
rewrites the jailed modules' import specifiers to those URLs. A userspace module
map MUST NOT implement the jail: a preview that evaluates your module by a
different rule than production tells you something false about your edit. A
separate browsing context MAY be used as the jail, in which case its own module
map is what keeps it separate.

The jail MUST hold only the subgraph the preview needs: the edited module, and
the modules that import it inside the preview. A dependency the edit did not
change MUST be imported at its ordinary URL, so the preview and the app share
one instance of it.

The jail MUST NOT change what the app holds. A module that is in real use
outside the preview keeps the instance the app already evaluated; the preview
sees the edited revision, the app does not. No module in the app's own graph MAY
import a preview URL.

A jailed definition carries the same identity tags as the definition it is a new
revision of (§1.3), so the app can tell that the preview shows the same card
type at a newer revision.

When the preview closes, or the edited revision moves again, the jail MUST stop
being used, and nothing in the app MAY still refer to it.

The jail MUST be available to the paths that verify code they just wrote — the
code editor's preview, and the tools that evaluate a module or instantiate a
card from it — so that a verification runs the revision it wrote rather than the
one the page loaded earlier.

## 2. Rationale

The host app's own modules already run this way: Vite builds them and the
browser evaluates them. This ADR extends that to the realm modules the page
loads today through the Loader.

Card authors, agents, bundlers, Node, and the browser all share one module
system. Every place Boxel's Loader differs from it is a fault that appears only
in Boxel (ADR 010 §2). Parity is reachable in principle, but keeping it is a
permanent cost the platform pays: each ESM feature has to be re-implemented, and
each re-implementation is a place where a card behaves differently when one
evaluator runs it than when another does. The browser's loader is the one that
is already finished and that no one here has to maintain.

The Loader's exceptions and the Loader's discard are one problem. Shims,
`import.meta.loader`, extension folding, and the module-map bookkeeping exist to
make a module graph that is thrown away and rebuilt behave like a stable one.
Remove the rebuild and most of the exceptions have no job left.

Not re-evaluating is what makes the rest of this cheap. Once the app's graph is
frozen for a page, resolution needs only an import map installed once, an
extensionless relative specifier needs only the realm's existing file fallback,
and a module URL needs no revision in its path — the page load is the revision
boundary. The alternative, re-evaluating the edited module's importers in the
live graph, needs every module's URL to name its dependencies, every dependent's
body rewritten, and a protocol for converging the app on the new instances while
keeping card identity: a permanent machine whose only job is to avoid one page
load.

The cost of not re-evaluating is that a card can be rendered with code that no
longer exists, while the index already describes the new code. That is the state
this ADR exists to make honest rather than avoid: §1.4 requires the app to name
it, and §1.5 makes the one case where staleness is unacceptable — the module you
are editing right now — exact.

Finally, the Loader cannot isolate what it evaluates: it runs realm code with
the host's globals in the host's realm (ADR 010 §1.6). The preview jail is a
real boundary, and it is temporary.

## 3. Considered options

- **Never re-evaluate in the app; a preview jail for the module under live edit
  (chosen).**
- **Re-evaluate the edited module's importers in the live graph, with each
  module's URL naming its dependencies' URLs.** This was an earlier draft of
  this ADR. It works, but it rewrites every module's specifiers and needs a
  convergence protocol for the live graph, all to avoid a page load — and it
  leaves the app holding two revisions of one realm at once, which is the state
  that makes a render untrustworthy.
- **Discard and rebuild the Loader on each edit (what happens today).** It
  re-evaluates everything the page has loaded for one file, and it is why the
  Loader's exceptions exist.
- **Reload the page automatically on every edit.** It gets the correctness, and
  it destroys the editing session — open buffers, unsaved drafts, scroll
  position — and re-evaluates the whole app for one file. The page load is the
  right boundary; who triggers it and when is a product decision, not a
  correctness one.
- **A userspace loader confined to the preview.** Rejected: the preview would
  evaluate the edited module by a different rule than production runs it by,
  which is the worst possible place for that difference.
- **Import a changed module under a cache-busting query in the app's graph.**
  The browser hands back a second instance of that module and of everything it
  imports, and the modules that import it never learn the new URL. Inside the
  jail this is exactly the mechanism, and it is required there: the point is that
  the new instance is confined.
- **Content-hash each module's URL.** Not needed once the app does not
  re-evaluate: a page load re-fetches with `max-age=0` and an `ETag`, so the
  page boundary is already the revision boundary. It stays useful for the jail,
  whose URL must name a revision.
- **Install and extend an import map while the page lives.** A later import map
  cannot override a mapping an earlier one installed, so a renamed file
  (`foo.gts` → `foo.ts`) could not be remapped. Installing one map per page load
  has no such problem.
- **Bring the userspace Loader to full ESM parity and keep it.** ADR 010 is this
  road. Parity is reachable — an AMD-style format can carry live bindings and
  top-level await — but the cost never ends, and the result is a module system
  only Boxel uses.
- **Adopt SystemJS, or another existing userspace loader, in place of ours.** A
  reader will reach for this, and it is better maintained than ours. It is still
  a second module system in the page, with its own registry and its own identity
  rules, so cards still behave differently from what the browser does.
- **Keep the Loader and add hot module replacement to it.** Hot module
  replacement works because the platform invalidates the map the code actually
  runs in. A userspace map needs its own invalidation protocol, its own
  registry, and its own identity rules, which is the Loader again.
- **Node's module customization hooks (`module.register`) for realm modules in
  the realm server.** Not needed: the realm server does not evaluate modules
  today. It compiles them, and asks the prerender browser to evaluate them.

## 4. Consequences

- After an edit, the app's live renders run the code the page loaded, and the
  index describes the new code. The app has to show that, which it does not do
  today.
- A warm prerender tab is retired when its realm's revision moves, so the first
  render after a code edit pays a tab launch. `passInvalidatesExecutables`
  already decides when a tab may keep its modules; it becomes the thing that
  decides whether the tab may be kept at all.
- Host tests share one `testRealmURL` (`packages/runtime-common/helpers/const.ts`)
  and rely on a Loader reset between tests to see new code for a path they have
  already loaded. They need a URL per test instead.
- The agent loop — write a card, instantiate it, check it — runs through the
  jail whenever it edits a module that the page has already evaluated.

## 5. Remediation

Known gaps are listed in [remediation/032.md](remediation/032.md).
