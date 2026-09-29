# What we actually need

Four sketches (Sagrada, Towers, the Mockup, the Long Take) introduced about
thirty names. Sorted by what each one really is, **two** of them are new
engine constructs. Everything else is an existing Choreo construct under a
film name, a composite step written against the public `node()` contract,
a member on a port, an attribute on a block, or a component in the film
package. This is the list, and the argument for each line.

## The sort

| name in the sketches                                                     | what it is                                                                                                                                                                                                  | needs                        |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `f.Spine`, `f.Chapter`, `f.Sequence`, `f.Lane` (as a block)              | `c.Sequence` with film defaults (`@join`, `@shot`) resolved by the film's compiler                                                                                                                          | package                      |
| `f.Shot`                                                                 | a composite step: one `Camera3D` (or `Camera`) segment plus its cues; the head pose is its own args, `@by` is `Camera3D @by`                                                                                | package                      |
| `f.To`, `f.Eye`                                                          | the tail pose and the eye-level walk, as typed children of the shot                                                                                                                                         | package                      |
| `f.Cue`                                                                  | `c.Perform` with an actor as target; `@via="text"` is the compatibility adapter                                                                                                                             | rename                       |
| `f.Join`                                                                 | a composite over `c.Crossing` whose outgoing sprite is a still; presentation × timing                                                                                                                       | package + port               |
| `f.Attach`                                                               | **a driven run over another region, with an edge tuple**                                                                                                                                                    | **engine**                   |
| `f.Lane @in`                                                             | an attachment that _supplies_ the child region's timeline                                                                                                                                                   | engine (a face of Attach)    |
| `f.Reel`                                                                 | an attachment whose region is a `Film`                                                                                                                                                                      | nothing beyond Attach        |
| `f.Type`, `f.Voice`                                                      | film attachments: a title region, an audio clip, on the shot's clock                                                                                                                                        | package                      |
| ~~`f.Air`, `f.Build`, `f.Mix`, `f.Lineup`~~ → `f.picture.*`, `f.sound.*` | **adjustments: typed components the actor declares and the film yields**, held for a window; a **filter** is the kind that processes the frame (`Look`, `Lut`); the names are the page's, not the package's | package (over Value's ports) |
| `f.Stamp`, `f.Sky`, `f.Mark`, `f.Trace`                                  | world-anchored attachments: **a value derived per frame from the projector**                                                                                                                                | **engine** (Value)           |
| ports (`@inputs`/`@outputs`), `c.Bind`, `n.Value`, `n.Cue`, `n.Anchor`   | **a named value that is a function of the clock and other values**                                                                                                                                          | **engine** (Value)           |
| `Insert`, `Freeze`, `Video`, `Gate`, `EndCard`                           | regions; `Video`/`Freeze` use the clip arithmetic that already exists                                                                                                                                       | package                      |
| `Player`                                                                 | UI off the timeline holding the handle                                                                                                                                                                      | package                      |
| `<:picture>`, `<:still>`                                                 | named blocks: the actor that draws the frame (and declares its filters); the photograph of it at rest                                                                                                       | port                         |
| `@seek`                                                                  | exact = every attached run driven; cut = chased. Already the fork                                                                                                                                           | exists                       |
| `@lens`                                                                  | which camera step a shot compiles to; `still` = poster + paused                                                                                                                                             | package                      |
| `@mute`                                                                  | a block that keeps its length while muted                                                                                                                                                                   | block attribute              |
| `@end`, `f.play` / `f.restart`                                           | run-level loop / hold, resume vs re-cut                                                                                                                                                                     | run API                      |
| `@bias`, path names                                                      | who wins when two nodes drive one target; names across nesting                                                                                                                                              | engine (part of Attach)      |
| `@ease`, `@autoplay`, `@still`, `@clock`, `@grades`, `@lookFx`, …        | film arguments                                                                                                                                                                                              | package                      |

## The two constructs

### 1 · Attach — a driven run

The one new _relationship_. Today a nested `<Choreo>` isolates: its own
changeset, its own run, no shared clock. An attachment crosses that
isolation in exactly one direction — the parent writes time into the
child's run — and never merges changesets.

```
Attach {
  region:  the child <Choreo>                 // by reference; the same region may be attached twice
  to:      a named item in the parent, or head/tail
  at:      offset into the base item's time   // seconds, or an anchor: at('shot', 0.6)
  for:     window length                      // default: to the base item's tail
  in, out, rate:  the child's source window   // clips.ts arithmetic, already pure and tested
  map:     parent time → source time, a curve // the general case; in/out/rate is the linear one (Replate)
  end:     'remove' | 'hold' | 'freeze'
  lane:    z, sign = above/below the base
  bias:    integer; child steps beat parent steps on a tie (default: child + 100)
}
```

Invariants, all already written down somewhere in this repo:

- **Driven, not played.** The child's run is paused; every frame the
  parent writes `run.time = map(t)`. That is `Plate @grab` plus the
  exact-mode time write, made public.
- **A child may not integrate under an exact parent.** A spring or a
  smoothed follow inside an attached region is a compile-time refusal
  when the parent declares `exact`; allowed under `cut`. The long take's
  "seekable by construction" is this precondition stated from the other
  side.
- **The window is arithmetic.** Absent before `at`, active inside,
  then the end policy — `resolveClip` unchanged. A `map` is a Value:
  pure, so a scrub back is a scrub back (Replate's remapped playhead).
- **An attachment may sit on a moving anchor.** `@to` may be a beacon
  the picture publishes per frame (Replate's program monitor, four
  corners read off a table); the attachment is corner-pinned to it.
- **Names are paths.** A child's names are visible to the parent as
  `attachment/name`, and a parent anchors only against what the child
  publishes (its span, its marks, its outputs), never its inner steps.
- **Natural duration flows up.** An attachment's extent is the child's
  extent unless `for` says otherwise; a Reel in a Spine is measured, not
  declared.

Two faces of the same construct, because they differ only in who
supplies the child's timeline:

- **Attach a region that has its own score** (a title, an insert, a
  whole film). The parent drives the run the region compiled.
- **Attach a region and supply its score** (`f.Lane @in`). The parent
  registers a provider into the child's `collect()` — the registry's
  `WeakMap<Element, Provider>` is already open — so steps written in the
  parent resolve their queries (`b.id "capsule"`) in the child's
  changeset and play on the parent's clock. The long take's inner camera.

What it subsumes: the compositor doc's `Clip` (Phase C3), the film's
exact-mode driving of Plate and Insert, `Beat.clip`, the long take's sync
loop, the memo's `f.Reel`, and the gate / end card as named blocks.

### 2 · Value — a named number that is a function of the clock

The second new _capability_. `c.Follow` already computes a sprite's
transform per frame from the pass's measurements, purely. A Value is the
same derived cue with two generalisations: it may **write a value** (a
custom property, a declared output, another step's parameter) rather
than a sprite's transform, and it may **read** the clock, other values,
and the picture's projector as well as sprite boxes.

```
Value {
  name:    published; readable by Bind and by the panel
  read:    (ctx) => number | string      // pure; ctx = { t, p, values, boxes, project }
  rest:    what it is when not driving   // required, as for follow
  write:   '--custom-prop' | an output port | a parameter on a named step
}
Bind  = a Value whose read is `map(values[from])`
Ports = the declaration: { name, type, default, range } for inputs; outputs are Values the region publishes
```

Invariants, lifted whole from "what derive must not do":

- pure (same `t`, same answer — a `@debug` lint calls it twice)
- no memory (a smoothed value is an integrator and breaks the scrub)
- evaluated after its sources; a cycle is a compile error
- writes only transform / opacity / filter / custom properties — never
  layout
- declares a rest

What it subsumes: adjustments (the constant case: a declared input held
for a window), `n.Value`, `n.Cue` (an envelope against a measured read),
`n.Anchor` (a projected world point), the rail's head and readout,
the stamp / sky word / mark / trace placement, the film's per-frame
custom-property writers (`--cf-head`, `--cf-type-a`), `c.Tether`, the
automation the memo asked for, and the panel `dialkit.md` wants to
generate.

## Adjustments — what `f.Air` should have been

`f.Air` was a smell: grade, weather, hour, sun, rim, lightning, city,
grass are the knobs of one WebGL page, and `f.Build`, `f.Mix` and
`f.Lineup` are three more bundles of the same kind. The editing tools have
two words for what they are, and the sketches now use both.

An **adjustment** is an attachment that holds parameter values on an actor
for its window, applying to everything under it — After Effects' and
Premiere's adjustment layer, Resolve's Adjustment Clip, Blender's VSE
Adjustment Layer, Photoshop's adjustment layers, FCPXML's `adjust-*`,
Unity's Volume overrides with priority and weight. A **filter** is the
kind of adjustment that processes the frame — a grade, a LUT, a look, a
blur: Motion's Filters, MLT's `filter`, FCPXML's `filter-video`, CSS
`filter`, Core Image. Photoshop draws the line: a filter is a pixel
operation, an adjustment is a parameter held above the stack.

The parameters are whatever the actor _declares_, and the declaration is
idiomatic Ember: the actor is a component, its adjustments are components
it yields, and their arguments are typed by their own Signatures. The
film yields them under the actor's name:

```hbs
<Film @seek='exact'>
  <:picture><SagradaPage @standing={{T_TODAY}} @rigMid={{6.6}} /></:picture>
  <:default as |f|>
    <f.Shot @name='gaudi' @ticks={{6}} @dolly={{0.9}} @yaw={{122}} @pitch={{7}}>
      <f.picture.Look @grade='iron' @lut='iron' />
      {{! a filter: it processes the frame }}
      <f.picture.Weather @theme={{2}} @wx={{2}} />
      {{! an adjustment: a held value }}
      <f.picture.Sun @az={{-100}} @el={{14}} />
      <f.picture.Build @clock={{tAt 1926.5}} />
      <f.sound.Mix @music={{0.4}} />
    </f.Shot>
  </:default>
</Film>
```

- **An attached region declares its own.** `f.ours.Look` on Replate's
  overlay reel: the film yields an attachment's adjustments under the
  attachment's name, so a chapter can grade the overlay and not the plate.
- **The names come from the actor.** `Weather`, `Sun`, `Winter`, `Light`,
  `Look`, `Set`, `Build` are `SagradaPage`'s; a third film with a video
  behind the port yields `Exposure` and `Speed` and never sees `haze`.
  The package knows nothing about weather.
- **Typed, not smuggled.** An adjustment's arguments are a Signature, so
  Glint checks `@az` on `Sun` and rejects it on `Weather`. This is what
  `@with={{hash …}}` could never do, and why it was wrong.
- **A preset is an adjustment with a name.** `Chapter @grade="amber"` is
  the page's `amber` bundle attached to the chapter — Final Cut's effect
  preset, Motion's rig snapshot, a Unity volume profile. `GRADES` and
  `LOOK_FX` stop being film arguments and become the page's own presets.
- **An adjustment on a group or a chapter is the adjustment layer**: in
  force for the window, overridden field by field below it (the
  inheritance rule, unchanged; Unity's volume priority).
- **An adjustment parameter may be driven** rather than held: Final Cut's
  `fadeIn` / `keyframeAnimation` on a param is a Value writing that port.
  An adjustment is the constant case of Value, and it is what ports were
  for.
- **The package ships two base classes**, `Adjustment` and `Filter extends
Adjustment`. An `Adjustment` knows how to hold its args on the actor for
  the attachment's window and how to merge field by field; a `Filter` is
  an adjustment whose target is the frame, so the package can order it
  after the values it depends on and a seam can freeze it with the still.
  The page ships the vocabulary.

This shrinks the package (four nodes become two base classes) and moves
the vocabulary to where it belongs, the actor.

## What a join transitions — the plane question

Chris, watching the comparison chapter: "we also have to figure out
whether the transition applies ALSO to the background radial gradient.
Seems like it should, but we need an idea that the transition applies to
the GROUP or the Plane of the composite."

He is right that it should, and the honest answer is that today a join
transitions exactly ONE thing: the picture. The still is a JPEG of the
canvas, the dissolve happens inside the picture's own glass, and the
overlay sits in `.cf-joins`. Every other layer snaps at the cut — the
scrim (a radial paper wash keyed to the shot's `mode` and the chapter's
palette, `.cf-scrim-lower/-title/-plate/-point`), the cloud, the dim, and
all the furniture. For a cut that is correct. For a dissolve it is two
edits at once: the picture cross-fades while the wash behind the type
changes on one frame.

**Precedent.** Neither Final Cut nor After Effects lets you enumerate
what a transition covers. In FCP a transition sits between two clips on a
lane and transitions the composited output of that lane; to include a
title you put both in a compound clip and move the transition onto the
compound. In AE the same job is a pre-comp: the transition operates on
the rendered result of a nested composition. The answer to "what does
this transition apply to?" is always "whatever its own container
renders". You choose a boundary, you do not list layers.

**So: group, not plane — but the plane is the parameter.** A Group
(`Chapter`, `Sequence`, any `<f.Group>`) is a stretch of TIME holding
spine items; a join already sits between two of them, and time is where a
join lives. A Plane is a LAYER of the composite — a z-order and a
compositing target — which is what the film currently spells as ten
absolutely-positioned boxes and one stacking order in one stylesheet. The
join stays on the group; what it needs is a name for how deep the
boundary goes:

```hbs
<f.Join @presentation='blend' @over='picture' />
{{! today }}
<f.Join @presentation='blend' @over='frame' />
{{! + wash, cloud }}
<f.Join @presentation='blend' @over='everything' />
{{! + type, insert, rail }}
```

Three named tiers, declared by the picture and the film the way
adjustments are — not an open layer list, which is the `f.Air` smell
again:

- `picture` — the glass alone. Cheap: the dissolve stays in the page's
  render target.
- `frame` — the picture and everything DRESSING it: the wash, the cloud,
  the vignette, the grain. Everything whose colour comes from the scene's
  palette. This is the tier Chris is asking for and the right default for
  a dissolve.
- `everything` — the frame plus what is ABOUT the film rather than in it:
  the type, the insert, the clip, the rail, the stamp. Rarely wanted,
  which is why it must be asked for. It is also the same decision as the
  open seam-layer question (see REVISIONS: the seam above the type).

**Do not build the selector yet.** `frame` cannot be implemented by
capturing pixels in the parent: a DOM still of a subtree is not a thing
the platform offers. It can be implemented the other way round, and this
is the part worth deciding first. The post pass ALREADY owns the
vignette, the grain, the split tone, the LUT and the grade, all from the
same palette; the wash and the cloud are the only two members of that
family still in CSS. Move them into the pass as two more terms and the
picture IS the frame: the existing freeze capture picks the wash up for
free, the dissolve crossfades it correctly, and `@over` is not needed for
the tier anybody actually wants. The cost is that four `radial-gradient`
rules become four sets of shader constants.

Recommendation: move the wash and the cloud into the picture, keep the
join where it is, and hold `@over` until something genuinely wants
`everything`. Then it is one enum on `Presentation` beside `secs` and
`still`, not a plane graph.

**Both landed, on Chris's word.** `@over` is built: `picture` (the
default) or `everything`, on `f.Spine`, `f.Chapter`, `f.Sequence` and
`f.Join`, resolving row, then presentation, then film. The spine's is the
film's default and is not written into the rows, exactly like its
`@join`, so the golden fixtures are untouched. `everything` lifts the
seam to `z-index: 5` — above the type, the stamp, the rail, the photos
and the clips; level with the transport, which is later in the document
and stays in front; below the menu, the captions, the door and the fault
banner — and takes the type's wait to zero. Towers runs on it.

**Done, on Chris's word ("move the wash and cloud into the post pass").**
Both are terms in each picture's post pass now, after the grade and the
grain and before the freeze mix — the same place the DOM layers sat. The
film tells the picture through two optional port members, `wash(mode,
paper)` and `cloud(k, rakeDeg)`, and stops rendering `.cf-scrim` and
`.cf-cloud` for a picture that takes them; a picture that does not keeps
the CSS layers, so the port's contract holds. The picture eases a change
of mode itself over the stylesheet's 700 ms.

Verified against the stylesheet rather than by eye, because a CSS
gradient translated into GLSL by hand is exactly the kind of thing that
looks right and is wrong. Each `radial-gradient` was rendered in a real
browser over a known backdrop, the alpha recovered per pixel, and the
shader's formula evaluated over the same grid:

| layer                                           | mean alpha error | worst   |
| ----------------------------------------------- | ---------------- | ------- |
| wash `lower`                                    | 0.0006           | 0.0072  |
| wash `title`                                    | 0.0005           | 0.0072  |
| wash `plate`                                    | 0.0009           | 0.0072  |
| wash `point`                                    | 0.0008           | 0.0072  |
| cloud (two blobs, rotate + translate, multiply) | 0.20/255         | 1.9/255 |

which is 8-bit rounding. The one real bug the exercise found was a
mirrored y: this quad's `vUv` runs bottom-up while a stylesheet's
`at 0% 112%` counts DOWN from the top, so the wash first landed off the
top of the frame instead of below the bottom. The existing shader had
already said so and I did not read it — its vignette writes `0.54` where
the CSS said `46%`. Both new layers now flip once, into a named top-down
`tuv`, and every figure in them is the one the stylesheet had.

And a bug fixed by accident: the DOM still was a snapshot of an UNWASHED
canvas shown under a DOM wash, so it never matched the frame it froze.
On the title-to-shiro wipe the frame where the still appears used to jump
by 12.66 of 255 and then sit frozen for 17 frames. It is continuous now,
with the same 22-frame sweep.

**The rule the tier taught, worth keeping.** Anything that GRADES the
picture has to be inside the picture, or a seam will find it. The dim
(`.cf-dim`, the wash a plate takes when an annotation goes up) was left
in CSS on the first pass because it is not palette-coloured like the wash
and the cloud. Lifting the seam above it exposed exactly that: the still
had no dim, so the first frame of a blend jumped from a mean of 146.9 to
191.1 as an undimmed still landed over a dimmed frame. It is a third term
in the pass now (`dim(k)`), verified the same way — mean error 0.35/255
against the stylesheet at two opacities — and the same seam reads 140.3
to 139.0. The test for "does this belong in the pass?" is not "is it
coloured from the palette" but "would the still be wrong without it".

## Parameter sets, idiomatically

Not a construct, a rule for every sketch: **no `hash`**. A parameter set
is spelled one of four ways, in this order of preference.

| when                               | spelling                        | example                                             |
| ---------------------------------- | ------------------------------- | --------------------------------------------------- |
| the set belongs to the component   | flat typed args                 | `<f.Shot @dolly @yaw @pitch @lookY>`                |
| a second set of the same shape     | a typed child                   | `<f.To @dolly @yaw …/>`, `<f.Eye @from @to @fov />` |
| a whole component the parent hosts | a named block                   | `<:picture>`, `<:still>`                            |
| the names belong to another object | contextual components it yields | `f.picture.Weather`, `f.sound.Mix`                  |

`{{array …}}` stays for a tuple (a world point). `@mute={{array "camera"}}`
is a list. Nothing else takes a bag.

## Small engine changes, not constructs

- **`mute` on a block**: keeps its extent, contributes no cues. The mockup
  and the long take each spell this as `{{#if}} … {{else}} <c.Wait>` by
  hand.
- **`bias: number` on a block or step**: today `generic: boolean`; two
  values are not enough once attachments nest. `generic` becomes bias 0.
- **Run API**: `loop`, `hold`, and `play()` that resumes a run standing
  there. Three demos re-implement the take bump.
- **Picture port**: `snapshot()` and `project()` are the two members a
  Join and a Value depend on; everything else optional.

## Not constructs, and why

- **The join is not an engine construct.** It is `c.Crossing` with a
  still as the outgoing sprite — the film package inserts the snapshot as
  an orphan and the presentation is a composite of tweens on it and on
  the incoming. Rewriting `joins.gts` against the public composite
  contract, with the twelve seams as presentations and the enum deleted,
  is the proof; a custom seam written in the test-app with no library
  privilege is the test. `cutPoint` is a number on the composite.
- **The chapter is not a construct.** A named `c.Sequence` with menu
  metadata; `f.Chapter` is optional and the mockup has none.
- **Inheritance is not a construct.** The film package's compiler fills
  `@shot` defaults and merges group attachments field by field before
  the score is built; at run time every shot still asserts its complete
  state.
- **`f.Cue` is not a construct.** It is `c.Perform` addressed to an
  actor, and the reset-and-replay fold already exists.
- **A Reel is not a construct.** It is an attachment whose region happens
  to be a `<Film>`.

## Order

1. **Attach**, both faces, with the four films re-cut on it: Plate,
   Insert and Clip re-attached in Sagrada with nothing changing on
   screen; the long take's sync loop deleted; a Reel of Towers inside a
   spine.
2. **The film package on top**: Spine / Shot / Join / attachments, the
   beat table as a compiler, `joins.gts` rewritten as presentations.
3. **Value**, with Bind and ports, and the panel generated from the
   declaration. Last because it is the only one that can hurt what works
   today, and the first two are useful without it. Filters land with the
   ports half of this step; until then the two films' pages carry their
   own `Air` as a page-defined filter, not a package one.
