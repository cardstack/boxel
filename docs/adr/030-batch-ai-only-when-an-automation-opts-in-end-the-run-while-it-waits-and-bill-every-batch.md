---
status: proposed
date: 2026-11-10
scope:
  - packages/host/app/lib/realm-runner/research.ts
  - packages/realm-server/handlers/handle-request-forward.ts
  - packages/realm-server/lib/allowed-proxy-destinations.ts
  - packages/realm-server/**/*ai-batch*
  - packages/realm-server/**/*openrouter-batch*
  - packages/realm-server/**/*batch-settle*
  - packages/realm-server/lib/credit-strategies.ts
  - packages/billing/ai-billing.ts
  - packages/runtime-common/**/*ai-batch*
  - packages/postgres/migrations/*ai-batch*
---

# 030. Batch AI only when an automation opts in, end the run while it waits, and bill every batch

OpenRouter's Batch API answers AI requests at about half price, at any time
within 24 hours. An automation may use it only when its card opts in. A run
that submits a batch ends without waiting, and a follow-up run picks up the
results. A batch can't be canceled, so every batch is billed, and caps and
balances assume the worst case of paying for the batch and the same requests
at the normal price.

## 1. Decision

### 1.1. Opt-in, automations only

An automation MUST batch AI requests only when its card turns on
`batchedAI`. The realm server MUST refuse `resolve.batch` from a run whose
automation has not opted in. The interactive surface MUST NOT have
`resolve.batch`. The request-forwarding service MUST accept a batch submit or
status call only with a run token. A Preview MUST NOT submit a batch. It
sends the requests at the normal price.

### 1.2. Submitting ends the run

A run that submits a batch MUST finish and commit as usual. A worker or a tab
MUST NOT wait on a batch. Each batch MUST get exactly one follow-up run, with
a `dedupeKey` for the batch. The follow-up MUST start at the deadline the
script set, at most 24 hours after the submit, or earlier when the batch
reaches a final state. The follow-up MUST act as, and be billed to, the
submitting run's identity.

OpenRouter's completion webhook MUST start the follow-up only after its
`X-OpenRouter-Signature` checks out, and MUST drop a repeat by its
`X-OpenRouter-Idempotency-Key`. The minute tick MUST also check open
batches, so that a lost webhook only delays the follow-up until its deadline.

### 1.3. A missed deadline falls back to the normal price

If the batch has not completed when its follow-up starts, the follow-up MUST
send the same requests at the normal price. The platform MUST NOT try to
cancel a batch.

### 1.4. Every batch is billed

A submitted batch MUST be billed whether or not its results are used. A
settle job MUST bill each batch once, when it reaches a final state, at the
cost OpenRouter reports times the margin that metered charges use. A batch
that ends with no reported cost MUST be billed at the batch price of its
requests, estimated at submit, times the same margin. For an automation that
opts in, its caps, the minimum balance and its estimate MUST count its AI at
twice the normal price. That factor bounds spending and MUST NOT be charged.

## 2. Rationale

Automation runs rarely have someone waiting, so many of their AI requests
can take the cheaper, slower path. Most batches finish in minutes, but some
take hours, so the cheaper path is a choice an automation's author makes, not
a default.

A batch can't be canceled: OpenRouter has no cancel endpoint, and a running
batch can't be deleted. So once submitted, a batch is paid for, and any
design that stops waiting for it must still bill it. Holding a tab while a
batch waits would tie up the scarcest resource the platform has, for up to a
day. Ending the run and continuing in a follow-up costs nothing while the
batch waits. The realm is the state, so the follow-up picks up where the
first run left off.

A missed deadline pays for the batch and for the same requests at the normal
price. A batch costs at most the normal price: the discount is typically
half, but it varies by model, and web-search calls in a batch bill at the
standard rate. So counting opted-in AI at twice the normal price in caps and
the minimum balance means a missed deadline can't overspend. It only reserves
headroom; each charge is still the price actually paid.
OpenRouter's docs report the cost of a completed batch. They don't say
whether an expired one is charged. Billing it at the submit estimate means we
never pay for work we didn't bill.

The interactive surface has a person waiting for an answer, so a batch there
would only be slower. Limiting batch calls to run tokens keeps them tied to a
run that the platform will bill and follow up.

## 3. Considered options

- **Opt-in, end the run, continue in a follow-up, bill every batch
  (chosen).**
- **Hold the tab while the batch waits.** A tab is held for up to 24 hours,
  out of a pool of 10–20 per server.
- **Cancel the batch at the deadline.** OpenRouter has no cancel endpoint.
- **Batch interactive calls.** A person is waiting, so a batch only makes
  the answer slower.
- **Bill only completed batches.** An expired or late batch we stopped
  waiting for may still cost us, and we would not recover it.

## 4. Sources

- OpenRouter, [Batch API guide](https://openrouter.ai/docs/guides/features/batch-api):
  batch requests are typically billed at 50% of the standard per-token price,
  each model page shows its batch price, web-search calls in a batch bill at
  standard rates, and `usage.cost` reports the cost of a completed batch.
- OpenRouter, [Batch quickstart](https://openrouter.ai/docs/batch-quickstart):
  there is no cancel endpoint, and a running batch returns `409` to a delete.
  `completion_window` accepts only `24h`. With a `callback_url`, OpenRouter
  sends one `POST` when a batch reaches a final status (`batch.completed`,
  `batch.failed`, `batch.expired`, `batch.cancelled`), signed with
  `X-OpenRouter-Signature` and keyed by `X-OpenRouter-Idempotency-Key`. The
  event holds only the batch's id.
- OpenRouter, [Batch API announcement](https://openrouter.ai/blog/announcements/batch-api):
  the median batch in the beta finished in 7 minutes.

## 5. Remediation

Known gaps are listed in [remediation/030.md](remediation/030.md).
