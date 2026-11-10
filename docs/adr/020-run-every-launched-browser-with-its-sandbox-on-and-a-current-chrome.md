---
status: proposed
date: 2026-11-05
scope:
  - packages/realm-server/prerender/**
  - packages/realm-server/prerender.Dockerfile
  - packages/realm-server/scripts/**
  - packages/realm-server/tests/**
  - packages/realm-test-harness/**
  - packages/runtime-common/chrome-sandbox.ts
  - packages/boxel-cli/src/**
  - packages/boxel-cli/package.json
  - packages/software-factory/**
  - packages/matrix/**
  - packages/ai-assistant-evals/**
  - packages/choreo-gallery/**
  - packages/**/testem*
  - .github/workflows/**
  - .devcontainer/**
  - mise-tasks/**
  - pnpm-workspace.yaml
---

# 020. Run every launched browser with its sandbox on, on a current Chrome

Every harness in this repository, and the prerenderer in production, drives a
headless Chrome or Chromium that runs code authored in a realm. Chrome's
renderer sandbox and Chrome's security releases are the two protections that
keep that code inside the browser. The repository turns the sandbox off in
places that state no reason for it, and Playwright turns it off by default. It
also runs Playwright's frozen Chromium where a current Chrome is available.
This record sets the rules for both.

## 1. Decision

### 1.1. What the rules cover

The rules cover every Chrome or Chromium process this repository or its CI
starts: through Playwright, Puppeteer, testem, or Percy.

They bind hardest on a **realm-rendering browser**: one that loads a page whose
content comes from a realm, or runs realm-authored test code. That is the
prerenderer, `boxel test`'s QUnit page, the factory's screenshot tool, and the
harnesses that run the host app against a realm server.

### 1.2. The sandbox stays on

A browser this repository launches MUST NOT run without its sandbox unless the
environment it runs in cannot start Chrome's sandbox, or a diagnostic the
launch enables needs it off. Running without the sandbox means passing
`--no-sandbox` or `--disable-setuid-sandbox`, or launching through Playwright
without `chromiumSandbox: true`, since Playwright's default is `false`.

A launch that turns the sandbox off MUST gate that on the environment or the
diagnostic that needs it, rather than apply it unconditionally, and MUST state
in a comment at the launch why the sandbox cannot run there. The reason MUST be
true of the environment the launch actually runs in, and SHOULD name the
mechanism that fails (running as root, a blocked user namespace, a missing
setuid helper) rather than only "a container".

### 1.3. The browser stays current

A realm-rendering browser launched in CI or in a deployed environment MUST run
a Chrome at or above the minimum version in §1.4. On a developer machine, a
launch MAY fall back to a bundled browser below it.

A Playwright launch SHOULD use `channel: 'chrome'`, the machine's installed
Chrome, which receives security releases. A Puppeteer launch SHOULD pass the
installed Chrome as `executablePath`. A bundled browser is the fallback for a
machine with no installed Chrome.

Where a launch cannot assume an installed Chrome, as the published `boxel-cli`
cannot, the version of the package that bundles its browser MUST be raised
whenever the Chrome it bundles falls below the minimum in §1.4.

### 1.4. One minimum version

The minimum Chrome version a realm-rendering browser may run MUST be recorded in
one place: `CHROME_MIN_VERSION` in `packages/realm-server/prerender.Dockerfile`.
That value MUST be raised to the Chrome stable release that fixes a
vulnerability Chrome rates High or Critical, within a week of that release.

A realm-rendering launch SHOULD log the browser binary and version it started,
as `BrowserManager#logBrowserVersion` does, so a deployment can be audited. A
launch in CI SHOULD fail when that version is below the minimum.

### 1.5. Other browser hardening

A launch MUST NOT turn off site isolation
(`--disable-features=IsolateOrigins,site-per-process`) unless a comment at the
launch names the behaviour it needs and why no narrower flag gives it.

A launch MAY relax certificate validation, with `--ignore-certificate-errors`
or Playwright's `ignoreHTTPSErrors`, only for a loopback origin. It MUST gate
that relaxation on the origin being loopback, or on a hostname the same launch
maps to loopback (for example with `--host-resolver-rules`).
`packages/realm-server/lib/is-https-loopback.ts` is the pattern.

### 1.6. New code

New code MUST NOT copy a sandbox or hardening flag listed in the remediation
file.

## 2. Rationale

The prerenderer renders card HTML from any realm, and the host app executes card
code in the page it renders. The renderer sandbox is the boundary between that
code and the process, filesystem and network around it. Running the prerenderer
as a separate ECS task is a second line, not a substitute: a render that escapes
the page still has everything that task can reach.

Playwright launches Chromium with the sandbox off unless `chromiumSandbox: true`
is passed. Every Playwright launch in this repository takes that default, so the
suites that run realm content run it unsandboxed without any flag in the source
saying so.

Playwright bundles a frozen Chrome-for-Testing build. It changes only when
Playwright releases, and it never receives the incremental security releases
Chrome ships between those releases. The catalog resolves `@playwright/test` to
1.61.0, which bundles Chrome 149.0.7827.55, and Puppeteer 25.2.1 bundles Chrome
150.0.7871.24. The prerender image refuses to build below 156.0.8078.79. The
repository already has a floor for a browser that renders realm content; the
bundled browsers run six and seven majors below it. Almost every Chrome stable
release fixes a security bug, so §1.4 ties the floor to the High and Critical
ones, which keeps raising it a bounded duty.

The `--no-sandbox` lines in the testem configs come from Ember's default testem
template and carry its comment, "needed when running Chrome inside a container",
or no comment at all. testem launches the runner image's installed Chrome, and
GitHub's runners run as a non-root user. Root is not the only thing that stops
the sandbox, though: Ubuntu 24.04 restricts unprivileged user namespaces, and
Chrome then needs its setuid `chrome-sandbox` helper, which the installed
`google-chrome-stable` package ships and Playwright's bundled Chromium does
not. The same question decides whether the prerenderer's Fargate task can run
the sandbox. Neither has been tested with the flag removed, so closing each gap
starts by launching with the sandbox on there; where it fails, §1.2 asks for the
gate and the stated reason.

## 3. Considered options

- **Always pass `--no-sandbox` in CI.** No launch ever fails on the sandbox.
  Rejected: it removes the boundary in the one place untrusted realm code runs,
  without checking whether the runner needs it.
- **Gate the flag on `process.getuid() === 0`.** True for the root-container
  case and cheap to check. Rejected as the rule: root is only one reason the
  sandbox can fail, and it says nothing about a non-root task whose kernel
  blocks user namespaces. §1.2 asks the gate to name the actual reason instead.
- **Try a sandboxed launch and fall back on Chrome's sandbox error.** Covers
  every environment without a rule per environment. Rejected as the rule: a
  fallback that always succeeds hides a sandbox that no longer works, which is
  the failure this record exists to catch.
- **Keep Playwright's bundled Chromium everywhere.** Launches are reproducible
  and need no system browser. Rejected for realm-rendering browsers:
  reproducibility is worth less than the security releases Chrome ships between
  Playwright releases.
- **Bump Playwright on a calendar instead of switching channel.** Chosen only
  where a system Chrome cannot be assumed (§1.3), and rejected as the primary
  answer for CI, where the runner image already ships Chrome.
- **Raise the floor on every Chrome security release.** Rejected: nearly every
  stable release qualifies, so the rule would be broken most weeks and stop
  meaning anything.
- **Rely on the prerender being a separate ECS task.** The current state.
  Rejected as the rule: task isolation bounds what one render can reach outside
  its task, not what it can do inside it.

## 4. Consequences

- Suites that move to `channel: 'chrome'` no longer need a
  `playwright install chromium` step in CI.
- A suite that fails with the sandbox on needs a stated exception under §1.2,
  which makes each such exception reviewable rather than silent.
- `boxel test` acquires a maintenance duty: its Playwright pin becomes a security
  pin, not just a dependency version.

## 5. Remediation

Known gaps are listed in [remediation/020.md](remediation/020.md).
