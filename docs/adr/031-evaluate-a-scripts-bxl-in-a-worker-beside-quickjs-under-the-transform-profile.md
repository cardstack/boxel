---
status: accepted
date: 2026-11-10
scope:
  - packages/host/app/lib/realm-runner/transform*
---

# 031. Evaluate a script's BXL in a worker beside QuickJS, under the transform profile

A Realm Runner script calls `realm.transform` to reshape JSON with a BXL
program. The program runs in a worker of its run's own, beside QuickJS, in
the same place as the script: the person's browser for an interactive run,
the prerender tab for an automation run. It runs under BXL's `transform`
profile, so it does no I/O and adds no authority, and explicit limits bound
every call.

## 1. Decision

### 1.1. Beside QuickJS, where the script runs

A `realm.transform` program MUST run in a transform worker, outside QuickJS,
in the same browser or tab as the script that called it. It MUST NOT run
inside QuickJS, and it MUST NOT run on a server.

### 1.2. One worker per run

A run's transform worker MUST start on the run's first `realm.transform` and
end with the run. Runs MUST NOT share a transform worker, also when they share
a tab. A call MUST use its run's worker, not one of its own.

### 1.3. The transform profile

A program MUST run under BXL's `transform` profile, the profile that
`callApi` operations' input and output programs use. Its refusals MUST keep
BXL's codes. A program MUST NOT run under the `compute` profile or any
profile that allows a side effect. A program MUST NOT do I/O, import, or read
or write a realm file.

### 1.4. Bounded calls

Each call MUST be bounded by a cap on the program's size, a cap on its input
and params together, and a cap on its output. BXL's runtime limits MUST be
set explicitly, never left at BXL's defaults. Each call MUST have a
wall-clock limit, past which the host ends the worker. The next call then
starts a new one. An interactive run MUST also bound its transforms per run
(ADR 022 §1.6). An automation run's time limit bounds its transforms.

## 2. Rationale

QuickJS is an interpreter with no JIT, so a large transform in QuickJS is
slow. The host app already bundles the BXL engine, which runs at full
JavaScript speed. Running there costs no round trip and puts no load on the
realm server. It gives the script no new authority: a program is data, not
code, and under the `transform` profile it does no I/O and can't import. One
profile for operation programs and script transforms also means the assistant
learns one set of rules.

The BXL evaluator is large and synchronous. In the worker that serves the UI,
or in the QuickJS worker, a long program would block everything else. In a
worker of its own, the host can stop a program that stalls by ending the
worker, and other runs in the same tab are unaffected. One worker per run
pays the start-up cost once, rather than on every call.

Step metering bounds a program's own loops. It does not bound a single
regular-expression match, which can backtrack for a long time inside one
step, and ADR 015 §3 rejected authored regular expressions on the server for
that reason. Here a program may carry an authored pattern, so the
wall-clock limit that ends the worker is what bounds it. BXL's default step
limit would refuse an ordinary map over a few thousand objects, so the limits
are set to the ones the tool advertises.

## 3. Considered options

- **A per-run worker beside QuickJS, under the `transform` profile
  (chosen).**
- **Evaluate in QuickJS.** It has no JIT, and a stalled program can't be
  stopped without stopping the script.
- **Evaluate on the realm server.** Each call becomes a round trip, and
  authored programs and patterns load the server that every realm shares.
- **The full `compute` profile.** It allows every function, including those
  with side effects, and it would give operation programs and script
  transforms two sets of rules.
- **A worker per call.** Every call pays the worker's start-up and BXL's
  load.
