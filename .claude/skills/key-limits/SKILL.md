---
name: key-limits
description: Operate and diagnose the limits a key's owner sets on how much of it anyone spends — the per-caller token bucket and the daily and monthly call budgets on each share (`key_shares`) and personal key (`user_keys`), the platform defaults (`KEY_RATE_LIMIT_BURST`, `KEY_RATE_LIMIT_REFILL_PER_MINUTE`, `KEY_DAILY_BUDGET`, `KEY_BUDGET_HIGH_WATER_PERCENT`), the `PUT /_key-shares/:id/limits` and `PUT /_user-keys/:id/limits` routes, the high-water and budget notices in `key_limit_notices`, the `boxel:key-limits` log channel, and the `rate-limited` / `over-budget` / `rate-limit-unavailable` refusals a `callApi` gets and what readiness answers. Use when a user reports a card refused `rate-limited` or `over-budget`, a 503 `rate-limit-unavailable` from an operation, a limit they can't change, a notice they did or didn't get, when reading the limits or counters as an operator, or when changing `lib/key-limits.ts` or `lib/key-limit-settings.ts`.
---

# Key limits (operators)

No credits change hands for a user's key, so a caller's balance limits
nothing. The key's owner sets limits instead, and they do the whole job of
bounding how much of the key anyone spends. The code is
`packages/realm-server/lib/key-limits.ts` (enforcement, notices, setting
them) and `lib/key-limit-settings.ts` (the defaults and how a row's limits
read). The counters are the shared rate-limit store (see the
`rate-limit-store` skill).

## What is limited, and what isn't

- **Interactive `callApi` calls only**: an invocation carrying a user's
  session — a card in the browser, the AI assistant, the CLI. A pipeline (a
  run the realm server makes as its payer, `Realm.handlePipeline`) counts
  against nothing; it is bounded by its schedule's payer and caps.
- **Against the share or the key filling each slot.** An `{{apiKey}}` slot
  counts against the share it is filled from; a `{{userKey}}` slot against
  the caller's own key. A binding carries no limits. A call whose two slots
  are filled from one share counts once.
- **Two limits each:**
  - a **token bucket per caller**: `rate_burst` calls at once, refilled at
    `rate_refill_per_minute`;
  - a **daily and a monthly budget** of calls, across every caller, in UTC
    days and months (`daily_budget`, `monthly_budget`).

These are call budgets, not money budgets: the platform can count calls, not
what a vendor charges for one.

## Defaults

A null column is the platform's default, so a share or key nobody set limits
on is still limited.

| Setting                            | Default                        | Derivation                                                          |
| ---------------------------------- | ------------------------------ | ------------------------------------------------------------------- |
| `KEY_RATE_LIMIT_BURST`             | 25                             | One whole refresh of a pull-request inbox: 25 calls every 5 minutes |
| `KEY_RATE_LIMIT_REFILL_PER_MINUTE` | 15                             | Three open tabs on that schedule: 3 × 25 / 5                        |
| `KEY_DAILY_BUDGET`                 | 2400                           | That inbox open through an 8-hour working day                       |
| `KEY_BUDGET_HIGH_WATER_PERCENT`    | 80                             | The share of a budget at which owners are told use is high          |
| monthly budget                     | 30 × the daily budget in force | Not a setting; an owner who sets the daily budget moves it too      |

A value that isn't a limit stops the realm server at startup rather than
leaving keys unlimited.

## How a call is counted

Once every slot has passed its other checks (binding, fingerprint,
interactive approval, grant, rejection), and before any rejected grant's
probe is claimed or any key is opened:

1. each share's or key's daily and monthly budgets are **read** (nothing
   spent);
2. the caller's **bucket is taken from**;
3. the **budgets are spent**, and a spend that reaches the high-water mark or
   the budget records the notices.

So a call refused for want of budget takes no token, and a refusal uses up no
probe. Two calls racing for a budget's last unit can leave one holding a token
it didn't use.

## Refusals

| Code                     | Status | When                                                    | `Retry-After`                            |
| ------------------------ | ------ | ------------------------------------------------------- | ---------------------------------------- |
| `rate-limited`           | 429    | The caller's bucket for that share or key is empty      | Seconds until one call has refilled      |
| `over-budget`            | 429    | The share's or key's daily or monthly budget is used up | Seconds until the UTC day or month turns |
| `rate-limit-unavailable` | 503    | The counters couldn't be read or written; nothing sent  | 5                                        |

Each carries `meta.retryAfterSeconds` as well as the header. A share's
refusal never names its budget, its count or its owner: a reader is told only
that the realm's limit is reached and when it resets.

**Readiness** (`lib/key-readiness.ts`) asks the same counters without
spending: `over-budget` when a budget is used up, `rate-limited` when the
caller's bucket is empty (`DBRateLimitStore.peek`). Counters that can't be
read answer `ready` there, since readiness is advisory and the call refuses
`rate-limit-unavailable` itself.

A `rate-limit-unavailable` is a database problem, not a limit: check the
`rate-limit-store` channel's warnings (`couldn't … for …, refusing`) and the
`rate_limit_buckets` / `rate_limit_budgets` tables.

## Reading a refusal

Every refusal is one JSON line on the `boxel:key-limits` channel:

```json
{
  "channel": "boxel:key-limits",
  "event": "refused",
  "code": "over-budget",
  "share": "<id>",
  "key": null,
  "caller": "@someone:boxel.ai",
  "realm": "https://…/",
  "operation": "listPRs",
  "limit": { "period": "day", "budget": 2400 },
  "retryAfterSeconds": 3600
}
```

`share` or `key` names what the call counted against; `limit` is the limit
that refused it (`{rateBurst, rateRefillPerMinute}` or `{period, budget}`),
absent for `rate-limit-unavailable`. A threshold crossing logs
`"event":"threshold"` with `threshold` (`high-water` or `budget`), `period`,
`budget` and `used`.

The counters themselves, under keys built with `counterKey`:

```sql
-- A share's budget use this period. budget_key is ["key-limit","share","<id>"].
SELECT period, period_start, count, expires_at
FROM rate_limit_budgets WHERE budget_key = '["key-limit","share","<share-id>"]';

-- One caller's bucket for a personal key.
SELECT tokens, refilled_at FROM rate_limit_buckets
WHERE bucket_key = '["key-limit","key","<key-id>","@someone:boxel.ai"]';
```

## Who changes them

Only the key's owner — for a share, the owner of the key it holds — and only
with a session signed in on the secure origin, from a request whose `Origin`
is the secure origin or absent (the CLI), as for approving a binding. The
app's session, which card code holds, is refused 403, so a card can't raise
a limit. A realm's other direct writers are refused 403 on a share's limits;
they suspend a share they think is being abused. Anyone who can't see the
share, or another user's key, gets 404.

| Route                         | Body                                       |
| ----------------------------- | ------------------------------------------ |
| `PUT /_key-shares/:id/limits` | `{data: {type: 'key-limits', attributes}}` |
| `PUT /_user-keys/:id/limits`  | the same                                   |

`attributes` holds any of `rateBurst`, `rateRefillPerMinute`, `dailyBudget`,
`monthlyBudget`: a whole number of at least one (a positive number for the
refill), or null to go back to the default. One left out keeps what it was.
The answer is the limits in force, defaults filled in. A share's listing
(`GET /_key-shares`, for its owner and the realm's direct writers) and a key's
(`GET /_user-keys`, for its owner) carry `limits` the same way.

## Notices

`key_limit_notices` holds one row per recipient when a period's use reaches
the high-water mark and when it reaches the budget: the key's owner and, for a
share, each direct writer of the share's realm. A unique index on (share or
key, recipient, period, period end, threshold) keeps it to one each per
period, however many calls cross together. The label is copied, so it reads
after a rename. Withheld from `readonly_role` and the SQLite dump, like the
other key tables.

```sql
SELECT created_at, threshold, period, period_ends_at, budget, recipient, label, realm_url
FROM key_limit_notices WHERE share_id = '<id>' ORDER BY created_at DESC;
```

A notice that can't be recorded is logged on `realm:key-limits` and costs the
call nothing.
