---
status: accepted
date: 2026-10-20
scope:
  - packages/secure-origin/**
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
  - packages/boxel-ui/src/styles/variables.css
  - packages/boxel-ui/src/styles/theme.css
---

# 008. Build the secure origin's pages as their own Ember app

Every other screen in Boxel is a component in the host app. The secure
origin's pages (the secure window, and the credential fields the app frames)
are the deliberate exception. One script served anywhere on the secure origin
can read every password typed on it, so all the code the origin serves is
trusted code. It has to be small enough to review, and nothing else may change
it. Plain JavaScript keeps it small, but it doesn't scale to the screens the
secure window is gaining, such as key management. So the pages get a package
of their own: an Ember app with its own components, an import allowlist
enforced by the build, and a reviewed record of everything it ships. This ADR
records that boundary and why the pages don't follow the rest of the UI
architecture.

## 1. Decision

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD",
"SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in this
document are to be interpreted as described in BCP 14 (RFC 2119, RFC 8174) when,
and only when, they appear in all capitals, as shown here.

### 1.1. A package of their own

The secure origin's pages MUST be built from their own package,
`packages/secure-origin`. The realm server MUST serve on the secure origin only
that package's build output, and the files allowed by §1.4. The build MUST run
before any process that serves the secure origin starts, including the
realm-server image, the development and test stacks, and test helpers that
start the secure origin in-process. The realm server MUST NOT build anything
at request time.

### 1.2. Ember, with templates compiled at build time

The pages SHOULD be an Ember app, written as Glimmer components. Templates
MUST be compiled at build time. The build MUST NOT include Ember's runtime
template compiler.

### 1.3. What the package may import

The package MUST NOT import from `packages/host`, `@cardstack/runtime-common`,
the base realm, any realm or card module, or any script from
`@cardstack/boxel-ui`. Every module in the build's output MUST come from the
package itself or from a package named in its allowlist. A plugin in the
package's build MUST fail the build when the output holds any other module,
or any module of Ember's runtime template compiler (§1.2). Adding a package to
the allowlist is a change to the secure origin's trusted code, and MUST be
reviewed as one.

### 1.4. Styles

The pages MAY use boxel-ui's `variables.css`, `theme.css` and typeface,
served as files, so their tokens are the app's. They MUST NOT load any other
boxel-ui file.

The package's components SHOULD follow the host's CSS conventions, so the
pages look and change like the app's screens. Each component SHOULD style
itself with scoped CSS (`<style scoped>`, compiled by `glimmer-scoped-css`), as
the host's components do. Styles SHOULD use boxel-ui's CSS variables for
color, spacing and type, and scalable units such as `rem`.

### 1.5. The policy stays as it is

The build output MUST run under the secure origin's Content Security Policy
unchanged, with no `unsafe-inline` and no `unsafe-eval`. Templates MUST NOT
bind or set a `style` attribute. The package's template lint MUST enable
`no-inline-styles` with `allowDynamicStyles: false`. Code that styles an
element at run time MUST use the CSSOM (`element.style.setProperty`). Scoped
CSS MUST be emitted as files. Entry documents MUST hold no inline script or
style. A test MUST load each built page under the policy and fail on any
`securitypolicyviolation` event. The secure origin MUST NOT be served by a
development server that injects styles inline.

### 1.6. Security logic stays plain modules

The credential frame's message protocol and fixed forms, the Matrix requests,
the session handling, origin matching and response redaction MUST live in
`packages/secure-origin/src/security/`. Modules there MUST import nothing from
Ember, Glimmer or the package's components, and a lint rule
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
name and version, and its size. CI MUST rebuild the package and fail when the
output differs from the record. So a bump to Ember or any allowed package
shows, in the pull request that makes it, exactly what changes on the origin.

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

## 2. Rationale

The rest of the UI is the host app, and new screens are expected to follow
it. The secure origin can't. It exists so that card code in the app page
can't read a credential, and the browser's same-origin policy does the
isolating. That protects the origin, not a page on it, so every script the
origin serves can read every window open on it [1][2]. All that code is
trusted. What decides the architecture is how much trusted code there is, who
writes it, and how a change to it gets reviewed. The host bundle is ruled out
outright: it evaluates card code.

Plain JavaScript keeps the trusted code small: about 100 KB of commented
source, all of it written in this repository. It also costs a copy of every
screen. `shell.css`, `credentials.css` and `dom.js` copy the host's auth
screens, and tests compare the copies pixel by pixel to keep them in step [3].
Hand-built DOM is manageable for a few forms. It isn't for the screens the
secure window is gaining, such as key management, which need the state,
composition and templates the rest of the team writes in Ember.

An Ember app of the pages' own has neither cost. A minimal Ember application
(router, resolver and one component) is 293 KB of minified script, 91 KB
gzipped, in a production build, and runs under the policy with no violation.
That runtime is a fixed body of code from a widely used, pinned release, and
it is the stack the team already writes and reviews. It needs no
`unsafe-eval` once templates are compiled at build time. Components written
for the package can follow the policy from the start. The import allowlist
(§1.3) and the build record (§1.8) keep the trusted code to what the package
names, and make each change to it visible.

The security logic stays as plain modules in one directory (§1.6), because
that code is what a reviewer of the origin has to read closely. Plain modules
keep it readable without knowing the framework, and testable on its own.

## 3. Considered options

- **The package's own Ember app (chosen).**
- **The host app bundle.** It evaluates card code.
- **An Ember app on boxel-ui's components.** A sign-in form built from them
  shipped 321 KB minified, and 1,265 KB through boxel-ui's index modules,
  since boxel-ui declares no `sideEffects`. LoadingIndicator and the
  BoxelIcon logo set `style` attributes the policy refuses. Every later
  boxel-ui change would also ship onto the origin.
- **Plain JavaScript, in the realm server or in its own package.** It is the
  smallest trusted code, but it means a hand-copied second implementation of
  every screen, which grows with each screen the window gains.
- **A small view library, such as Preact or Lit.** It is smaller than Ember,
  but it is a second UI stack for the team to learn and review.
- **Relaxing the policy with `style-src-attr 'unsafe-inline'`.** It would
  also let any style attribute that injected markup carries take effect.

## 4. Consequences

Until the package exists, a new secure-origin screen waits for it, since
adding one to the plain pages would add a gap. That orders new secure-window
screens, such as key management, after the package scaffold. The host renders
its sign-in screens from the package (§1.9), so a change to them is made once,
in the package, and reaches both origins.

## 5. Sources

1. `.claude/skills/secure-origin/SKILL.md`, "The governing fact".
2. [ADR 005](005-authorize-key-changes-only-with-a-session-card-code-cant-reach.md)
   §1.4, the secure origin's pages and their policy.
3. #6861, which adds the registration and password-reset pages, the copied
   styles and icons, and the pixel comparison.
