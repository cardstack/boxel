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
  - packages/base/**
  - packages/bxl/**
  - packages/boxel-ui/**
---

# 003. Reach proprietary cloud services only through adapters

Our organization deploys Boxel on AWS, but Boxel is designed as a federation
of realm servers that other people host
([ADR 004](004-federate-realm-servers-each-paired-with-its-own-homeserver.md)),
and they may not use AWS. So the runtime code must not depend on any one
provider. Each proprietary cloud service the runtime uses sits behind an
interface. The interface is named for the capability that Boxel needs. An
adapter implements the interface for one provider, and a local adapter
implements it for development and tests. Services that speak an open protocol
(Postgres, a POSIX filesystem, HTTP, the S3 API) need no interface, but the
code must use only what that protocol defines. The runtime must not detect
which platform hosts it. To run a realm server on a different provider, a host
writes adapters and changes configuration. It does not rewrite the code that
calls the adapters.

## 1. Decision

### 1.1. Scope

This ADR governs runtime code: code that runs in a deployed service or in the
browser. Infrastructure-as-code, deploy configuration such as
`packages/host/config/deploy.js` and the realm-server's deployed
`scripts/start-*.sh`, CI workflows, and operational runbooks and skills are
provider-specific by nature, and this ADR does not govern them.

### 1.2. Proprietary services sit behind an adapter

Runtime code MUST reach a proprietary cloud service, such as KMS, only through
an interface. The interface MUST be named and shaped for the capability that
Boxel needs, for example `SecretsKeyProvider` or `MediaCacheAdapter`. It MUST
NOT be named or shaped for the service. An interface MUST NOT expose provider
types, request or command objects, resource identifiers such as ARNs, or
provider error codes. An adapter MUST translate provider errors into the
interface's own results or errors.

A provider SDK (`@aws-sdk/*`, and the SDK of any other cloud provider) MUST be
imported only in an adapter module, or in a module that speaks the S3 API
(§1.3). A lint rule MUST enforce this. The rule's allowlist,
`eslint/cloud-provider-sdk-imports.cjs`, names each such module. A change to
the allowlist is a reviewed change to the boundary.

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
through `packages/realm-server/lib/s3-client.ts`.

### 1.4. Every capability runs locally

Every interface from §1.2 MUST have a local adapter that runs without cloud
credentials. Development and CI MUST use it. For an S3-API store,
development and CI MAY instead use a local S3-compatible server or a
local-disk adapter.

### 1.5. Configuration selects the adapter

One factory per capability MUST choose the adapter from configuration at
startup. Code outside the factory MUST depend on the interface, and it MUST
NOT know which adapter is in use. Incomplete configuration for an adapter MUST
fail startup. It MUST NOT fall back silently to another adapter. Settings that
only one adapter reads MAY be named for its provider, such as
`SECRETS_KMS_KEY_ARN`. Only that adapter's factory MAY read them.

### 1.6. No assumptions about the hosting platform

Runtime code MUST NOT detect its platform from environment variables that a
provider injects, such as `ECS_CONTAINER_METADATA_URI`. Code MUST NOT name a
provider-specific request header or user agent, such as `ELB-HealthChecker`.
When behavior depends on one, the deployment configuration MUST name it. A
fact about the deployment, such as an instance id or whether the server is
deployed, MUST come from a provider-neutral setting or derivation, such as the
server's own URL.

### 1.7. New dependencies

A new dependency on a hosted service SHOULD use an open protocol rather than a
proprietary API. A new proprietary dependency MUST meet §1.2–§1.5 when it is
added. This ADR does not require an adapter for another provider until a
deployment needs one.

## 2. Rationale

Boxel is designed as a federation of realm servers (ADR 004). People and
organizations other than ours will host their own realm servers, which work
with ours and with the rest of Boxel. They will pick their own hosting: another
cloud provider, their own data center, or a single machine. The realm server
they run is the same code we run, so every AWS assumption in it becomes a
barrier to joining the federation. A host that has to fork the code to replace
one service falls behind our releases, and out of step with the servers it
federates with.

The same rule keeps our own options open. Cost, a customer's data-residency
requirement, or a service that another provider offers better can each make a
move worthwhile for us too.

Each piece of code that is coupled to one provider raises the cost of hosting
anywhere else. Coupling also spreads, because new code copies the code around
it. Today only a few runtime modules touch AWS. This makes the rule cheap to
adopt now, and the cost of adopting it will only increase.

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
  now, but the port would fall to each outside host, and coupling spreads.
  Assumptions about the platform, such as which environment variables exist,
  stay invisible until the code runs somewhere else.
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
- **A dedicated health-check path instead of a configured user agent.** This
  is the more common pattern. But it moves the load balancer's probe, so the
  application and the infrastructure must change in a set order. A
  configured user agent keeps the probe where it is, and a different load
  balancer needs only a new setting.

## 4. Remediation

Known gaps are listed in [remediation/003.md](remediation/003.md).
