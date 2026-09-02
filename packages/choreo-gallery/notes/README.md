# Working notes

This is the workshop, not the documentation. Everything here is a draft,
a design record, a handoff, a measurement or a production script — kept
because it says _why_ something is the way it is, and cited from the
source where the reasoning matters.

**The documentation is in [`docs/`](../docs).** If you are trying to use
Choreo, start at [docs/guide.md](../docs/guide.md) and
[docs/choreo-constructs.md](../docs/choreo-constructs.md). Nothing in
this folder is a reference, and some of it describes things that were
proposed and never built, or built and then changed.

## What is here

**Design records** — the argument behind a construct, written before or
during the work.

- [film-construct.md](film-construct.md) — toward `<Film>`: the two
  reference films, the duplication measured, the fork between a seekable
  film and a chased one. The as-built reference is
  [docs/film.md](../docs/film.md).
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

**Handoffs and measurements** — written for whoever picks the work up.

- [external-clock-camera-seek-handoff.md](external-clock-camera-seek-handoff.md)
- [subdivision-browser-timing-test.md](subdivision-browser-timing-test.md)
- [towers-porting-delta.md](towers-porting-delta.md),
  [towers-quality.md](towers-quality.md)

**Film production** — the scripts, the wall text, the narration.

- Towers: [towers-about.md](towers-about.md),
  [towers-wall-text.md](towers-wall-text.md),
  [towers-vo.md](towers-vo.md), [towers-vo-files.md](towers-vo-files.md),
  [towers-vo-requests.md](towers-vo-requests.md),
  [towers-vo-handoff.md](towers-vo-handoff.md),
  [towers-vo-pronunciation.md](towers-vo-pronunciation.md)
- Sagrada Família: [sagrada-film.md](sagrada-film.md),
  [sagrada-vo.md](sagrada-vo.md)
