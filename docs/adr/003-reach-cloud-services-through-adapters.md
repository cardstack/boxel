---
status: proposed
date: 2026-10-18
scope:
  - packages/realm-server/**
  - packages/runtime-common/**
  - packages/postgres/**
  - packages/billing/**
  - packages/ai-bot/**
  - packages/bot-runner/**
  - packages/host/app/**
---

# 003. Reach proprietary cloud services only through adapters

Boxel is deployed on AWS. This is a deployment choice, so the runtime code must
not depend on it. Each proprietary cloud service the runtime uses sits behind an
interface. The interface is named for the capability that Boxel needs. An
adapter implements the interface for one provider, and a local adapter
implements it for development and tests. Services that speak an open protocol
(Postgres, a POSIX filesystem, HTTP, the S3 API) need no interface, but the
code must use only what that protocol defines. The runtime must not detect
which platform hosts it. To move to a different provider, a team writes
adapters and changes configuration. It does not rewrite the code that calls the
adapters.

## 1. Decision

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD",
"SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in this
document are to be interpreted as described in BCP 14 (RFC 2119, RFC 8174) when,
and only when, they appear in all capitals, as shown here.

### 1.1. Scope

This ADR governs runtime code: code that runs in a deployed service or in the
browser. Infrastructure-as-code, deploy configuration such as
`packages/host/config/deploy.js`, CI workflows, and operational runbooks and
skills are provider-specific by nature, and this ADR does not govern them.

### 1.2. Proprietary services sit behind an adapter

Runtime code MUST reach a proprietary cloud service, such as KMS, only through
an interface. The interface MUST be named and shaped for the capability that
Boxel needs, for example `SecretsKeyProvider` or `MediaCacheAdapter`. It MUST
NOT be named or shaped for the service. An interface MUST NOT expose provider
types, request or command objects, resource identifiers such as ARNs, or
provider error codes. An adapter MUST translate provider errors into the
interface's own results or errors.

A provider SDK (`@aws-sdk/*`, and the SDK of any other cloud provider) MUST be
imported only in an adapter module. A lint rule MUST enforce this. The rule's
allowlist names each adapter module. A change to the allowlist is a reviewed
change to the boundary.

### 1.3. Open protocols are the boundary

Runtime code MAY reach a service that speaks an open, widely implemented
protocol directly, without an interface. These protocols include Postgres, a
POSIX filesystem, HTTP, and the S3 API. Code that uses such a service MUST use
only what the protocol defines. It MUST NOT depend on extensions that only one
provider offers, such as engine-specific features of a managed Postgres or
S3 features that S3-compatible stores do not implement.

An S3 client MUST take its endpoint, region, and path-style addressing from
configuration, so that it can reach any S3-compatible store. It MUST get
credentials from configuration or the SDK's default chain, and it MUST NOT
assume a particular source for them. The runtime SHOULD construct S3 clients
through one shared helper.

### 1.4. Every capability runs locally

Every interface from §1.2 MUST have a local adapter that runs without cloud
credentials. Development and CI MUST use it. For an S3-API store,
development and CI MAY instead use a local S3-compatible server or a
local-disk adapter.

### 1.5. Configuration selects the adapter

One factory per capability MUST choose the adapter from configuration at
startup. Code outside the factory MUST depend on the interface, and it MUST
NOT know which adapter is in use. Partial or conflicting configuration MUST
fail startup. It MUST NOT fall back silently. Settings that only one adapter
reads MAY be named for its provider, such as `SECRETS_KMS_KEY_ARN`. Only that
adapter's factory MAY read them.

### 1.6. No assumptions about the hosting platform

Runtime code MUST NOT detect its platform from environment variables that a
provider injects, such as `ECS_CONTAINER_METADATA_URI`. It MUST NOT change
behavior based on provider-specific request headers or user agents, such as
`ELB-HealthChecker`. A fact about the deployment, such as an instance id or
whether the server is deployed, MUST come from a provider-neutral setting that
the deployment configuration sets. Health and readiness MUST be served on
paths that any load balancer or orchestrator can probe.

### 1.7. New dependencies

A new dependency on a hosted service SHOULD use an open protocol rather than a
proprietary API. A new proprietary dependency MUST meet §1.2–§1.5 when it is
added. This ADR does not require an adapter for another provider until a
deployment needs one.

## 2. Rationale

Boxel will not necessarily stay on its current provider. Cost, a customer's
data-residency or self-hosting requirement, or a service that another provider
offers better can each make a move worthwhile. Each piece of code that is
coupled to one provider makes a move more expensive. Coupling also spreads,
because new code copies the code around it. Today only a few runtime modules
touch AWS. This makes the rule cheap to adopt now, and the cost of adopting it
will only increase.

The two existing seams show the shape of the rule. `MediaCacheAdapter` and
`SecretsKeyProvider` each have a cloud adapter and a local one. A factory
chooses between them from the environment. The local adapter makes the rule
cheap to keep. Development and CI already run without AWS, so the interface
is used by two implementations from the start, and it cannot become a thin
wrapper over one provider's API.

The S3 API counts as an open protocol because many object stores implement
it, including Cloudflare R2, MinIO, Backblaze B2, and Google Cloud Storage
through its XML API. An interface in front of it would add a layer with no
gain in portability. What it does need is a configurable endpoint (§1.3).

The import rule is a lint rule because the boundary can break quietly. An
SDK import in a large diff is easy to miss in review, and agents write much of
this code. A lint failure states the rule at the point where the code breaks
it.

## 3. Considered options

- **Adapters for proprietary services, open protocols as the boundary
  (chosen).** Portability work goes only where it is needed, and code stays
  direct where a standard already makes it portable.
- **Call the provider directly, and port when needed.** This costs nothing
  now, but coupling spreads. Assumptions about the platform, such as which
  environment variables exist, stay invisible until the code runs somewhere
  else.
- **A generic multi-cloud library.** Its lowest-common-denominator API is
  wider than what Boxel needs. It does not model capabilities such as
  envelope-key unwrapping, and it adds a dependency that must track every
  provider. Small interfaces of our own are cheaper.
- **A Boxel interface in front of the S3 API as well.** Rejected; see §2.
- **Interfaces for everything external, including Postgres and the
  filesystem.** These are already portable standards. An interface would cost
  effort without making the code more portable.
- **Self-hosted open-source services only, such as MinIO or Vault, in
  production.** This avoids proprietary APIs, but at an operational cost that
  adapters make unnecessary.

## 4. Consequences

The runtime does not yet meet this ADR in these places. Each is follow-up
work:

- No lint rule restricts provider SDK imports (§1.2).
- `S3MediaCacheAdapter` (`packages/realm-server/media-cache/s3-adapter.ts`)
  and the prerender artifact sink
  (`packages/realm-server/prerender/artifact-sink.ts`) construct `S3Client`
  with a region only, and no endpoint can be configured (§1.3).
- `worker.ts` and `worker-manager.ts` derive worker ids from
  `ECS_CONTAINER_METADATA_URI`. `worker-manager.ts` enables the local indexing
  dashboard when that variable is absent (§1.6).
- `healthCheck` in `packages/realm-server/middleware/index.ts` answers only
  requests whose user agent is `ELB-HealthChecker` (§1.6).
- The `ecsMetadata` middleware sends an `X-ECS-Container-Metadata-URI-v4`
  response header (§1.6).
