---
name: client-perf-diagnosis
description: Diagnose a client-side performance complaint from the browser telemetry the host emits — an always-on passive instrument that beacons six event types (card-load, server-request, deserialize, wedge, rebuild, realm-event) to the realm-server's `/_client-telemetry` route, which re-emits each as one `boxel:client-perf` JSON log line that alloy ships to Loki and the "Client Performance" Grafana dashboard (uid `boxel-client-perf`) reads with `| json`. Every event carries the authenticated `matrix_user_id` and a per-tab `session_id`, so a report is attributable to one account. Covers (1) a user says a card was slow to load — pivot to their `matrix_user_id`, find the slow `card-load` events (the "Loading card…" window) and their `settle_ms`, then explain the cost from that user's `server-request` / `deserialize` / `wedge` events in the same session; (2) a browser froze or went unresponsive — read the `wedge` events (a main-thread freeze at or above the wedge threshold), whose `top_frames` breadcrumb names the blocking script as `fn @ url:char` (source-map-resolvable for minified builds) with optional JS self-profiler stacks; (3) slow realm-server round-trips — `server-request` latency by endpoint, joined to the server's own `realm:requests` / `realm:search-timing` stage breakdown via the `x-boxel-logging-correlation-id` correlation id; (4) heavy response deserialization — `deserialize` duration by `card_type` against `doc_bytes` / `included_count`; (5) loader/store rebuild churn after a code edit — `rebuild` cost grouped by the `trigger_module` that forced the rebuild; (6) realm index-event write-burst churn — `realm-event` reload work per incoming index event, own-write vs external; and (7) turning any of the above into a single-user or single-session drill-down via the dashboard's `matrix_user_id` / `session_id` template variables. Use when someone reports the app was slow, a tab froze, a card took seconds to open, or asks which user is hitting client performance problems. The client half joins to the server half via the correlation id — for the realm-server-side render / search / indexing view of the same request, layer the `indexing-diagnostics` skill on top. For reading the raw realm-server logs directly, see `tail-logs`.
allowed-tools: Read, Grep, Glob, Bash
---

# Client performance diagnosis

The host runs an always-on, passive client performance instrument. It samples the main thread and hooks the client's own server interactions, batches what it sees into a bounded ring buffer, and beacons the batch to the realm-server's `POST /_client-telemetry` route. The route re-emits **one structured JSON log line per event** on the `boxel:client-perf` channel; alloy tails the realm-server's stdout into Loki, and the **"Client Performance"** Grafana dashboard (uid `boxel-client-perf`) reads those lines with `| json`.

This is the tool for turning a vague field complaint — "the app was slow loading my card", "my tab froze" — into a measured story attributed to a specific account. Every event carries the authenticated `matrix_user_id` and a per-tab `session_id`, so you can start from **who** and reconstruct **what their browser was doing**.

## The pipeline

```
host instrument  →  fetch(keepalive) POST /_client-telemetry  →  one `boxel:client-perf`
JSON log line per event  →  alloy tails realm-server stdout  →  Loki  →  Grafana `| json`
```

Nothing about this is a separate data store: it rides the same log pipeline every realm-server log already uses. A client event is just a realm-server log line with a known shape.

## What gets measured, and how often

The instrument gathers at each signal's natural cadence, decoupled from how often it talks to the network:

- The main thread is probed by a **~100ms heartbeat**; long-animation-frame (LoAF) / longtask observers fire as the browser reports them; the JS self-profiler (on sampled sessions) samples continuously; the event hooks (card-load, server-request, deserialize, rebuild, realm-event) record at the instant each occurs.
- Those samples accumulate in a ring buffer that a **separate ~1s flush loop** batches and POSTs **at most once per second**, and only when the batch carries signal. An otherwise-quiet tab still beacons a compact `keepalive` on a fixed cadence, so an active `session_id` is visible even when nothing is wrong.

So measurement resolution is finer than network chatter, and a healthy idle tab is nearly silent on the wire. Two consequences for reading the data:

- A tab is **quiet while hidden** — browsers throttle background timers, so a large heartbeat gap in a backgrounded tab is not a wedge, and the instrument does not report it as one. Gaps are only trusted while the tab is foregrounded, and a wedge is only emitted when a heartbeat gap is corroborated by a LoAF/longtask observation.
- A `keepalive` event with a nonzero `max_gap_ms` is the low-grade jank channel; a `wedge` event is the incident-grade freeze channel (a gap at or above the wedge threshold). Read `keepalive.max_gap_ms` for "the tab was a bit janky", `wedge` for "the tab locked up".

## Where the data lives — labels vs. JSON fields

Loki indexes only **low-cardinality stream labels**; everything else is a JSON field extracted at query time. This split is deliberate — it keeps per-user/per-session drill-down possible without exploding Loki's index.

- **Stream labels** (cheap selectors, always in `{…}`): `service="realm-server"` and `env` (`local` / `staging` / `production`, stamped by alloy per environment). These are the only labels.
- **JSON fields** (extracted with `| json`, then filtered): `channel` (always `boxel:client-perf`), `event_type`, `matrix_user_id`, `session_id`, `app_version`, `ts` (epoch ms), plus every per-event field below.

> The `env` **stream label** (set by alloy, selects which environment's log stream you read) is distinct from any per-event `env` **JSON field** (the host build's environment). Queries select on the stream label: `{service="realm-server", env="production"}`.

Every query therefore starts:

```logql
{service="realm-server", env="<env>"} | json | channel="boxel:client-perf" | event_type="<type>"
```

and then filters by `matrix_user_id` / `session_id` and unwraps a numeric field.

## The event glossary

Common envelope on every line: `ts`, `event_type`, `channel`, `matrix_user_id`, `session_id`, `env`, `app_version`, and (on most) `realm`.

| `event_type` | what it measures | key fields |
| --- | --- | --- |
| `card-load` | card-to-interactive latency — the "Loading card…" window | `card_id`, `loading_ms` (request→first content), `settle_ms` (→fully loaded), `num_loads`, `loaded_ids[]`, `slowest_loads[]` (`{id, ms, outcome}`) |
| `server-request` | one realm-server round-trip, client-observed | `endpoint` (normalized, ids stripped), `method`, `status`, `duration_ms`, `resp_bytes`, `retried`, `correlation_id` |
| `deserialize` | turning a response into card instances | `duration_ms`, `doc_bytes`, `included_count`, `card_type` |
| `wedge` | a main-thread freeze at/above the wedge threshold | `duration_ms`, `worst_gap_ms`, `blocked_ms`, `longtask_count`, `top_frame_function`, `top_frame_url`, `top_frame_char`, `top_frame_blocked_ms`, `top_frames` (`fn @ url:char` breadcrumb), `loaf_scripts[]`, `profiler_stacks[]` (sampled sessions) |
| `rebuild` | loader/store rebuild after a code invalidation | `duration_ms`, `trigger_module` (grouping key), `trigger_modules[]`, `modules_refetched`, `cards_reloaded` |
| `realm-event` | the tab's work processing one incoming index event | `index_type` (`incremental`/`full`), `invalidations_count`, `invalidated_ids[]`, `reloads_triggered`, `own_write`, `processing_ms` |
| `keepalive` | liveness beacon from an otherwise-quiet tab | `window_ms`, `max_gap_ms` |

Array fields (`loaf_scripts`, `slowest_loads`, `loaded_ids`, `profiler_stacks`) are **not** extractable by `| json` element-by-element — that is why the wedge event also carries flat scalar `top_frame_*` fields for grouping. To see an array's contents, read the raw log line (see [Reading raw lines](#reading-raw-lines)).

## How to actually query

The LogQL below is environment-agnostic; what changes is how you reach Grafana/Loki.

### Local dev

Bring up the observability stack and push the dashboards:

```bash
cd packages/observability
docker compose up -d          # Grafana :3001, Loki :3100, alloy, prometheus
./scripts/apply.sh --env local
```

alloy tails the realm-server's stdout file (`${BOXEL_LOG_DIR:-/tmp/boxel-logs}/realm-server.log`, mounted into the alloy container) and labels the stream `{service="realm-server", env="local"}`. So the local realm-server must be running with its stdout going to that file (the dev service tasks do this), and the host must be running so beacons actually POST. Open Grafana at `http://localhost:3001` → **Client Performance**, with `env=local`.

Sanity-check the path end-to-end by querying Loki's HTTP API directly:

```bash
# Are any client-perf lines landing at all (last 15m)?
curl -sG 'http://localhost:3100/loki/api/v1/query_range' \
  --data-urlencode 'query={service="realm-server", env="local"} | json | channel="boxel:client-perf"' \
  --data-urlencode "start=$(( ($(date +%s) - 900) ))000000000" \
  --data-urlencode "end=$(date +%s)000000000" \
  --data-urlencode 'limit=20' | python3 -m json.tool | head -60
```

If that returns rows, the pipeline is healthy and any empty panel is a filter/time-range issue, not a plumbing one.

### Staging / production

The data lives in the hosted Grafana. Open the **Client Performance** dashboard and set the `env` template variable to `staging` / `production`. Everything else in this skill — the modes, the field meanings, the queries — is identical; only the `env` label and the Grafana you open change. No database tunnel is needed (unlike server-side render diagnostics): the whole client story is in Loki.

### The three template variables (the drill-down controls)

Every panel is filtered by three dashboard variables, and they are the entire user-attribution mechanism:

- **`env`** — selects the Loki stream (`{… env="$env"}`). One environment at a time.
- **`matrix_user_id`** — the account. Defaults to `$__all` (a match-all regex, so "All" really means all users, including anonymous/synthetic sessions). Pick a user to scope the whole board to that account. In LogQL this is `| matrix_user_id=~"$matrix_user_id"`.
- **`session_id`** — a free-text box, matched as a substring: `| session_id=~".*${session_id}.*"`. Empty matches every session; paste a session id to isolate one tab.

Picking a `matrix_user_id` (and optionally a `session_id`) turns every panel on the board into a single-client view. That is the move Mode A is built on.

## Mode A — a user reports their card was slow to load

This is the common one: *"user XYZ said the app was slow loading their card."* You have an account and a vague symptom. Turn it into a measured window and a cause.

**Step 1 — get the account's `matrix_user_id`.** It's the Matrix user id (`@localpart:server`). In the dashboard, the `matrix_user_id` variable is populated from the users table, so you can pick it from the dropdown. Select it (and leave `session_id` empty to start).

**Step 2 — find the slow card-load(s).** The card-load event *is* the "Loading card…" window. Look at that user's slowest card-loads by `settle_ms`, keyed by `card_id`:

```logql
topk(20, max by (card_id) (
  max_over_time({service="realm-server", env="$env"} | json
    | channel="boxel:client-perf" | event_type="card-load"
    | matrix_user_id=~"$matrix_user_id" | session_id=~".*${session_id}.*"
    | unwrap settle_ms [$__range])
))
```

`loading_ms` is time to first content; `settle_ms` is time to fully loaded (the number the user experiences as "still spinning"). A card-load with a large `settle_ms` and a large `num_loads` pulled a lot of documents to become interactive — the `slowest_loads[]` array on that line names which ids were slowest and whether they errored.

**Step 3 — pin the session and the moment.** Once you have a slow `card_id`, find the `session_id` and timestamp of that specific event by reading the raw line (see [Reading raw lines](#reading-raw-lines)), then paste the `session_id` into the dashboard variable. Now the whole board is that one tab, and you can read what else was happening around that `ts`.

**Step 4 — spider into the cause.** The card-load names the *symptom and its magnitude*; the other event types in the same pinned session name the *cause*. With the session isolated and the slow card-load's `ts` in hand, walk outward into each event type and let the one that overlaps the window explain it:

- **Slow server round-trips** → [Mode C](#mode-c--slow-realm-server-round-trips-and-the-server-side-join). A card-load that spent its time on the network shows up as slow `server-request.duration_ms`; a `server-request` with `retried="true"` added backoff latency from a re-attempted fetch. The `correlation_id` then crosses to the server's own timing — *why the server was slow*.
- **A main-thread freeze** → [Mode B](#mode-b--a-browser-froze--went-unresponsive). If the tab locked up mid-load, a `wedge` overlaps the window and its `settle_ms` includes the freeze; the wedge's `top_frames` breadcrumb names the blocking script.
- **Heavy deserialization** → [Mode D](#mode-d--heavy-response-deserialization). Large `deserialize.duration_ms` / `doc_bytes` for a `card_type` in the load — a big linked graph deserializes slowly.
- **Rebuild churn** → [Mode E](#mode-e--rebuild-churn-after-a-code-edit). If the load raced a loader/store rebuild (a `rebuild` event in the window), the card waited on the rebuild; `trigger_module` names what forced it.
- **Index-event churn** → [Mode F](#mode-f--realm-index-event-write-burst-churn). A `realm-event` storm (high `reloads_triggered`) during the window means the tab was busy absorbing incoming index events while trying to load.

Whichever event overlaps the window with the outsized number is the lead. The whole point of pinning the session first is that this spider is then confined to one tab's timeline, so the overlap is real rather than coincidental.

## Mode B — a browser froze / went unresponsive

A `wedge` event is emitted when the main thread is frozen for a heartbeat gap at or above the wedge threshold *and* the freeze is corroborated by a LoAF/longtask observation (so timer coalescing after a tab was backgrounded is not misreported).

**Find the wedges**, per user, grouped by the blocking frame:

```logql
topk(15, sum by (top_frame_function, top_frame_url) (
  count_over_time({service="realm-server", env="$env"} | json
    | channel="boxel:client-perf" | matrix_user_id=~"$matrix_user_id"
    | session_id=~".*${session_id}.*" | event_type="wedge"
    | top_frame_function!="" [$__range])
))
```

**Read the breadcrumb.** Each wedge carries:

- `top_frame_function` / `top_frame_url` / `top_frame_char` — the single worst blocking script as scalar fields (groupable). `top_frame_char` is a source character offset: with a source map it resolves to a line/column even for a minified production build, where the function name alone is useless.
- `top_frames` — a readable multi-frame summary (`fn @ url:char`, worst few), so the frame can be reasoned about beyond one name. Read it from the raw line.
- `loaf_scripts[]` — the worst blocking scripts the LoAF observer attributed, each with `source_url`, `function_name`, `char_position`, `invoker`, `blocking_duration_ms`.
- `profiler_stacks[]` — on sessions the JS self-profiler sampled, real sampled call stacks spanning the freeze. Absent on unsampled sessions; the LoAF breadcrumb still ships either way.

`blocked_ms` is the total blocked time in the wedge window; `worst_gap_ms` is the single largest heartbeat gap; `longtask_count` is how many long tasks piled up.

## Mode C — slow realm-server round-trips (and the server-side join)

`server-request` records one round-trip as the client saw it. `endpoint` is normalized (instance ids stripped to a low-cardinality label like `GET card` or `_search`), so you can group by it.

**p95 by endpoint**, and **most-retried endpoints**:

```logql
quantile_over_time(0.95, {service="realm-server", env="$env"} | json
  | channel="boxel:client-perf" | event_type="server-request"
  | matrix_user_id=~"$matrix_user_id" | session_id=~".*${session_id}.*"
  | unwrap duration_ms [$__interval]) by (endpoint)
```

```logql
sum by (endpoint) (count_over_time({service="realm-server", env="$env"} | json
  | channel="boxel:client-perf" | event_type="server-request" | retried="true"
  | matrix_user_id=~"$matrix_user_id" | session_id=~".*${session_id}.*" [$__range]))
```

**The join to the server's own view.** `server-request.correlation_id` is the `x-boxel-logging-correlation-id` the client stamps on the outgoing request. The realm-server logs the same id as `corr=<id>` on its `realm:requests` (`dur=` total) line and, for searches, its `realm:search-timing` stage breakdown. So a client-observed slow request splits into *network/queue time* vs *server processing time*: grab the `correlation_id` from the raw client line, then search the realm-server logs for `corr=<that id>`. The server-side stage attribution (parse / SQL / loadLinks / serialize / queue) is covered by the `indexing-diagnostics` skill's search-timing mode — this is where the client and server halves of one request meet.

## Mode D — heavy response deserialization

`deserialize` times turning a fetched document into card instances. A heavy linked graph (an index/dashboard card) is the classic outlier.

```logql
quantile_over_time(0.95, {service="realm-server", env="$env"} | json
  | channel="boxel:client-perf" | event_type="deserialize"
  | matrix_user_id=~"$matrix_user_id" | session_id=~".*${session_id}.*"
  | unwrap duration_ms [$__interval]) by (card_type)
```

Correlate `duration_ms` against `doc_bytes` and `included_count` (swap the `unwrap` field) to tell "big document" apart from "expensive to build". A card_type whose `duration_ms` grows faster than its `doc_bytes` is doing expensive per-instance work, not just moving bytes.

## Mode E — rebuild churn after a code edit

A `rebuild` event fires when a `.gts`/code invalidation forces a loader/store rebuild. It is attributed to **why** it rebuilt: `trigger_module` is the invalidated module that forced it (the grouping key; `trigger_modules[]` has the full set).

```logql
sum by (trigger_module) (count_over_time({service="realm-server", env="$env"} | json
  | channel="boxel:client-perf" | event_type="rebuild"
  | matrix_user_id=~"$matrix_user_id" | session_id=~".*${session_id}.*" [$__range]))
```

`avg by (trigger_module) (... | unwrap cards_reloaded ...)` and `... | unwrap modules_refetched ...` show which module's edits are the most expensive to absorb. A `trigger_module` that reloads many cards on every edit is a hot dependency.

**Why did it rebuild?** A rebuild in a session the user wasn't editing usually traces to an incoming index event: look for a `realm-event` in the same window whose `invalidated_ids[]` contains this `trigger_module` ([Mode F](#mode-f--realm-index-event-write-burst-churn)). That distinguishes a self-inflicted rebuild (the user saved a module) from one pushed by someone else's write.

## Mode F — realm index-event write-burst churn

`realm-event` is often the **"why" behind reloads** — the causal upstream of the other modes. It measures the tab's cost to process one incoming realm index event (the write-burst churn from the client's side), and that same incoming event is frequently what set the other costs in motion — *why* a rebuild fired, and *why* a card reloaded links the user never asked for. When Mode A, D, or E shows churn without an obvious local trigger, look for a `realm-event` in the same window — it is the answer to "why did this happen when I didn't touch anything?"

```logql
sum(sum_over_time({service="realm-server", env="$env"} | json
  | channel="boxel:client-perf" | event_type="realm-event"
  | matrix_user_id=~"$matrix_user_id" | session_id=~".*${session_id}.*"
  | unwrap reloads_triggered [$__interval]))
```

Split `own_write` (the tab's own edits echoing back) from external events with `sum by (own_write) (count_over_time(... event_type="realm-event" ...))`: a tab drowning in *external* events with high `reloads_triggered` is paying for someone else's write burst, whereas high `own_write` churn is self-inflicted. `processing_ms` is the per-event reload cost; `index_type` distinguishes an incremental event from a full-reindex broadcast.

**Trace the causal chain.** The event's `invalidated_ids[]` (bounded, read from the raw line) is what the index event marked stale, and it links the realm-event to its downstream cost:

- A **`rebuild`** whose `trigger_module` appears in a realm-event's `invalidated_ids` in the same window — the incoming invalidation of an executable module is what forced the loader/store rebuild. The realm-event is the cause; the rebuild is the effect.
- A **`card-load`** (or a spike in another load's `num_loads` / `slowest_loads`) whose reloaded ids intersect a realm-event's `invalidated_ids` — the tab reloaded a linked card because an index event invalidated it, not because the user navigated. `reloads_triggered` counts exactly these knock-on reloads.

So the reading order for "why was the tab busy" is often backwards from the symptom: land on the `rebuild` / `card-load` cost first (Modes E/A), then find the `realm-event` in the same session-and-window whose `invalidated_ids` explain it.

## Mode G — scope anything to one user or one session

Every mode above already threads `matrix_user_id` and `session_id`. To go the other direction — *which* users/sessions are hitting problems — count distinct sessions and rank users:

```logql
# active sessions in range (any client-perf signal)
count(count by (session_id) (count_over_time({service="realm-server", env="$env"} | json
  | channel="boxel:client-perf" | matrix_user_id=~"$matrix_user_id"
  | session_id=~".*${session_id}.*" [$__range])))
```

Group any of the health queries `by (matrix_user_id)` instead of the default aggregation to get a per-user leaderboard (worst card-to-interactive, wedge count, retry count). The dashboard's **By user** row does exactly this; from a row there, copy the `matrix_user_id` back into the variable to drill in.

## Reading raw lines

Aggregations can't show you array fields (`loaf_scripts`, `slowest_loads`, `top_frames`, `correlation_id` on a specific event). To read the full JSON of specific events, query the lines directly instead of an aggregation — in Grafana Explore, or via the API:

```bash
curl -sG 'http://localhost:3100/loki/api/v1/query_range' \
  --data-urlencode 'query={service="realm-server", env="local"} | json
      | channel="boxel:client-perf" | event_type="wedge" | matrix_user_id=~"@user:example.com"' \
  --data-urlencode "start=$(( ($(date +%s) - 3600) ))000000000" \
  --data-urlencode "end=$(date +%s)000000000" \
  --data-urlencode 'limit=50' | python3 -m json.tool
```

Each returned line's `values[][1]` is the full JSON object — read `top_frames`, `loaf_scripts`, `slowest_loads`, or `correlation_id` from there.

## Calibrating thresholds

The event fields are facts; the line between "fine" and "slow" is per-realm. A card-to-interactive that's normal for a heavy dashboard realm is alarming for a realm of trivial cards. Read a realm's own baseline (the overview row over a healthy window) before calling a number pathological, and prefer the high quantiles (p95/p99) and the topk panels over averages — a client complaint is a tail event, and averages hide tails.

## Related skills

- **`indexing-diagnostics`** — the server-side half. When a `server-request` `correlation_id` points at a slow realm-server response, that skill attributes the server's time across its request→response stages (parse / SQL / loadLinks / serialize / queue) and, for renders, across the prerender pipeline. The correlation id is the seam between the two skills.
- **`tail-logs`** — reading the realm-server's raw log stream directly (including the `corr=<id>` lines you join to).
- **`aws-access`** — the AWS session and read-only DB tunnel for deployed environments, needed only when a client investigation crosses into server-side data that isn't in Loki.
