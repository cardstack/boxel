# Run trace — where a factory run's time goes

Every `factory:go` run writes a span trace to
`<workspace>/.factory-trace/run-<timestamp>.ndjson` (the path is printed at
startup on the `run-trace` log channel). The file answers "where did the
hour go" with one tagged, timed span per significant phase — the input for
the timing visualization and for quick command-line triage.

## Format

NDJSON: one self-contained JSON object per line, append-only (a killed run
keeps every span that finished — an _unclosed_ span writes nothing, so a
crash shows up as a gap, never a fabricated duration).

- header — first line: `{"v":1,"c":"run","n":"meta","t":…,` run tags
  (`targetRealm`, `controlRealm`, `brief`, `v2`)`}`
- span — `{"t":<epoch-ms start>,"d":<duration-ms>,"c":<category>,"n":<name>,` tags`}`
- instant event — same, without `"d"`

Nesting is recovered by interval containment (`[t, t+d]`); there are no
begin/end pairs to match. `d` comes from the monotonic clock; `t` is
wall-clock so lines cross-reference the debug log.

## Categories (`c`) and names (`n`)

| c             | n                                                                                                                  | one span per                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `run`         | `meta`, `issue-loop`                                                                                               | run                                                                               |
| `startup`     | `load-brief`, `bootstrap-target-realm`, `pull-target-realm`, `pull-control-realm`                                  | run                                                                               |
| `seed`        | `create-seed`                                                                                                      | run                                                                               |
| `skills`      | `materialize` (run), `load` (turn)                                                                                 | —                                                                                 |
| `manifest`    | `host-imports`                                                                                                     | run                                                                               |
| `scheduler`   | `load-issues`, `skip-stale-done`                                                                                   | occurrence                                                                        |
| `issue`       | issue slug                                                                                                         | outer cycle; tags `exitReason`, `iterations`, `agentMs`, `validationMs`, `syncMs` |
| `iteration`   | issue slug                                                                                                         | inner pass; tag `iteration`                                                       |
| `context`     | `build-for-issue`                                                                                                  | agent-context build                                                               |
| `inference`   | turn type (`design`, `build`, `fix`, `implement`, `review`, `bootstrap`, `analysis`, `design-foundation`, `prime`) | agent turn; tags `model`, `effort`, `status`, `toolCalls`, `tokensIn`/`tokensOut` |
| `tool`        | tool name                                                                                                          | factory MCP tool execution inside a turn                                          |
| `sync`        | `workspace` (composite), `product`, `control`                                                                      | sync                                                                              |
| `validation`  | `pipeline` (composite), step name (`lint`, `parse`, `evaluate`, `instantiate`, `imports`, `test`)                  | validation                                                                        |
| `render-gate` | `capture`                                                                                                          | gate capture                                                                      |

Steps inside `validation`/`pipeline` run concurrently: treat the pipeline
span as wall-clock cost, the step spans as attribution. Same for `tool` and
`sync` spans inside an `inference` span — tool time is part of the turn's
wall clock, so "model thinking time" ≈ inference `d` minus contained `tool`
spans.

## Quick triage without the visualization

Total per category, descending:

```sh
jq -rs 'map(select(.d)) | group_by(.c) | map({c: .[0].c, s: (map(.d) | add)}) | sort_by(-.s) | .[] | "\(.s/1000 | floor)s\t\(.c)"' run-*.ndjson
```

Ten slowest spans:

```sh
jq -rs 'map(select(.d)) | sort_by(-.d) | .[:10] | .[] | "\(.d/1000|floor)s\t\(.c)/\(.n)\t\(.issue // "")"' run-*.ndjson
```

Perfetto/chrome-tracing view (no custom viz needed):

```sh
jq -s '[.[] | select(.d) | {name: .n, cat: .c, ph: "X", ts: (.t*1000), dur: (.d*1000), pid: 1, tid: 1, args: .}]' run-*.ndjson > trace.json
# open https://ui.perfetto.dev and load trace.json
```
