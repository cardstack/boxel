---
status: proposed
date: 2026-10-20
scope:
  - packages/secure-origin/**
  - packages/realm-server/secure-origin/**
  - packages/realm-server/lib/secure-origin.ts
  - packages/realm-server/realm-server.Dockerfile
  - packages/host/app/components/matrix/auth-*.gts
  - packages/host/app/components/matrix/login.gts
  - packages/host/app/components/matrix/register-user.gts
  - packages/host/app/components/matrix/forgot-password.gts
  - packages/boxel-ui/src/styles/variables.css
  - packages/boxel-ui/src/styles/theme.css
---

# 008. Build the secure origin's pages as their own Ember app, with no host or boxel-ui code

Every other screen in Boxel is a component in the host app, built from
boxel-ui. The secure origin's pages (the secure window, and the credential
fields the app frames) are the deliberate exception. One script served
anywhere on the secure origin can read every password typed on it, so all the
code the origin serves is trusted code. The host bundle and boxel-ui are
far too large to trust, and they change too often to review. Plain JavaScript
keeps the trusted code small, but it doesn't scale to the screens the secure
window is gaining, such as key management. So the pages get a package of their
own: an Ember app with its own components, an enforced import allowlist, and a
reviewed record of everything it ships. This ADR records that boundary and why
the pages don't follow the rest of the UI architecture.

## 1. Decision

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD",
"SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in this
document are to be interpreted as described in BCP 14 (RFC 2119, RFC 8174) when,
and only when, they appear in all capitals, as shown here.

### 1.1. A package of their own

The secure origin's pages MUST be built from their own package,
`packages/secure-origin`. The realm server MUST serve on the secure origin only
that package's build output, and the boxel-ui files allowed by §1.4. The build
MUST run before the realm server starts: in the realm-server image, and in
the development and test stacks. The realm server MUST NOT build anything at
request time.

### 1.2. Ember, with templates compiled at build time

The pages SHOULD be an Ember app, written as Glimmer components. Templates
MUST be compiled at build time. The build MUST NOT include Ember's runtime
template compiler.

### 1.3. What the package may import

The package MUST NOT import from `packages/host`, `@cardstack/runtime-common`,
the base realm, any realm or card module, or any script from
`@cardstack/boxel-ui` (its components, helpers, modifiers or icons). Every
module in the build's output MUST come from the package itself or from a
package named in its allowlist. A check that runs with the package's lint MUST
fail the build when the output holds a module from anywhere else. Adding a
package to the allowlist is a change to the secure origin's trusted code, and
MUST be reviewed as one.

### 1.4. Styles

The pages MAY use boxel-ui's `variables.css`, `theme.css` and typeface,
served as files, so their tokens are the app's. They MUST NOT load any other
boxel-ui file.

### 1.5. The policy stays as it is

The build output MUST run under the secure origin's Content Security Policy
unchanged, with no `unsafe-inline` and no `unsafe-eval`. Templates MUST NOT
bind or set a `style` attribute. Code that styles an element at run time
MUST use the CSSOM (`element.style.setProperty`). Scoped CSS MUST be emitted as
files. Entry documents MUST hold no inline script or style. The secure origin
MUST NOT be served by a development server that injects styles inline.

### 1.6. Security logic stays plain modules

The credential frame's message protocol and fixed forms, the Matrix requests,
the session handling, origin matching and response redaction MUST stay plain
modules that import nothing from Ember. Components call them. These modules
MUST be testable without rendering.

### 1.7. Serving

The build MUST emit a fixed set of files that the realm server reads at
startup: one entry document for the shell and one for the credential fields.
The credential fields SHOULD have their own entry and bundle. Framing and
headers stay per path, as `secureOriginHeaders()` sets them today.

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

## 2. Rationale

The rest of the UI is the host app, built from boxel-ui, and new screens are
expected to follow it. The secure origin can't. It exists so that card code
in the app page can't read a credential, and the browser's same-origin policy
does the isolating. That protects the origin, not a page on it, so every
script the origin serves can read every window open on it [1][2]. All that code
is trusted. What decides the architecture is how much trusted code there is,
who writes it, and how a change to it gets reviewed.

The host bundle is ruled out outright: it evaluates card code.

boxel-ui is the tempting choice, since it is what the pages copy. A probe
build of the sign-in form from boxel-ui's real components, in production
mode, shipped 321 KB of minified script (102 KB gzipped). Imported through
boxel-ui's index modules, as the host imports it, it shipped 1,265 KB (330 KB
gzipped), including phone-number metadata, Moment, ember-power-select and
ember-basic-dropdown. boxel-ui declares no `sideEffects`, so a bundler keeps
every module an index imports. Even trimmed to CSS-only side effects, the
form carried DOMPurify and lodash, by way of Button's `@href` sanitizing and
the `pick` helper. Two components the pages need also break the policy:
LoadingIndicator always binds `style`, and the BoxelIcon logo has a static
`style` attribute. Glimmer applies both with `setAttribute`, which the policy
refuses. These can be fixed, but the larger cost would remain. Every later
change to boxel-ui, and to each of its 33 dependencies, would ship onto the
secure origin. That would make every boxel-ui pull request a security review,
and boxel-ui's authors would have to keep the origin's rules (§1.5) in a
library built for the app [3].

Plain JavaScript is what the pages are today, and it keeps the trusted code
small: about 100 KB of commented source, all of it written in this
repository. It also costs a copy of every screen. `shell.css`,
`credentials.css` and `dom.js` copy the host's auth components and boxel-ui's,
and tests compare them pixel by pixel to keep them in step. Hand-built DOM is
manageable for a few forms. It isn't for the screens the secure window is
gaining, such as key management, which need the state, composition and
templates the rest of the team writes in Ember.

An Ember app of the pages' own has neither cost. Ember's runtime is a fixed
body of code, about 56 KB gzipped in a production build, from a widely used
and pinned release. It is the stack the team already writes and reviews. It
needs no `unsafe-eval` once templates are compiled at build time. Its own
components can be written to the policy from the start. The import allowlist
(§1.3) and the build record (§1.8) keep the trusted code to what the package
names, and make each change to it visible.

The security logic stays as plain modules (§1.6) because it is what a
reviewer of the origin has to read closely. Plain modules keep it readable
without knowing the framework, and testable on its own.

## 3. Considered options

- **The package's own Ember app (chosen).**
- **The host app bundle.** It evaluates card code.
- **An Ember app on boxel-ui's components.** It brings in boxel-ui's
  dependencies and side-effectful modules, two of its components break the
  policy, and every boxel-ui change would ship onto the origin.
- **Plain JavaScript, in the realm server or in its own package.** It is the
  smallest trusted code, but it means a hand-copied second implementation of
  every screen, which grows with each screen the window gains.
- **A small view library, such as Preact or Lit.** It is smaller than Ember,
  but it is a second UI stack for the team to learn and review.
- **Relaxing the policy with `style-src-attr 'unsafe-inline'`.** It would
  let boxel-ui's style bindings run, and also any style attribute injected
  markup carries. It weakens the whole origin's policy to suit one library.

## 4. Consequences

The realm-server image and the development and test stacks build the package
before they start. Until the host renders its screens from the package (§1.9),
a change to the host's sign-in screens still needs the same change in the
package.

## 5. Sources

1. `.claude/skills/secure-origin/SKILL.md`, "The governing fact".
2. [ADR 005](005-authorize-key-changes-only-with-a-session-card-code-cant-reach.md)
   §1.4, the secure origin's pages and their policy.
3. #6861, which adds the registration and password-reset pages, the copied
   styles and icons, and the pixel comparison.
