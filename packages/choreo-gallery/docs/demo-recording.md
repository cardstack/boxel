# Demos that record

> For anyone — human or agent — wiring a demo to an external clock
> (HyperFrames capture, or any frame-by-frame recorder). Every rule here
> is a bug that was actually shipped in this repo, not a precaution.

A recorded demo has to be two things at once: a page a person pokes at,
and a deterministic function from time to pixels. Those two are in direct
tension, because they both want the same thing — **the transport**.

The parent documents are [choreo-constructs.md](choreo-constructs.md) and
[step-vocabulary.md](step-vocabulary.md).

- [The one rule](#the-one-rule)
- [Arming: who owns the clock, and when](#arming-who-owns-the-clock-and-when)
- [The first render plays nothing](#the-first-render-plays-nothing)
- [Determinism: what a seek must reproduce](#determinism-what-a-seek-must-reproduce)
- [Things that pause themselves](#things-that-pause-themselves)
- [Checklist](#checklist)

## The one rule

**Do not hand your run to a recorder until a recorder exists.**

The player's whole job is to `pause()`, set `time`, and set `speed` on the
runs it is given. That is not a neighbouring concern to the demo's own
transport — it _is_ the demo's transport, operated by someone else. Hand
it over unconditionally and the two share a clock, and every question
("where should the playhead be?") is answered by whichever wrote last.

This is not hypothetical. `playhead.gts` called `player.sync()` from
`observeRun` — every time Glimmer published a new run, which is correct
during a capture and wrong every other time. `sync()` pauses every run it
is handed and seeks it to the recorder's clock, and that clock starts at
zero. So on an ordinary visit each newly adopted run was quietly paused
and rewound. The symptom was three tests' worth of downstream weirdness
and one clear failure: a scrub landing on `transform: none`, because the
scene it scrubbed had been reset out from under it.

Two guards, because there are two ways in:

```ts
private recording = false;

private player = createChoreoPlayer({
  // every player entry point calls prepare() first, so the recorder
  // arms this by arriving — and nothing else can
  prepare: () => { this.recording = true; },
  runs: () => (this.recording && this.scoreRun ? [this.scoreRun] : []),
});

private observeRun(run) {
  …
  if (this.recording) {
    void this.player.sync({ settle: false });
  }
}
```

`runs()` gates what the recorder can touch; the `observeRun` guard stops
ordinary run adoption from _initiating_ anything. You need both: without
the second, `sync()` calls `prepare()`, which arms the first.

## Arming: who owns the clock, and when

- **Never arm in a constructor or a class field.** The demo mounts on
  every ordinary page view; the recorder does not.
- **Arm on the recorder's first call**, not on your own state. `prepare()`
  is that hook — it runs at the top of `play`, `renderAt`, `seek` and
  `sync`.
- **Never un-arm.** A capture is a session, not a call. Once an external
  clock has asked for a frame, it owns the transport for the life of the
  page.
- **Interactive controls should keep working while armed** only if you
  actually want them to. During a capture nobody is clicking, so the
  simplest correct thing is for the recorder's writes to win.

## The first render plays nothing

A `<Choreo>` region deliberately compiles no timeline on its first render
— page loads do not animate. That is right for a person arriving and
wrong for a capture worker, which starts on a fresh page and seeks
immediately: its first frames would be the parked opening, and they read
as reset flashes in the finished video.

So a recorded demo must make the scored pass **exist** before the first
seek. Do it in `prepare()`, where you know a recorder has arrived:

```ts
prepare: () => {
  this.recording = true;
  if (this.take === 0) {
    this.take++;   // force the pass the recorder is about to seek into
  }
},
```

Anything else that only happens after a user gesture — a first click, an
intersection observer firing, a `setTimeout` that boots the scene — has
the same problem and needs the same treatment.

## Determinism: what a seek must reproduce

A recorder seeks to arbitrary times, in arbitrary order, often across
parallel workers on separate pages. Frame _t_ must be a function of _t_
and nothing else.

- **No wall clock.** `Date.now()`, `performance.now()`, and anything
  derived from them are not reproducible across workers. Read `run.time`.
- **No randomness.** If a demo needs jitter, seed it from the item's
  index, not `Math.random()`.
- **No accumulation.** A value that integrates — `x += velocity * dt` —
  cannot be sought backwards. Everything must be recomputable from the
  clock. This is the same purity rule `c.Follow`'s `@read` lives under,
  and for the same reason.
- **No dependence on frame count.** "After three frames" is a different
  moment on a 60fps screen and in a 30fps capture. Anchor to the
  timeline: `@at`, `@delay`, `{{after 'name'}}`.
- **Derived values are fine, and are the good answer.** A `c.Follow`
  reading a live box is reproducible precisely because it is a pure
  function of the scene at that instant — and the scene at that instant
  is a function of the run's time.

## Things that pause themselves

A demo that pauses when it is off screen — Build Order's
`IntersectionObserver`, and anything like it — will stall a capture
worker, which may render into a viewport the element never intersects, or
into a page that is never scrolled.

If your demo gates itself on visibility, the gate has to yield to the
recorder:

```ts
if (this.onstage || this.recording) { … }
```

The same applies to gating on focus, on hover, on `document.hidden`, or
on any other "is a person here?" signal. A recorder is not a person and
answers `false` to all of them.

## Checklist

Before calling a demo recordable:

1. Its run is only handed to the player once `prepare()` has fired.
2. Nothing in the demo's own lifecycle calls `sync`/`seek`/`play` on the
   player unless armed.
3. The scored pass exists before the first seek (`take`, or equivalent).
4. Every visible value is a function of `run.time` — no wall clock, no
   randomness, no accumulation, no frame counting.
5. Self-pausing gates (visibility, focus, hover) yield while recording.
6. **The interactive tests still pass.** This is the one that catches
   everything above: the recording wiring is the most common way to break
   a demo for the people who are not recording it.
