---
status: proposed
date: 2026-11-10
scope:
  - packages/billing/**
  - packages/realm-server/lib/billable-call.ts
  - packages/realm-server/**/*pricing*
  - packages/runtime-common/**/*pricing*
  - packages/runtime-common/tasks/daily-credit-grant.ts
  - packages/realm-server/handlers/handle-add-credit.ts
  - packages/postgres/migrations/*billing*
  - packages/postgres/migrations/*credit*
---

# 029. Charge metered usage at hosting unit cost times a configured margin, with a pricing version on every charge

Automation runs cost the host compute, indexing, network and storage, and
AI. A realm server recovers what its hosting provider charges for that usage,
times one margin. The prices and the margin are deployment configuration, so
changing one is a configuration edit and a redeploy, never a release, and a
realm server on any provider prices at its own costs. Every charge records the pricing version it used and what it
paid for, and a bad price never makes us charge less.

## 1. Decision

### 1.1. Cost times one margin

A metered charge MUST be its hosting unit cost, what the deployment's
provider charges for one unit of that usage, times one margin multiplier, at
1,000 credits to the dollar (`CREDITS_PER_USD`). Metered charges are a run's
compute, the indexing its writes cause, the network bytes it downloads,
storage, and batched AI, which uses the AI provider's reported cost in place
of a hosting unit cost. A metered charge MUST NOT be a flat price per run. This ADR
does not change how a plain AI call is billed.

### 1.2. Prices are deployment configuration

The unit rates, the CPU and memory of the processes they are spread over, the
margin and the floor of the minimum balance MUST be deployment configuration.
They MUST reach the realm-server, worker and prerender processes as
environment variables, and runtime code MUST read them only from its
environment. It MUST NOT read them from a provider's parameter store or from
the database, and code MUST hold no prices. Each variable's name MUST
describe the resource and unit it prices, such as a vCPU-hour or a GB-month,
not a provider's product.

Our AWS deployment MUST hold these values as SSM parameters under
`/${env}/boxel/`. The Terraform for each parameter MUST ignore changes to its
value, so that a change needs only a console edit and a redeploy.

### 1.3. A bad value stops new runs, never under-charges

Each process MUST check the values at startup. A missing or malformed value,
or a margin below 1.0, MUST fail the check for the whole set and raise an
alert. While its check has failed, a process MUST NOT admit a new run or
submit a new batch. It MUST NOT fall back to other prices.

### 1.4. A pricing version on every charge

Each process MUST log its prices and a pricing version, a hash of them, at
startup. Every metered charge (§1.1) MUST record the pricing version it was
priced at.

### 1.5. The minimum balance covers a run

An automation's minimum balance MUST be computed from its caps snapshot at
the current prices: the most one of its runs can cost, counting the most its
batched AI can cost when it opts in. It MUST NOT be lower than the configured floor.
A run MUST NOT start when its payer's balance, less their runs in flight and
their unsettled batches, is below that minimum.

### 1.6. A ledger entry says what it paid for, once

Every ledger entry MUST record its charge kind: run, run indexing, storage,
AI, batched AI, grant, purchase or expiry. A consumption entry (run, run
indexing, storage, batched AI) MUST also record its realm and a reference to
what it paid for: the run, the batch, or the automation and day. An AI entry
MUST record its realm when it has one. An entry written before kinds existed
MUST read its kind from its credit type: a `*_used` row is AI, a
`daily_credit` or `plan_allowance` row is a grant, an `extra_credit` row is a
purchase, and a `*_expired` row is an expiry.

A charge's identity MUST be its kind and reference. All the ledger rows one
charge writes, one per credit bucket it draws from, MUST share that identity
and be written in one transaction. A retry that finds the identity already
present MUST write nothing.

## 2. Rationale

Cost times a margin keeps every price tied to what the usage costs the host.
When the provider's rates or a process's size change, the host changes a
number, and the margin stays the
one lever for what we earn. A flat per-run price would over-charge small runs
and under-charge large ones, and it would drift from cost as runs change.

Realm servers federate (ADR 004), and a host on other infrastructure pays
other prices. Billing reads named rates from its environment and never calls
a provider, so that host sets its own rates and margin, with no adapter and
no code change. Where the values are stored is deploy configuration, which
ADR 003 §1.1 leaves to each provider.

Prices change more often than code ships, and a release to change a price
would couple billing to the release train. Configuration makes a change an
operator's edit plus a redeploy. In our deployment, SSM with
`ignore_changes` leaves Terraform owning only the starting value. SSM keeps a
version history of each parameter and limits edits to the IAM roles allowed
to make them, and each process reads its environment once, at start. Prices in the database would be one more mutable store with its own
access and audit, read on the hot path. The pricing version answers
"what price was this charged at?" for every entry, across redeploys.

`spendCredits` charges only what the balance holds, so a run that costs more
than the balance leaves the rest unpaid. A minimum balance at least as large
as the most one run can cost makes every admitted run fully payable. Caps are
set per automation, so the minimum is computed per automation, and configuration holds
only a floor. A mistyped margin of 0.1 must never ship a tenfold discount.
Fallback prices in code would be lower than the live ones the moment an
operator raised a rate, so a bad value stops new runs instead. Interactive
work and runs already going are unaffected, and the alert names the value.

A ledger that says only how much was spent can't answer what a charge was
for, can't show a charge on its run, and can't tell a retry from a second
charge. The kind, realm and reference answer the first two. One run makes
several charges of different kinds against the same reference, and one
charge can draw from several credit buckets, so a charge's identity is its
kind and reference, shared by every row it writes. Grants, purchases and
expiries belong to a user, not a realm, so only consumption entries carry
one.

## 3. Considered options

- **Hosting unit cost times a margin, prices in deployment configuration, a
  pricing version on every charge (chosen).**
- **Flat prices per run.** They drift from cost and over- or under-charge by
  run size.
- **Prices in code.** Every change needs a release.
- **Read prices from SSM at runtime.** Billing would depend on one provider
  (ADR 003), for nothing the environment doesn't already give.
- **Prices in the database.** It is another mutable store to secure and
  audit, read on every charge, without the version history a parameter store keeps.
- **Fallback prices in code.** A raised price makes the fallback an
  under-charge, unless every increase also ships a release.
- **Billing from the provider's bill after the fact.** The bill comes monthly and
  per account, so it can't be tied to a run, shown when the run ends, or
  checked against a balance before the run starts.

## 4. Remediation

Known gaps are listed in [remediation/029.md](remediation/029.md).
