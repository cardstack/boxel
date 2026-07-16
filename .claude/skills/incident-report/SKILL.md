---
name: incident-report
description: Write up a production or staging incident (outage, degradation, 5xx / latency spike, indexing stall, task-recycle event) as a consistent, shareable report in the team's established house style — a slate-blue technical Artifact with a facts grid, stat tiles, a typed timeline, a trigger-vs-vulnerability root cause, a "ruled out" list, prioritized action items, and an evidence appendix. Use whenever asked to "create/write an incident report", "postmortem", "write this up for the team", or after investigating a deployed-environment incident and needing a deliverable others will read. Pairs with the aws-access, tail-logs, indexing-diagnostics, and prerender-sizing skills, which gather the evidence this report is built from.
---

# Incident report

This skill keeps every boxel incident write-up in one recognizable house style and one honest voice, so a reader who has seen one report can read the next at a glance. It covers **how to structure, word, and publish** the report — not how to investigate. Gather the evidence first (see Step 0), then render it here.

The canonical examples — both built to the structure and tone below; new reports should look and read like these siblings (open in a browser signed in to the Cardstack org):

- 2026-07-15 staging 503 — <https://claude.ai/code/artifact/97592f4d-372b-4727-8220-c3a32b96d001>
- 2026-07-16 staging 504 — <https://claude.ai/code/artifact/02f27e4b-ddbf-485e-a1fd-319eedd2dca1>

## Step 0 — investigate first; the report renders evidence, never assumptions

A report is only as good as what it's built on. Before writing a line, pin the facts with real data:

- **Deployed-env access + logs** → the `aws-access` skill (ALB/ECS/CloudWatch metrics, RDS, EFS) and `tail-logs` (Loki).
- **Slow/failed indexing or renders** → `indexing-diagnostics`.
- **Prerender pool saturation / sizing** → `prerender-sizing`.

Pin, with sources: the exact incident window, per-code error counts (503 vs 504 vs target-5xx — they mean different things), the peak/precursor spikes, target response times, the deploy/task-def timeline, the health-check + rollout config, and any git/PR/ticket that correlates. If a claim can't be backed by a metric, a log line, or config, either verify it or mark it explicitly as inferred. The "ruled out" section (below) is not optional — an incident report that only argues *for* one cause is weaker than one that also says what it isn't.

## The deliverable

Default to an **Artifact** (via the `Artifact` tool) — it renders the house style directly. An incident report is meant to be read by the whole team, so its end state is **shared with the "Cardstack" organization**, not left private (see Publish & track). The palette and structure here are already decided; do not re-derive them.

Keep a plain-markdown copy in the scratchpad too when useful as a working draft, but the shared deliverable is the Artifact.

Start from `template.html` in this skill directory — it is the full house stylesheet plus a section scaffold with placeholders. Copy it, fill every section with the pinned evidence, delete the guidance comments, and publish.

## House style (already decided — keep it consistent)

- **Palette:** slate-blue accent (`#35506B` light / `#7BA0CC` dark) on cool, slightly hue-biased neutrals; semantic `critical` / `warning` / `good` that are **separate from the accent** and used only for severity, never decoration. Full token set (light + dark, `prefers-color-scheme` + `data-theme` overrides) is in `template.html` — theme-aware in both directions.
- **Type:** system sans for prose; a monospace face (`ui-monospace`, …) for **all** timestamps, counts, durations, config values, and code. Use `font-variant-numeric: tabular-nums` anywhere digits align in a column.
- **Favicon:** `🚨` (keep it stable across redeploys of the same report).
- **Layout:** a single document column (`max-width: 940px`), scan-first — summary and key numbers before the detail. Wide tables live inside an `overflow-x: auto` container so the page body never scrolls sideways.

## Required structure (in this order)

1. **Header** — eyebrow (`Incident Report` + status pills: `Staging/Prod outage`, `Resolved`/`Ongoing`, and any relation like `Recurrence of CS-xxxxx`), a one-line headline that states what actually happened, and a lede (≤3 sentences) that a non-oncall teammate can follow.
2. **Facts grid** — Environment, Window (UTC), Duration, Trigger, Production impact, Data loss.
3. **Stat tiles** — 4–6 key numbers (peak error count, max response time, request-volume delta, task count, the one config value that mattered, etc.). Color the alarming ones `critical`/`warning`.
4. **Summary** — a 2–3 paragraph callout: what broke, the mechanism in plain terms, whether it recovered on its own.
5. **Root cause** — two cards side by side: **the vulnerability** (the standing weakness that let this become an outage) and **the trigger** (the specific thing that set it off this time). Keeping them separate is the point — the same vulnerability can be hit by different triggers, and conflating them produces the wrong fix. Follow with a short "why this was milder/worse than <prior incident>" paragraph if there's a comparable one.
6. **Timeline** — a typed vertical timeline (normal / hot / deploy / recover markers). UTC first, local (e.g. EDT) in grey. This is a genuine sequence, so the timeline (and only here, ordered markers) is appropriate.
7. **Contributing factors & ruled out** — two columns. Contributing factors as a `critical`-marked list; ruled-out as a `good`-marked list with the evidence that rules each out.
8. **Action items** — a prioritized table (Prio / Action / Layer / Status). Lead with the cheapest high-leverage fixes; tie durable guarantees to their tracking tickets. If a fix is config-only vs code, say so.
9. **Evidence appendix** — the raw tables the narrative rests on (per-minute error counts, health/metric samples, deploy & config facts, code/commit refs).

Not every incident needs all nine at full weight, but keep the order and the section identities so reports stay comparable. Drop a section only when it would be empty, not to save effort.

## Tone & content rules (the voice)

- **Honest and specific over reassuring.** No apologies, no hedging-as-filler. "Both tasks failed the health check and were replaced" beats "there may have been some instability."
- **Separate trigger from vulnerability** everywhere, not just in the root-cause cards.
- **Quantify.** Every claim of severity carries a number and its source. Prefer real observed values to round numbers.
- **Times in UTC, with local in parentheses** the first time each is shown. State the timezone conversion once so readers can check it. Beware quoting a Slack/Sentry timestamp that's already local.
- **Name the honest caveat.** If a proposed fix only covers the observed flavor and not a worse one, say so explicitly (e.g. "config tuning avoids this mild event; a sustained overload still needs load-shedding"). Over-claiming a fix is the most common way these reports mislead.
- **Recommendations are actionable and layered:** config-only first, then code, then structural; each tied to a ticket where one exists.
- **Evergreen within the doc, but a report is inherently a point-in-time record** — it's fine (expected) for it to describe the journey and reference tickets/PRs/commits, unlike code comments and PR text. This is the one place the evergreen rule does not apply.

## Numbers & formatting conventions

- Distinguish HTTP codes precisely: ALB-generated `5xx` (no responsive target) vs target-generated `5xx` (app returned it); `503` (no healthy/available target) vs `504` (target didn't answer in time). Watch for red herrings like `dur=504ms` matching a "504" grep.
- Put counts, durations, and config in monospace; align columns with tabular-nums.
- Give per-minute granularity for the spike itself and coarser buckets for context.

## Privacy

- **Artifact / Linear are internal** (Linear is staff-only) — staging/prod detail, realm names, task IDs, and log excerpts are fine there. This is the same posture as the existing reports.
- **Never include secrets** in any destination: no JWTs / `boxel-session` tokens, no DB credentials, no signed URLs. Redact before pasting a log line that contains them.
- **GitHub is public.** If any of this content is ever headed for a PR, commit, or public issue, the `pr-privacy` skill applies and most of this data must be redacted or kept out. Keep incident detail in the Artifact/Linear, link from GitHub.

## Publish & track

1. Write the filled HTML to the scratchpad (or the report's working dir).
2. Publish with the `Artifact` tool: favicon `🚨`, a concise `<title>`/title (`Staging 504 Incident Report — <date>`), and a one-sentence `description`.
3. **Set visibility to the "Cardstack" organization.** The report is for the whole team — it must not stay private. The `Artifact` tool publishes private-by-default and has no visibility parameter, so this is a one-time action in the page's **share menu**: choose share with the "Cardstack" organization (org members can open it). If you (Claude) can't reach the share menu, publish, then explicitly tell the user to flip visibility to the Cardstack org and hand them the URL — don't leave it silently private.
4. To revise, edit the same file and republish with the **same file path** so the URL (and its sharing) is stable.
5. Post the Artifact link to the tracking ticket (Linear) as a comment — not a description edit — and attach it alongside any prior related report. If it's a recurrence, comment on the existing ticket rather than opening a new one, and spell out same-mode / different-trigger.

## Files

- `template.html` — the house stylesheet + section scaffold. Start here.
