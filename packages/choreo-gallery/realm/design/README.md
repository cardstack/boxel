# Design notes

This is the workshop, not the documentation. Everything here is a draft,
a design record, a handoff, a measurement or a production script — kept
because it says _why_ something is the way it is, and cited from the
source where the reasoning matters.

**The documentation is in [`docs/`](../docs/README.md).** If you are trying to use
Choreo, start at [the guide](../docs/guide.md) and
[the construct reference](../docs/choreo-constructs.md). Nothing in
this folder is a reference, and some of it describes things that were
proposed and never built, or built and then changed.

The notes were written in Choreo's own repository, before it moved into the
Boxel monorepo, so the source paths they name (`test-app/…`,
`packages/glimmer-motion/src/choreo/…`) are that repository's layout at the
time. The demos are now cards in this realm, Choreo and Film are
`packages/choreo`, and the films' app is `packages/choreo-film-app`.

## What is here

**Design records** — the argument behind a construct, written before or
during the work.

- [film-construct.md](film-construct.md) — toward `<Film>`: the two
  reference films, the duplication measured, the fork between a seekable
  film and a chased one. The as-built reference is
  [film.md](../docs/film.md).
- [choreo-composition.md](choreo-composition.md) — the compositor.
- [drift.md](drift.md) — a driving model written by hand, and why a
  score was the wrong shape for it.
- [dialkit.md](dialkit.md) — an evaluation: what a parameter-tuning
  panel would cost and what of it is worth taking.
- [sylva-one-world.md](sylva-one-world.md) — making 2D and 3D read as
  one world.
- [demos-as-applications.md](demos-as-applications.md),
  [hyperframes-choreo-foundation.md](hyperframes-choreo-foundation.md) —
  proposals.
- [camera-api-wishlist.md](camera-api-wishlist.md) — what `<c.Camera>`
  was missing, written from the outside.
- [film-graph/](film-graph/README.md) — the films as a graph: the memo's
  sketches, the constructs, the revisions log and the plan.
- [docs-studies-plan.md](docs-studies-plan.md) — focused, tunable teaching
  studies, planned rather than shipped.
- [documentation-site.md](documentation-site.md) — the guides site: its four
  learning paths, how a guide is written and registered, live tuning, and
  teaching coverage.

**Handoffs and measurements** — written for whoever picks the work up.

- [external-clock-camera-seek-handoff.md](external-clock-camera-seek-handoff.md)
- [subdivision-browser-timing-test.md](subdivision-browser-timing-test.md)
- [towers-porting-delta.md](towers-porting-delta.md),
  [towers-quality.md](towers-quality.md)
- [sagrada-web-model.md](sagrada-web-model.md) — the Sagrada picture's
  procedural model pass
- [gallery/](gallery/README.md) — the 3D gallery room and its narrated
  tours: room design, tile capacity, tour script and pacing, performance

**Film production** — the scripts, the wall text, the narration.

- Towers: [towers-about.md](towers-about.md),
  [towers-wall-text.md](towers-wall-text.md),
  [towers-vo.md](towers-vo.md), [towers-vo-files.md](towers-vo-files.md),
  [towers-vo-pronunciation.md](towers-vo-pronunciation.md)
- Sagrada Família: [sagrada-film.md](sagrada-film.md),
  [sagrada-vo.md](sagrada-vo.md)

## Maintenance

Completed Towers recording requests and branch handoffs have been consolidated
into [the narration record](towers-vo-files.md). Keep scripts, measurements and
reasoning that still explain the work; remove transient task queues once their
outcome is captured. Historical proposals here are not evidence that an API shipped.
