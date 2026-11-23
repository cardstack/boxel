---
status: proposed
date: 2026-11-23
scope:
  - packages/host/app/components/**
  - packages/host/app/lib/format-token-usage.ts
  - packages/host/app/tools/read-automation-run.ts
  - packages/host/app/lib/realm-runner/credits.ts
  - packages/base/**/*.gts
---

# 049. Show an end user cost only as the Boxel credits charged, never as a unit cost

A person using Boxel pays in Boxel credits, and every place the product shows
what something cost says so in the credits Boxel charged, or will charge, for
the thing: the charge's own figure, margin included. A unit cost (what an AI
provider, a hosting provider or a vendor charges Boxel, in dollars or per
token, per request or per unit of usage) never reaches a screen an end user
sees, either as itself or converted into credits, so no figure on a screen
can be worked back to what Boxel pays.

## 1. Decision

### 1.1. Credits charged only

A surface an end user sees (the host app, a card's views in any realm,
including the catalog's, and anything the AI assistant writes into a room)
MUST show what usage cost only as the Boxel credits Boxel charged for the
usage, as the credits ledger records the charge, margin included (ADR 029
§1.1). For usage still in flight or not yet made, the figure MUST be the
credits Boxel holds or estimates, priced exactly as the charge will be: the
unit cost times the charge's margin, times `CREDITS_PER_USD`.

### 1.2. No unit cost

Such a surface MUST NOT show a unit cost: a provider's price or charge for a
request (a USD cost per AI request or per call), a price per token, per
request or per unit of compute, network, indexing or storage, or the margin
Boxel charges over a provider's cost.

### 1.3. No credits worked out from a unit cost

Such a surface MUST NOT turn a unit cost into credits itself, for example
`costUsd × CREDITS_PER_USD` on the client. That figure is the cost before the
margin, so dividing it by `CREDITS_PER_USD` gives the unit cost back, and it
differs from the charge whenever the margin isn't 1. A surface MUST read the
credits a charge records, or an estimate the server prices as §1.1 says.

### 1.4. Unit costs in data stay unshown

Data a surface reads MAY carry a unit cost, such as an AI request's
`costInUsd` in an automation run's report or a turn's `costUsd` in a usage
event. A surface MUST NOT render that field or anything computed from it.

### 1.5. Who counts as an end user

Operator and developer surfaces (Grafana dashboards, server logs, Claude
skills for people working on Boxel, the billing package's reports) are not
end-user surfaces, and MAY show unit costs.

## 2. Rationale

Credits are the one unit a person both pays and spends, so a cost shown in
credits answers the question the person has: how much of the balance did this
take. A unit cost answers a different question, Boxel's own cost, and a
person who can read it, directly or as credits worked out at the cost before
the margin, can set it beside the credits charged and read the margin off the
difference. A unit cost also changes with each pricing version (ADR 029
§1.3), while the credits a charge recorded don't. Showing the charge's own
credits keeps one figure for one spend, the figure the balance actually lost.

## 3. Considered options

- **Credits only, with unit costs kept out of every end-user surface.** Chosen:
  one unit, the one the person pays in.
- **Show the unit cost beside the credits, as a detail.** Rejected: it exposes
  the margin and the providers' prices, and a person has no use for it, since
  credits are what the balance loses.
- **Convert a provider cost to credits on the client.** Rejected (§1.3): the
  result is the cost before the margin, which gives the unit cost back and
  disagrees with the charge whenever the margin isn't 1.
- **Strip unit costs from every payload a client reads.** Not required: an
  operator tool reads the same payloads, and a field a surface never renders
  shows nothing. A payload MAY drop one where no reader needs it.
- **Allow a relative price tier (a model picker's `$` to `$$$$`).** A tier
  ranks options and states no cost, so §1.2 doesn't forbid it.

## 4. Open questions

- An AI or batched AI charge is the provider's cost with no margin (ADR 029
  §1.1), so the credits charged for AI divide back to the provider's cost
  exactly, even when a surface shows only the charge as §1.1 requires. Keeping
  AI's unit cost unreadable needs a margin on AI charges, which is a change to
  ADR 029, not to this ADR.

## 5. Remediation

Known gaps are listed in [remediation/049.md](remediation/049.md).
