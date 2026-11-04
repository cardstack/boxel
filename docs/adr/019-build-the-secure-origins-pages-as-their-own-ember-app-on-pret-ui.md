---
status: proposed
date: 2026-11-04
supersedes: 008
scope:
  - packages/secure-origin/**
  - packages/pretui/**
  - packages/realm-server/lib/secure-origin.ts
  - packages/realm-server/realm-server.Dockerfile
  - packages/realm-server/scripts/start-staging.sh
  - packages/realm-server/scripts/start-production.sh
  - packages/realm-server/tests/helpers/index.ts
  - packages/realm-server/tests/scripts/run-qunit-with-test-pg.sh
  - packages/realm-server/tests/secure-origin-policy-test.ts
  - packages/boxel-cli/tests/scripts/run-integration-with-test-pg.sh
  - packages/matrix/support/isolated-realm-server.ts
  - packages/matrix/tests/global.setup.ts
  - mise-tasks/services/realm-server
  - mise-tasks/test-services/**
  - packages/host/app/components/matrix/account-switch-failed.gts
  - packages/host/app/components/matrix/secure-sign-in.gts
  - packages/boxel-ui/src/**
  - .github/workflows/ci.yaml
  - .github/workflows/ci-lint.yaml
---

# 019. Build the secure origin's pages as their own Ember app, on Pret UI

Every other screen in Boxel is a component in the host app. The secure
origin's pages (the secure window, and the credential fields the app frames)
are the deliberate exception. One script served anywhere on the secure origin
can read every password typed on it, so all the code the origin serves is
trusted code. It has to be small enough to review, and nothing else may change
it without that review. So the pages get a package of their own: an Ember app
with an import allowlist enforced by the build, and a reviewed record of
everything it ships. The pages are built from Pret UI's components, the
library the rest of Boxel's new UI uses (ADR 009), rather than from copies the
package keeps of boxel-ui's. Pret UI is allowed as a whole, with what it
depends on, boxel-ui included. A module ships on the origin only when it
meets the origin's policy, and a change to one shows in the build record of
the pull request that makes it.

## 1. Decision

### 1.1. A package of their own

The secure origin's pages MUST be built from their own package,
`packages/secure-origin`. The realm server MUST serve on the secure origin only
that package's build output, and the files allowed by §1.4. The build MUST run
before any process that serves the secure origin starts, including the
realm-server image, the development and test stacks, and test helpers that
start the secure origin in-process. A package whose modules the build reads
from that package's own build output, such as boxel-icons, MUST be built before
the package everywhere the package is built. The realm server MUST NOT build
anything at request time.

### 1.2. Ember, with templates compiled at build time

The pages SHOULD be an Ember app, written as Glimmer components. Templates
MUST be compiled at build time, Pret UI's included. The build MUST NOT include
Ember's runtime template compiler.

### 1.3. What the package may import

The package MAY import anything Pret UI (`@cardstack/pretui`) exports, and
the build MAY ship whatever Pret UI reaches, boxel-ui (`@cardstack/boxel-ui`)
included. The package MUST NOT import boxel-ui itself: boxel-ui reaches the
pages only through Pret UI. The package MUST NOT import from `packages/host`,
`@cardstack/runtime-common`, the base realm, or any realm or card module,
directly or through a Pret UI module. Every module in the build's output MUST come from
the package itself or from a package named in its allowlist. A plugin in the
package's build MUST fail the build when the output holds any other module,
or any module of Ember's runtime template compiler (§1.2). Adding a package to
the allowlist is a change to the secure origin's trusted code, and MUST be
reviewed as one. That holds for a package that Pret UI imports as much as for
one the package imports by name.

This ADR is that review for Pret UI as a whole and for every package Pret UI
depends on, directly or through boxel-ui, at the versions the lockfile pins:
among them `@cardstack/boxel-icons`, `ember-modifier`,
`ember-provide-consume-context`, `glimmer-motion`, `@cardstack/boxel-ui` and
boxel-ui's own dependencies. The allowlist MAY name any of them. A package
outside that tree MUST be added in a change reviewed for it.

### 1.4. Styles

The pages MAY use boxel-ui's `variables.css`, `theme.css` and typeface,
served as files, so their tokens are the app's. They MUST NOT load any other
boxel-ui file as a file of its own. The styles of the boxel-ui components
Pret UI uses reach the pages in the build's stylesheets, as Pret UI's do.

The package's components SHOULD follow the host's CSS conventions, so the
pages look and change like the app's screens. Each component SHOULD style
itself with scoped CSS (`<style scoped>`, compiled by `glimmer-scoped-css`), as
the host's and Pret UI's components do. Styles SHOULD use the theme's and
boxel-ui's CSS variables for color, spacing and type, and scalable units such
as `rem`.

### 1.5. The policy stays as it is

The build output MUST run under the secure origin's Content Security Policy
unchanged, with no `unsafe-inline` and no `unsafe-eval`. Templates MUST NOT
bind or set a `style` attribute, and this includes every Pret UI and boxel-ui
template the pages render. The package's template lint MUST enable
`no-inline-styles` with `allowDynamicStyles: false`, and the package's lint
MUST apply the same rule to each Pret UI module the package imports. Code that
styles an element at run time MUST use the CSSOM
(`element.style.setProperty`). Scoped CSS MUST be emitted as files. Entry
documents MUST hold no inline script or style. A test MUST load each built
page under the policy and fail on any `securitypolicyviolation` event. The
secure origin MUST NOT be served by a development server that injects styles
inline.

### 1.6. Security logic stays plain modules

The credential frame's message protocol and fixed forms, the Matrix requests,
the session handling, origin matching and response redaction MUST live in
`packages/secure-origin/src/security/`. Modules there MUST import nothing from
Ember, Glimmer, Pret UI, boxel-ui or the package's components, and a lint rule
(`no-restricted-imports`) on that directory MUST enforce it. Components call
these modules. They MUST be testable without rendering.

### 1.7. Serving

The build MUST emit one entry document for the shell and one for the
credential fields, and a manifest that maps each entry to the files it loads.
The realm server MUST read the manifest and the files once, at startup. The
shell's path is configured per environment (`/` deployed, `/secure` in
development). So the build MUST write asset URLs under a fixed placeholder
base, and the realm server MUST replace that base with the configured path
when it reads the files. The credential fields SHOULD have their own entry and
bundle. Framing and headers MUST stay per path, as `secureOriginHeaders()`
sets them.

### 1.8. Reviewing what ships

The package MUST commit a record of its build output: each module's package
name and version, and its size. A module from another package in this
repository, such as Pret UI, boxel-ui or boxel-icons, MUST also be recorded with a hash
of the file the build reads for it, since such a package's version doesn't
change when its code does. CI MUST rebuild the package and fail when the
output differs from the record. When such a module's hash moves, the failure
MUST name the module and this ADR, so the pull request is read as a change to
the origin. CI MUST also run
the package's component tests and the policy test (§1.5) on a change to any
package in this repository whose modules the build ships. So a change to
Ember, to an allowed package, or to a Pret UI or boxel-ui module the origin
ships shows, in
the pull request that makes it, exactly what changes on the origin.

### 1.9. One implementation of the sign-in screens

The host SHOULD render its own sign-in, registration and password-reset
screens from the package's presentational components, so that one
implementation serves both origins. The host MAY import from the package. The
package MUST NOT import from the host (§1.3).

### 1.10. TypeScript

The package's code SHOULD be TypeScript: components in `.gts` files, and
other modules, scripts, tests and build configuration in `.ts` files. Its
TypeScript MUST use only erasable syntax, so that Node runs the package's
scripts and tests without a compile step. The package's build compiles its
`.ts` and `.gts` files. The package's lint MUST type-check them.

### 1.11. Pret UI first

The pages MUST use a Pret UI component, helper or modifier where Pret UI has
one for the job that can ship. A module can ship when everything it reaches
passes §1.3 and it runs under the policy (§1.5). The package MUST NOT keep a
component, helper, modifier or icon of its own for such a job. Icons come from
boxel-icons (`@cardstack/boxel-icons`), as ADR 009 §1.3 sets out. Where Pret
UI's counterpart can't ship yet, the package MAY keep its own, and the fix
SHOULD be made in Pret UI so the package's copy can go. The usual reasons a
Pret UI module can't ship are a bound `style` attribute in its template or in
a boxel-ui component it renders, a `<style>` element added at run time or
left unscoped, and an import of the base realm.

## 2. Rationale

The rest of the UI is the host app, and new screens are expected to follow
it. The secure origin can't. It exists so that card code in the app page
can't read a credential, and the browser's same-origin policy does the
isolating. That protects the origin, not a page on it, so every script the
origin serves can read every window open on it [1][2]. All that code is
trusted. What decides the architecture is how much trusted code there is, who
writes it, and how a change to it gets reviewed. The host bundle is ruled out
outright: it evaluates card code.

An Ember app of the pages' own is the stack the team already writes and
reviews. A minimal Ember application (router, resolver and one component) is
293 KB of minified script, 91 KB gzipped, in a production build, and runs under
the policy with no violation [3]. That runtime is a fixed body of code from a
widely used, pinned release. It needs no `unsafe-eval` once templates are
compiled at build time. The security logic stays as plain modules in one
directory (§1.6), because that code is what a reviewer of the origin has to
read closely. Plain modules keep it readable without knowing the framework,
and testable on its own.

Building the pages from no component library at all costs a copy of every
component they draw. The package keeps ports of boxel-ui's Button,
FieldContainer, Label, Input, InputGroup, Checkbox and LoadingIndicator, the
host's ErrorDisplay and workspace dropdown, and twenty icons copied from
boxel-ui and boxel-icons: about 2,600 lines that follow their originals by
hand [4]. The key pages keep gaining screens, so the copies keep growing, and they copy
boxel-ui, which ADR 009 deprecates. Pret UI is where the app's new UI goes,
so the pages drawn from it look and behave like the app, and a fix made there
reaches both.

The reasons that ruled out boxel-ui's components [3] are met by the rules
above, for Pret UI and for the boxel-ui it brings:

- **Size.** Pret UI exports each component from its own module, with no
  index to pull in, so the bundle holds only the Pret UI modules a page
  imports. Pret UI's wrappers of boxel-ui components import boxel-ui's
  `components` index, though, and boxel-ui declares no `sideEffects`, so the
  first such wrapper a page uses can bring much of boxel-ui and its
  dependencies with it: ADR 008 measured 1,265 KB through those index
  modules. That cost is accepted. The build record shows it (§1.8), and it
  shrinks as ADR 009 §1.6 moves Pret UI off boxel-ui.
- **Style attributes.** boxel-ui's LoadingIndicator and BoxelIcon set
  `style` attributes the policy refuses, and so do about 130 of the modules
  in Pret UI's `components/`. So §1.5 holds for every Pret UI and boxel-ui
  template a page renders. The lint checks the Pret UI modules the package
  imports, and the policy test catches a `style` attribute anywhere a page
  renders one. A module that binds `style` can't be used until it sets its
  properties only through the CSSOM. Pret UI's `keepStyle` modifier already
  writes a component's custom properties that way, but beside the
  component's own `style` binding, not in place of it.
- **Every change ships onto the origin.** It still does, for the Pret UI and
  boxel-ui modules the origin ships, but no longer unseen. The hash in the
  build record (§1.8) fails CI on such a change until the same pull request
  updates the record, the failure names the modules that moved and this ADR,
  and the origin's tests and policy test run on it. The record changes often,
  so what this buys is a visible, named change in the pull request; it still
  takes a reviewer who reads it as a change to the origin, as a change to the
  package itself does.

Pret UI and boxel-ui are source in this repository, so what ships is what a
reviewer reads here. The package's own build compiles Pret UI and boxel-ui
from their source, through their packages' exports, as the host's build
does. boxel-icons exports only its own build, which is built first (§1.1) as
it is for the host, and the record hashes that build (§1.8). The package doesn't import boxel-ui directly (§1.3), so as ADR
009 §1.6 moves Pret UI off boxel-ui, what reaches the origin through it goes
with it. Pret UI's modules that reach the base realm, its Spec-card support,
still can't ship.

## 3. Considered options

- **The package's own Ember app, on Pret UI (chosen).**
- **The package's own Ember app, with its own components.** This was the
  decision ADR 008 recorded. It keeps the trusted code to the package alone,
  but every component the pages draw is a hand-kept copy of the app's, and
  the copies grow with each key page.
- **The host app bundle.** It evaluates card code.
- **An Ember app on boxel-ui's components, imported directly.** A sign-in
  form built from them shipped 321 KB minified, and 1,265 KB through
  boxel-ui's index modules. LoadingIndicator and the BoxelIcon logo set
  `style` attributes the policy refuses. boxel-ui is also deprecated (ADR
  009). It still reaches the pages where Pret UI wraps it, but the pages
  build on Pret UI, so that share leaves as Pret UI moves off boxel-ui.
- **Pret UI without boxel-ui.** Shipping only the Pret UI modules that reach
  no boxel-ui keeps the trusted code smaller, but it keeps Pret UI's inputs,
  input groups and selects off the origin until each is rebuilt without
  boxel-ui, and the package's own copies with them.
- **Plain JavaScript, in the realm server or in its own package.** It is the
  smallest trusted code, but it means a hand-copied second implementation of
  every screen, which grows with each screen the window gains.
- **A small view library, such as Preact or Lit.** It is smaller than Ember,
  but it is a second UI stack for the team to learn and review.
- **Relaxing the policy with `style-src-attr 'unsafe-inline'`, so more of Pret
  UI ships as it is.** It would also let any style attribute that injected
  markup carries take effect.

## 4. Consequences

Pret UI's authors work under §1.5 for the modules the origin ships: a
change that adds a `style` binding to one the package imports fails the
package's lint, and one a page renders fails the policy test. A change to a
boxel-ui component Pret UI wraps can change the origin, and shows in its
build record. Moving Pret UI off boxel-ui (ADR 009 §1.6) shrinks the origin's
trusted code.

## 5. Sources

1. `.claude/skills/secure-origin/SKILL.md`, "The governing fact".
2. [ADR 005](005-authorize-key-changes-only-with-a-session-card-code-cant-reach.md)
   §1.4, the secure origin's pages and their policy.
3. [ADR 008](008-build-the-secure-origins-pages-as-their-own-ember-app.md),
   which this ADR supersedes: §2 for the Ember app's size, and §3 for the
   measurements of an app on boxel-ui's components.
4. `packages/secure-origin/src/components/` and
   `packages/secure-origin/src/shell/keys/workspace-dropdown.gts`.

## 6. Remediation

Known gaps are listed in [remediation/019.md](remediation/019.md).
