---
name: operations-diagnosis
description: Diagnose card operations and operation-permission policies from the realm server's own telemetry — the `boxel:operations` JSON channel (`kind`-less execution lines for operations that run a program, plus `policy-decision`, `policy-search-scope`, `policy-compile`, `policy-snapshot-read` and `capability-check` records), the `realm:policy` warnings (compile issues, predicate faults, withheld policy-card visits), and the "Policy Decisions" Grafana dashboard (uid `boxel-policy-decisions`). Answers the operator's questions rather than a realm owner's: (1) why did this user get a 403, a 404 or a 500 from a realm that has a policy — go from the account's Matrix id to its decision lines and read `outcome` / `reason` / `rules` / `grants` / `coarseDeclined`; (2) "the policy denied" versus "the policy couldn't be evaluated" — a predicate that threw answers a caller who may read the realm 500 `policy-predicate-failed` but a caller who may not the same 404 a denial gets, so the `realm:policy` fault line is the only signal there, and an unloadable policy is 500 `internal-error` for everyone; (3) which realm's policy won't compile and why, by issue code and `rules[i].grants[j].where` path, including a withheld index visit of the policy card that reads as `policy-card-unloadable` until the card is visited again; (4) a realm's grants stopped working after an edit — how long to wait (index visit plus the five-second revalidation bound) before concluding the new policy isn't live; (5) is the gate being reached more than it should be — gate reach, with capability checks excluded on `kind`; (6) which grant is matching everything — allows by grant, unconditional grants, distinct actors per grant, contributing search-lane grants; (7) a federated search silently missing a realm's rows (`meta.incomplete`, search-lane `failed`); (8) an operation built on `transform` refused, slow, or reading nothing — `outcome` / `code` / `totalMs` / read counts by tier / `missing[]`. Carries the traps: the `realm:policy` channel name is not on the line, no record carries a correlation id, a policy refusal never writes an execution line, a pending gate record is not a backlog, and the fault warning is rate-limited. For staging/prod this layers on `aws-access` and `tail-logs`; hand off to `policy-performance` for what a policy costs, to the boxel-skills `realm-policy-authoring` skill (explain / validate) for why one actor may or may not act on one card, to `realm-auth` for a refusal the gate never saw, and to `indexing-diagnostics` when the policy card itself won't index. Use when someone reports an unexpected 403/404/500 from a realm with a policy, a policy edit that "didn't take", a realm whose grants stopped working, a policy suspected of being wider than intended, a search missing rows, or a transform operation that refused or read stale values.
allowed-tools: Read, Grep, Glob, Bash
---

# Operations and policy diagnosis

A realm's ACL answers "may this caller read the realm, or write it?". A realm's policy — the `RealmPolicy` card its `realm.json` `policy` key names — widens that answer for a caller the ACL declined, one grant at a time. The gate (`packages/runtime-common/card-operations/gate.ts`) judges every invocation such a caller makes; the search lane (`card-operations/policy-query.ts`) composes the policy's query grants into every search such a caller runs; the realm keeps a compiled copy of the policy card (`RealmPolicyCache` in `card-operations/policy.ts`).

Each of those leaves a record, and this skill is about reading them to answer an operator's question: why did this user get refused, which realm's policy is broken, is the policy reached more than it should be, which grant admits too much. A realm owner asking about one `(actor, target, operation)` triple has a better tool than logs — see [When explain is the better tool](#when-explain-is-the-better-tool). For what a policy _costs_ (`evaluationMs`, `predicateMs`, compile durations) read `policy-performance`; this skill does not restate it.

## Where the lines come from

Two places, and they are read differently.

**`boxel:operations`** — one flat JSON object per line, `channel: "boxel:operations"`, the same `| json` convention as `boxel:client-perf` and `boxel:search-shape`. Every shape is defined in `card-operations/telemetry.ts`; its comments are the authority on what a field means. Six shapes share the channel, told apart by `kind`:

| `kind`                 | one line per                                                                               | emitted from                             |
| ---------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------- |
| _(absent)_             | execution of an operation built on `transform`: committed, or refused while staging        | `executors.ts`, `coordinator.ts`         |
| `policy-decision`      | gate decision for a caller the ACL declined; for a write left to the lock, also the lock's | `gate.ts`                                |
| `policy-search-scope`  | realm a search consulted only through its policy                                           | `policy-query.ts`                        |
| `policy-compile`       | read of a realm's policy card by its cache — a compile or a revalidation                   | `policy.ts`                              |
| `policy-snapshot-read` | evaluation of a predicate annotated `snapshot: true` (judged against the index row)        | `gate.ts`                                |
| `capability-check`     | successful `POST <realm>/_capabilities` request                                            | `Realm#handleCapabilities` in `realm.ts` |

**`realm:policy`** — plain-text warnings from the policy compiler and the gate, plus one from the search handler on `realm-server:search`. The logger name is **not printed on the line**: the realm server writes the bare message, so `|= "realm:policy"` matches nothing. Filter on the message text instead:

| message begins / contains                                                                                     | level | from                    | means                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------- | ----- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `the policy <card> compiled with issues that leave part of it inactive: <path>: <code>; …`                    | warn  | `policy.ts` `logIssues` | one line per compile; each named part admits nothing. `(card)` as the path is the whole policy                                        |
| `the policy <card> compiled with warnings on grants that stay live: …`                                        | info  | `policy.ts` `logIssues` | one line per compile; the grants are live and reach something the author should know about                                            |
| `a predicate in the policy of realm <realm> threw while deciding whether <actor> may invoke`                  | warn  | `gate.ts` `logThrow`    | a predicate fault: names the realm, the actor, the operation, the card judged, the grant's path, the policy card and the error's kind |
| `the policy card <card> could not be indexed again after its latest visit was withheld`                       | warn  | `policy.ts`             | the cache asked for a fresh index visit of a withheld policy card and that visit failed                                               |
| `refreshing the compiled policy <card> after <realm> was indexed failed`                                      | warn  | `policy.ts`             | the background revalidation after an index move threw                                                                                 |
| `could not record a <kind> on boxel:operations`                                                               | warn  | `telemetry.ts`          | a record failed to emit; the decision it described stood                                                                              |
| `the policy of <realm> could not be judged for a search, so the search is answered without that realm's rows` | warn  | `handle-search.ts`      | federated search left a realm out and set `meta.incomplete`                                                                           |

No line on either channel carries card content or a predicate's source. Rules and grants are named by their position in the policy card (`rules[2].grants[1]`); read the card, or run validate on it, for what they hold. An issue line names a code and a path, never the issue's message — the messages are what validate answers.

## The traps

Each of these produces a believable wrong conclusion.

### 1. An absent decision line means the gate was never reached

A caller the ACL allows is never judged by the policy and writes nothing. So "no `policy-decision` line for this user" means either the ACL let them through (and whatever refused them was not the policy), or the request was refused before the gate — by authentication (`realm-auth`), on a route no grant reaches (the directory listing, module source), or by an archived realm's seal. It never means "the policy allowed it silently".

### 2. What the caller saw depends on `coarseDeclined`, not on the reason

The gate's reason is the same whoever asked; what the caller is told is not. `refusalForNonReader` (`card-operations/types.ts`) rewrites every `operation-not-permitted`, `policy-predicate-failed` and `target-not-found` to a constant 404 `no such target` for a caller who may not read the realm, so a refusal says nothing about which cards exist.

| `coarseDeclined` on the line | the caller                    | `deny` (any reason)                                      | `error` / `predicate-threw`   | `error` / `policy-unavailable`                   |
| ---------------------------- | ----------------------------- | -------------------------------------------------------- | ----------------------------- | ------------------------------------------------ |
| `writes`                     | may read the realm, not write | 403 `operation-not-permitted` (404 for `target-missing`) | 500 `policy-predicate-failed` | 500 `internal-error`, title `Policy unavailable` |
| `all`                        | may not read the realm        | 404 `target-not-found`                                   | **404 `target-not-found`**    | 500 `internal-error`, title `Policy unavailable` |

The bold cell is why a 404 report from a non-reader always warrants a look at the fault lines: a policy fault and a denial are indistinguishable on the wire there. An unloadable policy is a 500 for everyone; for a non-reader it is answered before the target resolves, so the decision line's `base` and `targetType` are null.

### 3. No record carries a correlation id or the target URL

`policy-decision` names `targetType`, never the card. The join from a user's request to its decision is `realmURL` + `actor` + the timestamp, cross-checked against `operation` and `route`. For the card itself, read the realm server's request lines (`--> <METHOD> <accept> <url>: <status> … dur=<n>ms`) at the same moment, or the fault line, which does name the card it judged. Execution lines do carry `target`.

### 4. A policy refusal never writes an execution line

Execution lines exist only for operations built on `transform` (the only base that runs a program; `base` is always `transform`). A write the gate refuses is refused before it stages, and a write left to the lock is admitted or refused before it stages too, so neither leaves a `kind`-less line. An execution line's `code` is the program's or the stager's refusal — `assertion-failed`, `invalid-params`, `version-conflict`, `target-not-indexed`, `target-errored`, `internal-error` and their kin — never the policy's. For a policy refusal, read `policy-decision`.

### 5. `pending` is not a backlog

A write the gate matched a grant for and left to its predicate records `outcome: "pending"` at the gate and its final decision under the lock (`decidedAt: "lock"`). A `pending` with no lock record after it is a write whose request ended before the lock — a failed batch, an aborted request, an explain — not one still waiting. Count real decisions with `outcome=~"allow|deny|error"`, as the dashboard does.

### 6. Explain and capability checks are not traffic

An explain runs the gate for an actor it names and records its decisions with `hypothetical: true`; leave those out of anything you count. A capability check records no decision, no search-scope line and no snapshot read — only its own `capability-check` line — because a view asks about every control it renders at the rate it renders. Gate reach is `policy-decision` with `decidedAt="gate"`, which excludes checks by construction; a panel that counted every `boxel:operations` line would report the shape of a template, not of the traffic. That is the only reason checks carry a `kind`: an execution line has none, so filtering on `kind` is what keeps them apart.

### 7. The fault warning is rate-limited and wider than the decision count

`logThrow` writes at most one line per compiled predicate per minute, and starts over when the policy is compiled again. It also fires for throws under an explain or a capability check, which `reason="predicate-threw"` decision lines leave out. So the decision lines give the rate, and the warning gives the error's kind and the card it threw on. A draft's throw (an explain against a draft policy) is never logged.

### 8. Compiles are per process and read-driven

Every realm-server task holds its own cache, so one edit produces one compile per task that reads the policy. A revalidation happens when a read finds the cached policy stale, not on a timer, so a realm whose policy nobody reads writes no `policy-compile` lines at all — silence after an edit is not evidence of anything until someone the policy judges makes a request.

## Querying it

For staging/prod, read **`aws-access`** first (the AWS session and Loki auth); `tail-logs` wraps the Loki plumbing. Keep the `|=` line filter ahead of the first `| json`, or the parser reads every realm-server line in the range and the query times out. Deployed lines arrive wrapped by the log router, so unwrap before the real parse:

```logql
{service="realm-server", env="$env"} |= "boxel:operations" | json
  | line_format "{{ if .log }}{{ .log }}{{ else }}{{ __line__ }}{{ end }}" | json
  | channel="boxel:operations"
```

The recipes write `<ops>` for that selector; substitute it inline before pasting into Grafana Explore. Locally the stream is `env="local"` (see `client-perf-diagnosis` for bringing up the local observability stack). The placeholders `@alice:example.com` and `https://realms.example.com/alice/notes/` stand for the account and realm you are investigating.

From a laptop, the same lines as raw JSON for `jq`:

```bash
packages/observability/scripts/tail-logs.sh --env staging --service realm-server \
  --filter '"kind":"policy-decision"' --since 1h --no-follow --limit 5000

packages/observability/scripts/tail-logs.sh --env staging --service realm-server \
  --filter 'a predicate in the policy of realm' --since 6h --no-follow
```

`--filter` is a literal substring, and the realm server writes the JSON without spaces (`"kind":"policy-decision"`). Production needs `--confirm`. `policy-performance` has the `jq` unwrap for firelens-wrapped lines.

## Reading a decision line

The fields that answer "why" (cost fields are `policy-performance`'s):

- `outcome` — `allow`, `deny`, `error`, or `pending` (trap 5).
- `reason` — `granted`; `pending`; a refusal before any predicate ran: `non-grantable` (the operation is declared `nonGrantable`, or is an explain or a validate), `query-lane` (a query, which only the search lane grants), `authorization-infrastructure` (the realm's policy card or config card, or any policy card), `unmatchable-target` (a card whose index row is an error row, a type for anything but `create`, a file for anything but `readSource`, or stored bytes with no type, such as module source), `no-grant` (no rule on the type has a grant for the operation, or the realm names no policy at all); `predicate` (every matching grant's predicate ran and none held); `target-missing` (no index row); `stored-card-refused` (under the lock: the card is gone, stored as another type, or stored as a policy card); `policy-unavailable` (the policy did not compile); `predicate-threw`; `gate-failed` (anything else that threw).
- `rules` / `grants` — every rule matched on the target's type and every grant in them for the operation, comma-separated in policy order: what a denial was judged by. Empty `rules` means no rule governs the type; `rules` with empty `grants` means a rule governs it but grants nothing under that name.
- `rule` / `grant` — the one that admitted the invocation; null on anything but an allow.
- `tier` — `none` (no predicate ran), `stored` (the card's own source), `snapshot` (at least one read the index row).
- `coarseDeclined`, `decidedAt`, `transport` / `route` (`envelope _operations`, `card-json GET|HEAD|POST|PATCH|DELETE`, `byte-route source|module`, `explain`, `internal`), `operation` (the invoked name), `base`, `targetType`, `actor`, `realmURL`, `hypothetical`.

## Investigation: a user reports an unexpected 403, 404 or 500

You have an account, a realm, a rough time, and a status.

**Step 1 — confirm the request.** Find the realm server's own line for it, which carries the URL and the status:

```bash
packages/observability/scripts/tail-logs.sh --env staging --service realm-server \
  --regex '--> [A-Z]+ .*realms\.example\.com/alice/notes/.*: (403|404|500)' --since 2h --no-follow
```

**Step 2 — the decisions for that account in that realm.**

```logql
<ops> | kind="policy-decision" | actor="@alice:example.com"
  | realmURL=~".*realms.example.com/alice/notes/.*" | hypothetical="false"
  | line_format "{{.decidedAt}} {{.outcome}} {{.reason}} op={{.operation}} via={{.transport}} {{.route}} declined={{.coarseDeclined}} type={{.targetType}} rules={{.rules}} grants={{.grants}} tier={{.tier}}"
```

None at that moment → trap 1: the gate was never reached; hand off to `realm-auth`. Several → line them up with step 1 by time and `route`.

**Step 3 — read the reason against the status** (trap 2):

- `deny` / `no-grant` — the policy grants nothing for that operation on that type. If `rules` is empty, no rule names the type or a type it descends from, or the realm names no policy.
- `deny` / `predicate` — the listed grants matched and their predicates didn't hold for this actor and card. _Why_ they didn't hold is explain's question, not the logs'.
- `deny` / `non-grantable`, `authorization-infrastructure`, `query-lane`, `unmatchable-target` — refused by design whatever the policy holds. `unmatchable-target` on a card usually means its index row is an error row; `indexing-diagnostics` reads that.
- `error` / `predicate-threw` — step 4.
- `error` / `policy-unavailable` — the next investigation.
- `deny` / `target-missing` — the index has no row for the card; it is a 404 to everyone, policy or not.

**Step 4 — for a predicate fault, read the fault line.** It names the card the predicate threw on and the grant's path, and is the only record of the fault a non-reader's 404 leaves:

```logql
{service="realm-server", env="$env"} |= "a predicate in the policy of realm" |= "realms.example.com/alice/notes/"
```

The error kind ends the line — `BxlTransformError (evaluate)` and the like; the phase (`parse`, `profile` or `evaluate`) separates a predicate that cannot run at all from one that failed on the values it was handed. Then hand the grant path and the card to explain, which reports the throw against that card.

## Investigation: a realm's grants stopped working after an edit

Symptoms: callers the policy admitted before the edit are refused, often with a 500.

**Step 1 — does the policy compile?**

```logql
sum by (realmURL, outcome, uncompilable) (count_over_time(<ops> | kind="policy-compile" [5m]))

<ops> | kind="policy-compile" | realmURL=~".*realms.example.com/alice/notes/.*"
  | line_format "{{.outcome}} uncompilable={{.uncompilable}} rules={{.rules}} grants={{.grants}} issues={{.issues}} card={{.card}}"
```

`uncompilable=true` with `rules=0` is a policy that refuses every caller it judges with a 500 (`reason="policy-unavailable"` on their decision lines). `uncompilable=false` with `issues > 0` is a policy that compiled with parts left out.

**Step 2 — which issue.** The compile warning names each by path and code:

```logql
{service="realm-server", env="$env"} |= "compiled with issues that leave part of it inactive" |= "realms.example.com/alice/"
```

Whole-policy codes (path `(card)`): `policy-card-missing` (the pointer names a card the index doesn't hold), `policy-card-unloadable` (the index holds it only as an error, or its latest visit was withheld), `not-a-policy`, `invalid-rule` at the top level. Rule- and grant-level codes name a path like `rules[1].targetType` or `rules[1].grants[0].where`: `unresolved-type`, `grants-module-source`, `invalid-grant`, `unknown-operation`, `grants-invalid-operation`, `grants-authorization-infrastructure`, `invalid-predicate`, `partial-match`, `policy-not-filterable`, `unsnapshotted-policy-read`. The full list with meanings is `PolicyIssueCode` in `card-operations/types.ts`. A grant left out for one of these admits nothing; the rest of the policy still applies.

**Step 3 — `policy-card-unloadable` after a healthy edit is usually a withheld visit.** When an index visit of the policy card fails with the failure kept off its row, the row reads as healthy but what it holds is an earlier visit's, so the card compiles to no rules and every declined caller gets a 500. Nothing else would visit it again, so the cache asks for a fresh visit itself the moment it reads such a row, and then at most once a minute while the cause lasts. Expect the policy back within about a minute of the cause clearing, plus however long the visit waits in the queue. A visit that fails outright logs `could not be indexed again after its latest visit was withheld`. If it stays unloadable, the card itself won't index: `indexing-diagnostics`.

**Step 4 — is the edited policy live yet?** An edit reaches the gate in two steps: the policy card's index visit commits, and that index move makes every process's cache revalidate, in the background, before the next read. A move the process never hears about is caught by the staleness bound: a cached policy is answered from memory for at most **five seconds** without a revalidation (`MAX_UNVALIDATED_MS` in `policy.ts`). So wait for the card's indexing to finish, then five seconds, then make a request the policy judges. A `policy-compile` line with `outcome="compiled"` after that request means the new policy is in force on that task; `revalidated` means the cache read the card and found the version it already held — the edit has not been indexed. An edit to a type a rule names recompiles too; an edit to an unrelated card costs a revalidation and no compile.

## Investigation: a policy is suspected of being wider than intended

**Which grants admit, and how often:**

```logql
sum by (realmURL, grant) (count_over_time(<ops> | kind="policy-decision" | outcome="allow" | hypothetical="false" [24h]))
```

**Which of those admit with no condition** — an allow where no predicate ran is a grant with no `where`:

```logql
sum by (realmURL, grant, operation) (count_over_time(<ops> | kind="policy-decision" | outcome="allow" | tier="none" | hypothetical="false" [24h]))
```

**How many distinct callers each grant admits** — a grant meant for one person that admits many is the finding:

```logql
count by (realmURL, grant) (sum by (realmURL, grant, actor) (count_over_time(<ops> | kind="policy-decision" | outcome="allow" | hypothetical="false" [24h])))
```

**What the search lane hands out** — a query grant decides the most cards of any, since it composes a filter rather than judging one card:

```logql
sum by (realmURL, operation, grants) (count_over_time(<ops> | kind="policy-search-scope" | outcome="scoped" | hypothetical="false" [24h]))
```

**What the compiler already flagged** — `grant-reaches-ungranted-type` and `render-reaches-ungranted-type` are the two issues that leave a grant live: the grant's document or its rows' renderings carry cards of a type no rule lets a caller read. They log at info on every compile:

```logql
{service="realm-server", env="$env"} |= "compiled with warnings on grants that stay live"
```

Telemetry tells you a grant is busy; it cannot tell you a grant is wrong. Once a grant stands out, explain it against an actor who should not be admitted.

## Investigation: a search is missing a realm's rows

A search never passes the gate. Each realm it reaches only through a policy writes one `policy-search-scope` line: `scoped` (some grant contributed a filter, named in `grants`), `none` (no grant admits the query — the realm answers with no rows, which is no refusal), or `failed` (the policy could not be judged). A realm the caller reads through the ACL is never consulted and writes nothing.

```logql
sum by (realmURL, operation, transport, outcome) (count_over_time(<ops> | kind="policy-search-scope" | hypothetical="false" [1h]))
```

On `failed`, a federated search leaves that realm out and sets `meta.incomplete` rather than passing the missing rows off as rows that don't exist; the search handler logs `could not be judged for a search` with the error. A realm that would not mount is left out the same way but writes no search-scope line, because its policy was never asked — the `incomplete` flag on that request's `boxel:search-shape` line is then the only record (`search-shape-diagnosis`). `operation` is the named query, or `query` for an ad-hoc search; `types` lists the anchor types.

## Gate reach and capability checks

**Gate reach** — how often callers the ACL declined reach the policy:

```logql
sum by (realmURL, coarseDeclined) (count_over_time(<ops> | kind="policy-decision" | decidedAt="gate" | hypothetical="false" [5m]))
```

A realm whose callers are all realm-authorized should sit at zero; lines from one mean the ACL-before-policy ordering broke, which is a correctness problem before it is a cost. A write left to the lock counts once here, as its `pending` record. `policy-performance` reads the same number as the multiplier on every per-decision cost.

**Capability checks** — one `capability-check` line per successful `_capabilities` request, with counts only; the pairs a view asked about are deliberately not recorded. Fields: `realmURL`, `actor`, `coarseDeclined` (`none`, `writes` or `all` — a check from a realm-authorized caller reads `none` and reaches no policy), `pairs`, `allowed`, `conditional` (a create against a type, whose predicate can only run on the card it would mint), `denied`, `totalMs`. A malformed body, an over-cap list, or an archived realm's seal answers with no line.

```logql
sum by (realmURL, coarseDeclined) (sum_over_time(<ops> | kind="capability-check" | unwrap pairs [5m]))
```

A check is advisory: the gate decides again at invocation. A view showing a control the user then can't use is a check that answered from state that changed before the call, or a `conditional` pair.

## Execution lines: a `transform` operation refused, slow, or reading nothing

One `kind`-less line per entry built on `transform`: emitted once the commit lands for `applied` (the program produced a different document) and `unchanged`, and at staging for `refused`. The same record, minus `realmURL` and `actor`, rides back to the caller as `meta.diagnostics`, so a caller can often answer this without the logs.

Fields: `operation` (the invoked name — a `donate` built on `transform` reads `donate`), `base` (`transform`), `target` (the card URL), `outcome`, `code` (only on `refused`), `totalMs`, `storedReads` / `computedReads` / `linkedReads` (reads by tier: the card's stored source, its indexed computed values, its linked cards' indexed values), `missingCount`, `missing[]` (`{path, layer, reason}`, `layer` `computed` or `linked`, `reason` `not-indexed` — no clean index row; `not-searchable` — behind a link not marked `searchable`; `key-absent` — the row has no value at that path), `realmURL`, `actor`.

```logql
# one account's executions
<ops> | kind="" | actor="@alice:example.com"
  | line_format "{{.operation}} {{.outcome}} {{.code}} {{.target}} ms={{.totalMs}} reads={{.storedReads}}/{{.computedReads}}/{{.linkedReads}} missing={{.missingCount}}"

# refusals by operation and code
sum by (realmURL, operation, code) (count_over_time(<ops> | kind="" | outcome="refused" [1h]))

# slow successes
quantile_over_time(0.95, <ops> | kind="" | outcome=~"applied|unchanged" | unwrap totalMs [5m]) by (operation)

# programs that asked for a value no snapshot held
<ops> | kind="" | missingCount > 0
```

Read them with these in mind:

- **A refusal is `outcome="refused"` with a `code`; a slow success has no `code`.** `totalMs` is the staging window — resolving reads and running the program — measured when the record is built. It excludes the commit and the index wait, so a request that was slow end to end with a small `totalMs` spent its time committing or indexing; read the request line's `dur=` for the whole.
- **`missing[]` is an array**, which `| json` won't split; filter on `missingCount` and read the paths from the raw line. Reads are counted per resolved read and a path is reported missing once per layer.
- **Snapshot reads lag the card.** `computed` and `linked` come from the index, so "the program read a stale value" and "the program read nothing" are told apart by the tier counts and `missing[]`, which is why the record exists.

## Snapshot-read windows

A predicate annotated `snapshot: true` that reads a computed value or a linked card's field is judged against the index row, which lags the stored source: someone taken off a roster a computed value reads is admitted until the card is indexed again. Each such evaluation writes a `policy-snapshot-read` line — the window a realm accepted — with `grant`, `targetType`, `decidedAt`, `outcome` (`held`, `did-not-hold`, `threw`) and `indexed` (`false` means the card had no row, and the predicate does not hold):

```logql
sum by (realmURL, grant, outcome, indexed) (count_over_time(<ops> | kind="policy-snapshot-read" | hypothetical="false" [24h]))
```

A user admitted after they should have lost access, on a grant that shows up here, is the window doing what the annotation accepts; the fix is a predicate written against the stored source.

## The dashboard

**"Policy Decisions"**, uid `boxel-policy-decisions` (`packages/observability/grafanactl/resources/dashboards/boxel-status/policy-decisions.json`). `env` is a hidden constant per deployment, as on the other boards; the **Realm** textbox narrows every panel to realm URLs containing a substring. No panel counts capability checks or execution lines — every query filters on one of the four policy kinds — and every panel but the compile ones leaves out `hypothetical` records.

| row            | panel                                  | answers                                                                                                                           |
| -------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Overview       | Decisions / Denials (5m)               | real decisions, and denials of any reason, in the last five minutes                                                               |
|                | Predicate errors (5m)                  | `predicate-threw` decisions whatever the caller was told — the count a 500 tally misses                                           |
|                | Uncompilable policies (5m)             | compiles that left a policy uncompilable                                                                                          |
| Decisions      | Decisions by outcome                   | gate decisions by outcome (pending left out), beside search-lane outcomes                                                         |
|                | Gate reach by realm                    | gate records by realm and `coarseDeclined`, plus search-scope records — the "should be zero" panel                                |
|                | Denials by rule and grant              | denials by realm, operation, reason, `rules`, `grants`; query B adds searches scoped to nothing                                   |
|                | Decisions by transport                 | which surface reached the gate                                                                                                    |
| Faults         | Predicate error rate                   | A: `predicate-threw` decisions; B: the rate-limited fault warning, which also counts explain and capability-check throws (trap 7) |
|                | Policies failing to compile, per realm | uncompilable compiles, beside `policy-unavailable` decisions                                                                      |
| Search lane    | Search-lane outcomes                   | `scoped` / `none` / `failed` by transport                                                                                         |
|                | Contributing grants                    | which grants composed filters into searches                                                                                       |
| Snapshot reads | by grant / by outcome                  | the snapshot windows above                                                                                                        |
| Performance    | durations, compiles, compile p95       | `policy-performance`'s territory                                                                                                  |

## When explain is the better tool

The telemetry answers questions about traffic: who was refused, how often, under which part of which policy. It deliberately cannot answer "why did _this_ predicate fail for _this_ actor on _this_ card", because no line carries a predicate's source, a card's values, or the target of a decision. Explain can: it runs the gate for an actor it names against a target it names — against the policy in force or against a draft — and reports every rule matched, every grant considered, and each predicate's outcome, including a throw. Validate reports what a policy card compiles to, with each issue's full message.

So: use the logs to find the realm, the actor, the operation, the grant path and the time; then hand off to the boxel-skills **`realm-policy-authoring`** skill, which covers calling explain and validate and reading their answers. Explain decisions show up on this channel with `hypothetical: true` — that is your own explain, not a user's traffic.

## Related skills

- **`policy-performance`** — what the policy costs: `evaluationMs`, `predicateMs`, compile durations, the before/after method, and asserting on these records in realm-server tests through their sinks.
- **`realm-policy-authoring`** (boxel-skills) — explain and validate, for one actor and one card.
- **`realm-auth`** — a refusal with no decision line: tokens, sessions, the ACL itself.
- **`indexing-diagnostics`** — a policy card that won't index, or a target whose error row makes it unmatchable.
- **`search-shape-diagnosis`** — the federated search's own line, including `incomplete`, for a search missing rows.
- **`tail-logs`** / **`aws-access`** — reaching staging and production Loki.
