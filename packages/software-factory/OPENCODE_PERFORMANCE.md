# Software Factory: Why is it slower with opencode?

> **Confidence note.** The architecture story below is verified from the
> opencode binary and our own code. Wall times are observed.
> **Specific token counts and step counts are not measured yet.**
> Importantly: an earlier draft of this doc claimed opencode "forces one
> tool call per step" — that was wrong. See "What we got wrong" below.

## TL;DR

Same job — bootstrap a project + implement one Sticky Note card:

| | Wall time | Source |
|--|--|--|
| **Before opencode** (direct OpenAI tool-use) | "minutes" — never timed on this workload | extrapolated from how the old code path worked |
| **After opencode** (opencode SDK runtime) | ~30–60 min | directly observed on recent `factory:go` runs |

Same model. Same OpenRouter. The agent runtime is what changed.

Two architectural facts (both verified):
1. opencode runs a **step loop** — each step is one full chat completion.
2. Within one step, opencode **does** execute the model's tool calls in parallel (`Promise.all` over `toolCalls`).

So **opencode supports parallel tool calls.** What's actually happening to make us slow is not "opencode forces serialization." It's that the model under opencode is emitting fewer tool calls per step than the model under the old direct-API path did. Why — we don't know yet.

---

## Architecture: Before — VERIFIED

```
factory:go ──POST /chat/completions──▶ OpenRouter
                                          │
                                          ▼
       Assistant message returns N tool_calls IN ONE RESPONSE:
       [
         { tool: "write_file", path: "Projects/sticky-note.json", ... },
         { tool: "write_file", path: "Knowledge Articles/...-brief.json", ... },
         { tool: "write_file", path: "Knowledge Articles/...-onboard.json", ... },
         { tool: "write_file", path: "Issues/sticky-note-impl.json", ... },
       ]

factory executes all 4 in parallel, appends 4 tool_results, loops.
```

**Per turn we sent:**
- our `system.md`
- our MCP tool definitions
- growing conversation history
- model returned **1 message containing N tool_calls**

How many turns this took for a bootstrap historically: not logged. Loop shape verified from prior `OpenRouterFactoryAgent`; turn counts not.

---

## Architecture: After — VERIFIED

```
factory:go ──session.prompt──▶ opencode subprocess (long-lived)
                                  │
                                  │ runs a step loop
                                  ▼
   Step k:  full /chat/completions ─▶ OpenRouter
            │
            └─▶ assistant returns 1..N tool_calls
                 ├─ executes them in parallel via Promise.all
                 ├─ appends results to history
                 └─ next step
```

**Per step we send:**
- opencode's **built-in system prompt** — *size not measured*
- our `system.md` merged in
- **all enabled tool schemas:** `Read`, `Write`, `Edit`, `Bash`, `Glob`, `Grep`, plus MCP tools
- environment metadata opencode injects (cwd, file tree snippets, etc.) — *exact contents not measured*
- growing conversation history
- model returns **1 message with 1..N tool calls**

**Critically:** opencode passes `parallel_tool_calls` through to OpenAI/OpenRouter. We do not override it. The OpenAI default is `true`. So if the model wanted to batch, it could.

Step counts: visible in our live progress logs but not yet aggregated. Anecdotally "tens of steps" for bootstrap, "more tens" for implementation — but **how many tool calls per step we're actually getting is exactly the metric we should measure** to understand the slowdown.

---

## So why is it slower?

Honest answer: **we don't know yet.** Hypotheses, ranked by my current guess at likelihood:

### H1. The model emits fewer tool_calls per step under opencode
The old direct-API path may have been getting batched responses (3–6 tool_calls per assistant turn). Under opencode, the model may be emitting 1 tool_call per turn. If true, opencode's parallel-execution support never gets exercised because the model isn't emitting parallel calls.

Possible causes:
- opencode's built-in system prompt nudges "think then act once"
- The reasoning model we use favors sequential thinking
- The big tool catalog opencode injects (Read/Write/Edit/Bash/Glob/Grep + MCP) makes the model more deliberate

**To verify:** capture outbound request/response bodies. Count `tool_calls.length` per assistant message.

### H2. Per-step prompt overhead is large
opencode injects a substantial system prompt + env metadata + tool schemas on every call. If steps × tokens-per-step is much higher under opencode, even with comparable step counts, we'd pay both more dollars and more wall time (latency scales with prompt size).

**To verify:** capture one outbound body, tokenize it, compare to what the old loop sent.

### H3. opencode adds wall-clock overhead between steps
SSE streaming, internal bookkeeping, telemetry, message parsing. Likely a smaller factor than H1/H2 but real.

**To verify:** measure time-from-final-token-out to next-request-sent.

### H4. The model is just slower to think
Reasoning models burn thinking tokens before output. If we changed model defaults along with the runtime swap, that confounds the comparison.

**To verify:** confirm we're using the same model on both paths.

---

## What we got wrong before

Earlier drafts claimed:
- ❌ "opencode forces one tool call per step" — **wrong.** It executes parallel tool calls when the model emits them.
- ❌ "before: 1 turn returns 4 actions; after: 4 steps each returning 1 action" — **the second half may be true empirically, but it's a model behavior story, not an architectural one.**
- ❌ Specific token counts (~3K, ~1.5K, ~28K) — **fabricated estimates, not measurements.**

The corrected story: opencode's runtime is *capable* of parallel tool calls. Something about the *combination* of opencode + this model + these prompts is producing a slower trajectory than the old direct-API loop. We need data to know what.

---

## Why we adopted opencode anyway — DESIGN INTENT

- **Native fs tools** (`Read`, `Write`, `Edit`, `Glob`, `Grep`, `Bash`) battle-tested across many providers
- **Session abstraction** with state, history, cancellation
- **Provider-agnostic agent runtime** — swap OpenRouter → Anthropic → local without rewriting the loop
- **One code path for all `--agent` backends**

These benefits are real regardless of the perf debate.

---

## Options — DIRECTIONAL, NOT FORECASTS

| | Effort | Likely impact | Tradeoff |
|--|--|--|--|
| **A. Live with it** | none | baseline | Honest cost of a generic agent runtime |
| **B. Measure first** (see below) | ~1 hour | none directly — but de-risks the choice | Delay before any code change |
| **C. Set `parallelToolCalls: true` explicitly + add a "batch independent file writes" line to system prompt** | small | unknown but cheap to try | Might or might not move the needle, depending on H1 |
| **D. Faster / cheaper model for routine steps** | small | meaningful — models dominate per-step latency | Quality risk on tricky cards |
| **E. Restore direct OpenAI tool-use for `--agent openrouter`** | medium | largest if H1+H2 are right | Two code paths; reintroduce MCP wrappers for fs ops |
| **F. Trim opencode framing** (custom system prompt, fewer tools, disable env metadata) | small | unknown — opencode re-injects defaults | Limited by what opencode lets us override |

**Suggested order:** B → C (cheap experiment) → D → E.

---

## What we'd need to make this rigorous

1. **Capture one outbound request body** in `handle-openrouter-passthrough.ts` for a single opencode step. Tokenize. Get:
   - opencode system prompt size
   - tool schema size
   - per-step fixed overhead
2. **Capture model responses** and count `tool_calls.length` per assistant message — this directly tests H1.
3. **Count steps** for a real `factory:go` run by aggregating live progress log lines.
4. **Time the old path** by running the previous `OpenRouterFactoryAgent` on the same brief.
5. **Compute** real multipliers: tokens, steps, wall time.

~1 hour of instrumentation. Replaces every guess in this doc with measured numbers.

---

## Appendix: where to look in the code

- Old path: previous `OpenRouterFactoryAgent` — direct `/chat/completions` with parallel `tool_calls` (in git history)
- New path: `packages/software-factory/src/factory-agent/opencode.ts` — long-lived opencode subprocess, `session.prompt`, `waitForSessionIdle`. Note: `parallelToolCalls` is **not set** in our `session.prompt` body (around line 413).
- Realm-server passthrough (forwards opencode's HTTP to OpenRouter with our key): `packages/realm-server/handlers/handle-openrouter-passthrough.ts` — best place to capture request/response bodies for measurement.
- Tool whitelist: `ENABLED_OPENCODE_TOOLS` in `opencode.ts`
- Evidence opencode does parallel tool calls: search the `opencode` binary for `parallelToolCalls` and `Promise.all` over `toolCall.map(...)`.
