# The films, as a graph

> **Status: sketch.** Nothing here compiles. `f.Spine`, `f.Chapter`,
> `f.Shot`, `f.Join`, `f.Attach` and the attachment components do not
> exist. These files exist so the proposed syntax can be read against two
> real films before any of it is built. The design they follow is the
> 2026-09-03 memo _Film as a Graph_ (an artifact; to be filed here).

| file            | what it is                                                                                              |
| --------------- | ------------------------------------------------------------------------------------------------------- |
| `sagrada.gts`   | Sagrada Família, 29 shots in 5 chapters, in the graph syntax                                            |
| `towers.gts`    | Towers, 26 shots in 5 chapters, in the graph syntax                                                     |
| `mockup.gts`    | the Mockup demo as a film: six scenes, jump cuts and joins it could not say                             |
| `long-take.gts` | the Long Take as a film: one shot, two cameras, the inner one a lane of each shot                       |
| `sylva.gts`     | Sylva as a film: a custom shot kind whose pose is a query on the picture; planes that replace           |
| `replate.gts`   | Replate as a film: a reel attached to a moving anchor through a time map; one filter, not an adjustment |
| `tograph.mjs`   | the converter: reads a film's `BEATS` table and emits its spine, verbatim                               |
| `REVISIONS.md`  | the running log: what each demo changed in syntax, library, parameters                                  |
| `CONSTRUCTS.md` | the rationalisation: two engine constructs, and what everything else is                                 |
| `PLAN.md`       | what it takes to make this the baseline: comfort, spikes, phases, sizes                                 |
| `SPIKES.md`     | the two spikes' written results: the lane door passes; the fold's order is pinned                       |

Both spines were **generated** from the beat tables on `origin/main`
(`2547ded`), not written by hand, so every pose, phrase, stamp and trace is
the film's own and the translation can be re-run when the tables move:

```bash
CHAPTERS='[…]' node docs/film-graph/tograph.mjs test-app/app/components/sagrada-film.gts
```

## The legend

One clock, and things dropped on it. Three relationships, and a region
never knows which one it is in.

| node                                    | is                                                                                                                                                  | elsewhere                                           |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `<Film as \|f\|>`                       | the region; one clock; yields the vocabulary and the handle                                                                                         | the composition                                     |
| `f.Spine @join`                         | a `c.Sequence` of items; `@join` is the seam a shot gets when it names none                                                                         | OTIO Track, FCP spine                               |
| `f.Chapter @n @title @grade @lut`       | a named sequence inside the spine; the menu and the rail read it                                                                                    | Unreal shot group                                   |
| `f.Shot @name @ticks @dolly @yaw …`     | a named composite step: one camera segment and its cues; `<f.To>` is the tail pose                                                                  | OTIO Clip                                           |
| `f.Join @presentation @to`              | a sibling **between** two shots; consumes their handles; built on `c.Crossing`                                                                      | OTIO Transition, Remotion Transition                |
| `f.Attach @to @at @for @lane @end`      | a window on a base item's time over any region; driven, never played                                                                                | FCP anchored item, compositor `Clip`                |
| `f.Type`, `f.Voice`                     | the film's own attachments: a title region, an audio clip                                                                                           | tracks                                              |
| `f.picture.*`, `f.sound.*`              | ADJUSTMENTS: typed parameter sets the actor declares, yielded by the film, held for a window; `Look` is a FILTER, the kind that processes the frame | AE adjustment layer, FCP `adjust-*`, Motion filters |
| `f.Stamp`, `f.Sky`, `f.Mark`, `f.Trace` | attachments anchored **in the world**, projected per frame                                                                                          | AE parenting                                        |
| `<Insert>`, `<Freeze>`, `<Video>`       | regions the film does not own, placed with `f.Attach`                                                                                               | Motion titles, precomps                             |
| `<Gate>`, `<EndCard>`                   | the film's own regions, attached at `f.head` and `f.tail`                                                                                           | title cards                                         |
| `<Player>`                              | UI, off the timeline; holds the handle and edits the clock                                                                                          | the transport                                       |

A child of a `f.Shot` is attached to it with `@to` implied, on the shot's
own clock. A `f.Attach` at film level names its base. Both are the same
node.

## What moved, in lines

| film    | beat table before | spine after | shots | joins named | attachments |
| ------- | ----------------: | ----------: | ----: | ----------: | ----------: |
| Sagrada |             1,161 |       1,224 |    29 |          13 |         125 |
| Towers  |               797 |         887 |    26 |          11 |          80 |

Both are longer than their tables now: a pose is seven flat arguments
instead of one object, and a filter is a line per parameter set. The count
that matters is the last column: each of those is a thing that can now be
added, removed, moved to another shot or replaced by an author's own
region without touching a row.

## What the sketch shows that the memo only claimed

- **The joins read as edits.** `<f.Join @presentation="whip" />` before
  `gruistes` is the cut; `<f.Join @presentation="dip" @to="#0d0905" />`
  opening chapter two is the dip through near-black. The spine's `@join`
  covers the rest, which is why most shots have none.
- **The freeze frame is an attachment with a window**, not a beat field:
  `<f.Attach @lane={{2}} @at={{3}} @for={{8}} @end="hold"><Freeze …/></f.Attach>`
  under `gruistes`. The same node places a photograph under `azuchi`.
- **The door is a region the film hangs on its head.** `f.Attach @to={{f.head}}`
  with the gate's matter inside; the engine owns an attachment point, not a
  named block. The gate reads `f.chapters` for its index instead of five
  hard-coded spans.
- **The picture is a component in a named block.** `<:picture><SagradaPage
@standing @seat @rigMid @cityGlass /></:picture>` replaces six film
  arguments that were only ever about the page behind the iframe, and the
  page declares its own filters. The remaining film arguments are all
  about the edit.
- **Inheritance, and its one rule.** Towers' six comparison shots said
  `@cut`, `@hold`, `@bob`, a lower third and `<f.Mix @wx={{0}} />` six
  times. In the sketch they sit in `<f.Sequence @name="six" @join="blend"
@shot={{hash cut=true hold=true bob=0.85}}>` with one `f.Type` and one
  `f.Mix` attached to the group. Two mechanisms, deliberately different:
  an **attachment** on a group is in force for the group's window and a
  shot's own attachment of the same kind beats it, field by field (the
  `generic` yield rule one level up); a **shot default** (`@shot`, `@join`)
  is a fact about the shot the group fills in when the shot is silent.
  Both resolve when the score compiles, so at run time every shot still
  asserts its complete state and exact mode's fold rule holds. c-kh keeps
  its own `@bob`; the melt into Thailand stays. The group is `c.Sequence`
  wearing the film's defaults, not a new node.

## Not decided by this sketch

- Whether a chapter is a node or a label. It is drawn as a node because
  the menu and the rail already treat it as a span.
- Whether `f.Voice @read` keeps naming the measured read explicitly or the
  film resolves it from an id. Explicit is shown because the read is the
  fact the whole beat's length hangs on.
- The name `f.Air` for grade, weather, hour, sun and rim together. It is
  the engine's own word (`onAir`, `settleAir`).
