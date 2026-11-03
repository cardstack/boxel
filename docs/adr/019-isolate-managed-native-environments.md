---
status: proposed
date: 2026-10-26
scope:
  - packages/boxel-local-runtime/**
---

# 009. Isolate managed native environments behind a host adapter

Keep Boxel's native environment lifecycle in the monorepo. Desktop hosts supply
execution and secret encryption through an adapter. Each managed source fork
runs independently, so testing a platform change does not replace a user's
main environment.

## 1. Decision

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD",
"SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in this
document are to be interpreted as described in BCP 14 (RFC 2119, RFC 8174) when,
and only when, they appear in all capitals, as shown here.

### 1.1. Product and host boundary

Environment provisioning, source validation, build policy and lifecycle MUST
remain in this monorepo. Host-specific secret encryption and runtime execution
MUST enter through the `ManagedEnvironmentsOptions` host adapter. The controller
MUST require its private native capability for environment operations. It MUST
reject browser-origin requests.

### 1.2. Isolation and lifecycle

Each environment MUST have its own source directory, namespace, service ports
and data directory. Environment actions MUST reserve their environment before
asynchronous setup and MUST reject competing actions, except an explicit stop
that cancels and waits for the current action. Stopping a managed environment
MUST stop only processes owned by that environment.

### 1.3. Verification and source provenance

The official source snapshot MUST be checked against its recorded patch digest
and Git tree before provisioning. Running changed source MUST require matching
successful test and build fingerprints. Database coverage in the native
baseline MUST use real isolated PostgreSQL, without database mocks. Additional
behavior SHOULD be tested in its owning package.

## 2. Rationale

A native workflow lets desktop users change Boxel without maintaining a Docker
stack. Keeping product policy in the monorepo gives hosted and local Boxel one
implementation. Separate data and process ownership let users test a fork while
their main workspace stays available. Native capabilities keep trusted host
controls outside card code.

## 3. Considered options

- **Native managed environments through a host adapter (chosen).** Shares
  product behavior while permitting each host's encryption and process model.
- **Require Docker for desktop forks.** Adds the development stack to ordinary
  desktop use rather than using the runtime shipped with the app.
- **Replace the main runtime with each source build.** Couples experiments to
  the user's active data and services.
- **Implement the product lifecycle in each desktop plugin.** Duplicates policy
  across hosts and separates it from Boxel's server changes.

## 4. Remediation

No known gaps.
