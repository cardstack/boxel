---
status: proposed
date: 2026-11-23
scope:
  - packages/host/app/components/**
  - packages/host/app/lib/format-token-usage.ts
  - packages/host/app/tools/read-automation-run.ts
  - packages/host/app/lib/realm-runner/credits.ts
  - packages/base/**/*.gts
  - packages/realm-server/handlers/handle-request-forward.ts
  - packages/realm-server/handlers/handle-automations.ts
  - packages/runtime-common/automation-manual-runs.ts
  - packages/ai-bot/lib/responder.ts
---

# 049. Show an end user cost only as the Boxel credits charged, never as a unit cost

A person using Boxel pays in Boxel credits, and every place the product shows
what something cost says so in the credits Boxel charged, or will charge, for
the thing: the charge's own figure, margin included. A unit cost (what an AI
provider, a hosting provider or a vendor charges Boxel, in dollars or per
token, per request or per unit of usage) never reaches an end user, on a
screen or in data the person can read, either as itself or converted into
credits, so nothing an end user reads can be worked back to what Boxel pays.

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

### 1.4. No unit cost in what an end user can read

A route, event or other payload an end user can read MUST NOT carry a unit
cost. That includes what a realm's writers read from the realm server (an
automation run's report and log), what a room's members read in its events,
and anything a card reads with the viewer's session, since a card the viewer
opens may be one the viewer wrote. Data stored with a unit cost, such as a
log line written with one, MUST lose it before it is served.

### 1.5. Who counts as an end user

Operator and developer surfaces (Grafana dashboards, server logs, Claude
skills for people working on Boxel, the billing package's reports) are not
end-user surfaces, and MAY show unit costs.

## 2. Rationale

Boxel's unit costs and its margin are Boxel's own. A person who can read a
unit cost, on a screen, in a payload, or as credits worked out at the cost
before the margin, can set it beside the credits charged and read the margin
off the difference, so keeping the margin private means keeping unit costs
out of everything an end user can read, not only off the screens Boxel ships.
A card is code a writer can write, and it reads what its viewer can read, so
a field a shipped screen never renders is still readable.

Credits are also the one unit a person both pays and spends, so a cost shown
in credits answers the question the person has: how much of the balance did
this take. A unit cost changes with each pricing version (ADR 029 §1.3),
while the credits a charge recorded don't.

## 3. Considered options

- **Credits only, with unit costs kept out of everything an end user can
  read.** Chosen: one unit, the one the person pays in, and a margin no
  reader can work out.
- **Show the unit cost beside the credits, as a detail.** Rejected: it exposes
  the margin and the providers' prices, and a person has no use for it, since
  credits are what the balance loses.
- **Convert a provider cost to credits on the client.** Rejected (§1.3): the
  result is the cost before the margin, which gives the unit cost back and
  disagrees with the charge whenever the margin isn't 1.
- **Keep unit costs in payloads, and never render them.** Rejected: a card
  the viewer wrote reads the same payloads with the viewer's session and can
  render any field in them. Operators read unit costs where only operators
  can (the credits ledger, server logs and dashboards, §1.5).
- **Allow a relative price tier (a model picker's `$` to `$$$$`).** A tier
  ranks options and states no cost, so §1.2 doesn't forbid it.

## 4. Consequences

- An AI or batched AI charge is the provider's cost with no margin (ADR 029
  §1.1), so the credits charged for AI divide back to the provider's cost
  exactly, even though nothing an end user reads carries that cost. AI's unit
  cost stays readable this way until ADR 029 puts a margin on AI charges.
- An operator who needs a run's AI cost reads it from the credits ledger or
  the server's logs, not from the run's log or report.

## 5. Remediation

Known gaps are listed in [remediation/049.md](remediation/049.md).
