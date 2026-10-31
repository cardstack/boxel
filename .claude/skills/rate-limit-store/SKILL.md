---
name: rate-limit-store
description: Developer note on the realm server's shared counter store for rate limits and budgets that aren't the anonymous limiter's — `DBRateLimitStore` (`packages/runtime-common/rate-limit-store.ts`) over the `rate_limit_buckets` and `rate_limit_budgets` tables. Covers the token-bucket `take(key, {burst, refillPerMinute}, cost)`, the per-period budget `spend` / `budget` (UTC day or month), how keys are composed (`counterKey`), the refusal shapes and how callers answer them (429 `rate-limited`, 503 `rate-limit-unavailable`), the fail-closed rule, sweeping, clock handling, and how it relates to the anonymous limiter (`DBAnonymousRateLimiter`, `anonymous_grant_rate_limits`), which it does not replace. Use when adding a per-caller rate limit or a share/key budget, wiring a limit into a route or operation, changing either table, or reading why a caller was refused by a limit that isn't the anonymous one.
allowed-tools: Read, Grep, Glob, Bash
---

# Rate-limit store

`DBRateLimitStore` keeps rate limits and budgets in the database, so a limit holds across every realm-server process and across a restart. Each statement is the same on Postgres and SQLite. The tests are in `packages/realm-server/tests/rate-limit-store-test.ts`.

## Keys

A key is a string the caller composes. Build it with `counterKey(...parts)`, for example `counterKey(shareId, callerId)`. The parts are JSON-encoded, so two different lists of parts can never make the same key, whatever characters a part contains. A token bucket and a budget never share a count, even under the same key. A day budget and a month budget under one key are also counted separately.

## Token buckets

`take(key, { burst, refillPerMinute }, cost = 1)`:

- A key nothing has taken from yet is a full bucket of `burst` tokens. The bucket refills continuously at `refillPerMinute` and never holds more than `burst`.
- A take is all or nothing: one upsert takes `cost` tokens only when that many are there. Concurrent takes from any number of processes never admit more than the bucket holds.
- An admission returns `{ admitted: true, remaining }`, where `remaining` is the whole tokens left. A refusal returns `{ admitted: false, retryAfterSeconds }`, the time until `cost` tokens will have refilled. A refusal spends nothing, so a caller who keeps retrying gets in as soon as the tokens are back. The retry time comes from a second read and can be slightly stale.
- A `cost` larger than `burst` is never admitted. The refusal gives the time to refill a full bucket.
- `peek(key, limit, cost = 1)` answers what a take would, without taking: readiness uses it to say `rate-limited` before a call is made.
- `refund(key, limit, cost = 1)` puts back tokens an admitted take took, never past a full bucket, for a caller that took them and then didn't do the work. `unspend(key, {period, resetsAt}, cost = 1)` does the same for a budget, in the period the spend's `resetsAt` names, never below zero. Both answer false, after logging, when the store can't be written.
- The row stores the level at `refilled_at`, in epoch milliseconds from the store's clock. A process whose clock is behind the row gets no refill and does not move `refilled_at` or `expires_at` backwards, so a sweep never deletes a bucket that is still refilling.

## Budgets

`spend(key, { period, limit }, cost = 1)` and `budget(key, { period, limit })`:

- `period` is `day` or `month`, as calendar periods in UTC. A budget resets at midnight UTC, or at midnight UTC on the first of the month.
- `spend` is all or nothing, like a take. An admission returns `{ admitted: true, used, resetsAt }`, with `resetsAt` in epoch seconds. A refusal returns `{ admitted: false, retryAfterSeconds }`, the time until the period turns.
- `budget` returns the same answer without spending anything. Use it to ask before doing the work and to show what is left.

## Refusals and failing closed

- A refusal for lack of capacity has the same shape as the anonymous limiter's (`RateLimited`). Callers answer it like `anonymousCountRefusal` does: 429, code `rate-limited`, with `Retry-After` from `retryAfterSeconds`.
- When the store can't be read or written, every method returns `{ admitted: false, unavailable: true }` (`RateLimitUnavailable`; test with `isRateLimitUnavailable`) and logs a warning on the `rate-limit-store` channel. It never throws for a database failure, and it never admits a caller it couldn't count. Callers answer this as 503 `rate-limit-unavailable`.
- Arguments that are not a limit throw instead: a burst, limit or cost that is not a whole number of at least one, or a refill rate that is not positive. These are bugs in the caller, so validate configured values before they reach the store.

## Sweeping

About one take or spend in `SWEEP_EVERY` (200) deletes rows whose `expires_at` has passed, without awaiting it. A budget row expires when its period ends. A bucket row expires once the bucket would be full again even from empty, and a missing row also reads as a full bucket, so deleting it changes nothing.

## The anonymous limiter

`DBAnonymousRateLimiter` counts callers who aren't signed in, per realm, grant and address, in fixed windows in `anonymous_grant_rate_limits`. It is configured by `BOXEL_ANONYMOUS_RATE_LIMIT` and by the grant's rate-limit expressions. It shares the refusal shape with this store and nothing else, so changes here don't touch it, and its tests (`anonymous-rate-limiter-test.ts`) must keep passing unchanged.
