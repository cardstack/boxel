---
status: proposed
date: 2026-11-10
scope:
  - packages/billing/**
  - packages/realm-server/lib/billable-call.ts
  - packages/realm-server/**/*pricing*
  - packages/runtime-common/**/*pricing*
  - packages/postgres/migrations/*ledger*
---

# 029. Charge metered usage at AWS unit cost times a margin held in SSM, with a pricing version on every charge

Automation runs cost us compute, indexing, network and storage, and AI. We
recover what AWS charges us for that usage, times one margin. The prices and
the margin live in SSM, so changing one is a console edit and a redeploy,
never a release. Every charge records the pricing version it used and what it
paid for, and a bad price never makes us charge less.

## 1. Decision

### 1.1. Cost times one margin

A metered charge MUST be its AWS unit cost times one margin multiplier, at
1,000 credits to the dollar (`CREDITS_PER_USD`). Metered charges are a run's
compute, the indexing its writes cause, the network bytes it downloads,
storage, and batched AI, which uses the provider's reported cost in place of
an AWS unit cost. A metered charge MUST NOT be a flat price per run. This ADR
does not change how a plain AI call is billed.

### 1.2. Prices live in SSM

The AWS unit rates, the task shapes they are spread over, the margin and the
minimum balance MUST be SSM parameters under `/${env}/boxel/`. They MUST
reach the realm-server, worker and prerender tasks as environment variables.
They MUST NOT be read from the database. Code MUST hold no prices other than
the defaults of §1.3. The Terraform for each parameter MUST ignore changes to
its value, so that a change needs only a console edit and a redeploy.

### 1.3. A bad value never under-charges

Each process MUST check the values at startup. A missing or malformed value,
or a margin below 1.0, MUST fail the check, raise an alert, and make the
code's defaults apply. The defaults MUST NOT be lower than the prices they
stand in for.

### 1.4. A pricing version on every charge

Each process MUST log its prices and a pricing version, a hash of them, at
startup. Every metered charge (§1.1) MUST record the pricing version it was
priced at.

### 1.5. The minimum balance covers a run

The minimum balance MUST be at least the most one run can cost under its
automation's caps, with batched AI counted at 1.5 times the normal price for
an automation that opts in to it. A run MUST NOT start when its payer's
balance, less their runs in flight and their unsettled batches, is below the
minimum.

### 1.6. A ledger entry says what it paid for, once

Every ledger entry MUST record its charge kind (run, run indexing, storage,
AI, batched AI, grant or purchase), its realm, and a reference to what it
paid for: the run, the batch, or the automation and day. An entry with no
kind MUST read as AI. A charge MUST be written once. A retry with the same
reference MUST NOT charge again.

## 2. Rationale

Cost times a margin keeps every price tied to what the usage costs us. When
AWS rates or task shapes change, we change a number, and the margin stays the
one lever for what we earn. A flat per-run price would over-charge small runs
and under-charge large ones, and it would drift from cost as runs change.

Prices change more often than code ships, and a release to change a price
would couple billing to the release train. SSM with `ignore_changes` makes a
change an operator's edit plus a redeploy, with Terraform owning only the
starting value. Prices in the database would be one more mutable store with
its own access and audit, read on the hot path. The pricing version answers
"what price was this charged at?" for every entry, across redeploys.

`spendCredits` charges only what the balance holds, so a run that costs more
than the balance leaves the rest unpaid. A minimum balance at least as large
as the most one run can cost makes every admitted run fully payable. For the
same reason a bad price falls back to the defaults: a mistyped margin of 0.1
must never ship a tenfold discount.

A ledger that says only how much was spent can't answer what a charge was
for, can't show a charge on its run, and can't tell a retry from a second
charge. The kind, realm and reference answer the first two, and a unique
reference answers the third.

## 3. Considered options

- **AWS unit cost times a margin, prices in SSM, a pricing version on every
  charge (chosen).**
- **Flat prices per run.** They drift from cost and over- or under-charge by
  run size.
- **Prices in code.** Every change needs a release.
- **Prices in the database.** It is another mutable store to secure and
  audit, read on every charge, with no review on a change.
- **Billing from the AWS bill after the fact.** The bill comes monthly and
  per account, so it can't be tied to a run, shown when the run ends, or
  checked against a balance before the run starts.

## 4. Remediation

Known gaps are listed in [remediation/029.md](remediation/029.md).
