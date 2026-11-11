---
status: proposed
date: 2026-09-16
retroactive: true
recorded: 2026-11-09
scope:
  - packages/runtime-common/clock.ts
  - packages/base/**
  - packages/school-example-realm/**
  - packages/host/app/**
  - packages/pretui/components/**
  - packages/boxel-ui/src/components/**
  - packages/host/tests/helpers/test-clock.ts
  - packages/host/tests/test-helper.js
  - eslint/ambient-clock-selectors.cjs
---

# 023. Read the current time for rendering through a clock that tests pin

Anything that renders a value derived from the current time (an age, a
countdown, an "expires soon" warning, a greeting by hour) reads the time through
one seam, `now()` / `nowDate()` in `@cardstack/runtime-common`. The seam
returns the real time unless something pins it, and the host test suite pins it
to one fixed instant. A visual comparison of such a value then compares the
code, not the time the suite ran at, and the value stays visible to Percy
instead of being hidden from it.

## 1. Decision

### 1.1. Rendered values

Code that renders a value derived from the current time MUST read the time
through the seam: `now()` or `nowDate()` from `@cardstack/runtime-common`, or
from `@cardstack/base/helpers/clock` in card code. It MUST NOT call
`Date.now()` or a zero-argument `new Date()` for that value. It MUST NOT call a
library function that reads the clock itself, such as date-fns
`formatDistanceToNow`. It passes the seam's instant to that library instead.

### 1.2. Stamps that are rendered later

A timestamp that is stored and later rendered relative to the current time MUST
be stamped through the seam too, so that the stamp and the measurement are on
one timeline.

### 1.3. Timing, expiry and telemetry

Outside the code that §1.7 covers, code that reads the time to schedule work,
time out, expire a token, or measure duration SHOULD read the real clock, not
the seam.

### 1.4. The test instant

The host test suite MUST pin the seam to one fixed absolute instant,
`TEST_CLOCK_INSTANT`. The instant MUST NOT be derived from the real clock.

### 1.5. Hiding from Percy

A test SHOULD NOT hide a value derived from the current time from Percy (for
example with `data-test-percy-hide`) when pinning the seam makes the value
stable. The pin does not make two kinds of value stable: a value derived from a
file's mtime, and a stamp that the realm server minted. Hiding them is not a
departure from this requirement.

### 1.6. Components that cannot import the seam

A shared component in a package that does not depend on
`@cardstack/runtime-common` MUST NOT read the clock for a rendered value
without letting its caller supply the time, for example as an argument. A
caller that renders such a component MUST pass the time from the seam.

### 1.7. Card code

In `packages/base` and `packages/school-example-realm`, every read of the
current time MUST go through the seam, including a read for timing.

## 2. Rationale

A renderer that reads the clock directly produces different output for the same
data on different days. A visual snapshot of it differs between two builds of
identical code [#6012]. Realm fixtures make this worse: their mtimes are
fingerprints of their content, spread across decades, so a label changes when
real time crosses a unit boundary, not when the code changes [#6012]. Before
the seam, the only remedy was `data-test-percy-hide`, which stops comparing the
element and so loses the coverage [#6012]. The file inspector's created date
was hidden that way [#5907]. With the time pinned, a value stays in the
snapshot, and a change in how it is formatted still shows as a diff [#6012,
#6043].

The seam is a global, `globalThis.__boxelNow`, because the card loader gives
card code its own module instances, so a module-level variable is not shared
between card code and the host [#6012, `clock.ts`]. It is in runtime-common
because the host renders elapsed time from the same timestamps that card code
does. A pin that reached only card code made the host show "Last saved in 6
days" [#6043].

Stamps must move with the clock (§1.2). `realm_file_meta.created_at` and the
fixture file stamps are minted through the seam. If they were minted on the
real clock and measured from the pin, the snapshots would start to move when
real time passed the pinned instant [#6043, `test-clock.ts`].

Token expiry stays on the real clock (§1.3). It is auth arithmetic, not a
rendered value. Freezing it would change when a test's tokens are live
[#6043]. The instant is absolute (§1.4) because Percy compares against a
baseline from another day, so an instant derived from today drifts by
construction [`test-clock.ts`].

A component outside runtime-common's dependents can still be pinned through its
caller (§1.6). The boxel-ui date range picker opened on the real month while
its field's bounds came from the seam, so a host test failed once the real
month left the pinned one. The fix gave the picker an argument for the day it
opens on, which the field reads from the seam [#6433].

Some values stay unstable under the pin (§1.5). CI sets the mtime of each file
it serves from disk to a hash of the file's content, so a date derived from it
changes when the bytes change, not when the code does
[`scripts/normalize-realm-mtimes.mjs`, `file-shell-fitted.gts`]. The realm
server reads the seam too, but nothing pins it there [`clock.ts`]. So a stamp
it mints, such as the `created_at` of a file in a realm served from the index
cache, is the real time of the index build [`file-meta.ts`]. #6043 moved that
stamp onto the seam, which pins it only in realms the suite indexes in the
browser [#6043].

In card code, the seam covers timing reads too (§1.7). #6022 also routed the
reads that nothing displays, such as a parser's reference date, so that the
lint rule that guards the seam stays a flat rule with no exceptions [#6022].
That rule is `eslint/ambient-clock-selectors.cjs`, which both
`packages/base` and `packages/school-example-realm` apply. The host has no
such rule, because most host reads are §1.3 cases, where a blanket rule would
be wrong [`clock.ts`].

## 3. Considered options

- **One pinnable seam, pinned by the suite (chosen).**
- **Hide time-dependent elements from Percy.** The tool the repository had
  before, used for the file inspector's created date [#5907]. It removes the
  element from the comparison [#6012].
- **A module-level variable instead of a global.** The card loader's separate
  module instances would each have their own copy [#6012].
- **Pin card code only.** The host renders the same timestamps, and showed a
  saved time in the future [#6043].
- **Pin the clock but leave fixture stamps on the real clock.** Every in-browser
  fixture would then report an age that grows by a day at a time [#6012].
- **A lint rule over the whole host app.** Most host reads are timeouts and
  telemetry, where the real clock is correct [`clock.ts`].

## 4. Sources

- #5907: hides the file inspector's created date from Percy.
- #6012 (b9a47672dc): gives card code one clock to read.
- #6022: guards the seam with a lint rule in `packages/base`.
- #6043 (075e844d0b): pins the suite's clock and moves the stamps with it.
- #6433: opens the date range picker on a day its caller supplies.
- #7308: reads the dashboard greeting's hour through the seam.
- `packages/runtime-common/clock.ts`, `packages/runtime-common/file-meta.ts`,
  `packages/host/tests/helpers/test-clock.ts`,
  `packages/base/file-formats/file-shell-fitted.gts`,
  `scripts/normalize-realm-mtimes.mjs`, `eslint/ambient-clock-selectors.cjs`.

## 5. Remediation

Known gaps are listed in [remediation/023.md](remediation/023.md).
