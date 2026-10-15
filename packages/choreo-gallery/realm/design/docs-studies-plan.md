# Focused, tunable studies for the guides

Status: the broader study matrix below remains planned. Three initial tutorial
examples now live in `test-app/app/components/tutorials/`: a task board, CSS-only
spatial card, and recordable scene. They are embedded in the new end-to-end guides
and copied into an independent Ember app by `scripts/create-tutorial-app.mjs`.
They are not catalog demos or additions to the 3D tour. The CSS card establishes
a minimal host boundary; it does not complete the projected WebGL study below.
The existing 46 examples remain composition examples. New studies belong to a
separate docs-only registry and should not appear automatically in the gallery,
3D room, tour, or recorded highlights.

Each study should answer one observable question. Its explanation predicts what
will change before the reader touches the control. Use a small DOM scene or a
local procedural picture, with no large downloaded model, voice subscription,
or external media service. Controls bind to the actual variables in the shown
code. Show units, restore defaults, and include two contrasting presets.

## Spatial studies

| Study / guide                               | Minimal scene and question                                                                                      | Actual controls and useful ranges                                                              | Presets / comparison                                                     |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Frame a subject / spatial-frame             | One subject and three neighbouring cards. What does fit preserve when the viewport changes?                     | fit 0.35–0.9 ratio; margin 0–80 px; move 0.15–1.5 s                                            | Context / Detail; keep the selected subject and vary fit only            |
| Aim versus frame / spatial-frame            | Two targets on one plane. Can attention move without changing zoom?                                             | target X/Y ±200 px; zoom 0.5–2×; move 0.2–1.5 s                                                | Pan across / Reframe; compare stable scale with fit-derived scale        |
| Relative 3D pose / spatial-relative         | One plane and its visible local axes. Which frame owns a translation?                                           | local X/Y/Z ±2 world units; yaw ±60°; pitch ±30°                                               | Local slide / Turn then slide; show world and local coordinates together |
| Camera and look target / spatial-camera3d   | Two flat subjects and a camera path indicator. What changes when the camera moves versus the aim point?         | position X/Z ±4 units; target X ±2 units; field of view 25–70°                                 | Orbit / Look across; keep one input fixed                                |
| Curved path / spatial-paths                 | Three position markers and a subject. How does an intermediate point change the trajectory?                     | middle point X/Y ±3 units; duration 0.5–4 s; supported path interpolation from the current API | Gentle arc / High arc; mark the same sampled times on both paths         |
| Projected DOM / spatial-dom                 | A single live button on a rotated plane, plus a coordinate probe. Do the projected pixels and hit target agree? | yaw ±55°; pitch ±35°; plane width 240–560 CSS px                                               | Front / Oblique; click the button and compare its corner coordinates     |
| Coordinate conversion / spatial-coordinates | One measured box shown in page, camera and plane coordinates. Which numbers should change after scroll?         | page offset 0–400 px; parent scale 0.5–1.5×; camera offset ±2 units                            | Scroll / Scale; show the converted point and its source frame            |
| Nested cameras / spatial-camera3d           | An inner diagram on a plain outer screen. Can the inner explanation keep pace with the outer framing?           | shared move 0.3–2 s; hold 0–2 s; inner zoom 1–2×; outer travel 0–1 unit                        | Read closely / Pull back; derive both lengths from one shot list         |
| Compositing order / spatial-compositing     | Two intersecting planes, an annotation and a real input. Which layer owns occlusion?                            | depth ±1 unit; annotation offset 0–0.2 unit; opacity 0.2–1 ratio                               | In front / Behind; explain the supported DOM/WebGL occlusion boundary    |

## Film studies

| Study / guide                                 | Minimal scene and question                                                                                              | Actual controls and useful ranges                                                       | Presets / comparison                                                           |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Exact seek / film-transport                   | A dot, a semantic counter and three named times. Does reaching a time from either direction reconstruct the same state? | seek 0–6 s; clip duration 1–4 s                                                         | Forward visit / Backward visit; compare state and frame at the same timestamp  |
| Spine and shots / film-graph                  | Two colour planes with a visible shot rail. Who determines total duration?                                              | shot A/B 0.5–3 s; hold 0–1 s                                                            | Balanced / Long second shot; derive all rail positions from the graph          |
| Named scheduling / film-schedule              | Three simple builds and a dependency diagram. Does retiming the first build move its dependents?                        | build duration 0.2–2 s; relative offset 0–0.5 s                                         | With / After; display the compiler's resolved starts                           |
| Picture readiness / film-picture              | A tiny procedural picture with an explicit ready gate. What happens if transport requests a frame before readiness?     | manual ready/retry controls; seek 0–3 s                                                 | Ready / Waiting; hold the last valid picture until the contract is satisfied   |
| Join ownership / film-joins                   | Two labelled live DOM planes, each with a moving counter. Which layers does the join cover?                             | overlap 0.1–1.2 s; picture-only versus supported whole-frame mode                       | Picture only / With type; confirm the counters continue through the join       |
| Clip-local time / film-clips                  | One short local video beside global and local clocks. How do offset and trim change the sampled media time?             | offset 0–2 s; in/out within the asset's duration; gain 0–1 ratio                        | Early excerpt / Late excerpt; state which clock the displayed value uses       |
| Separate voice clips / film-audio             | Three short locally generated speech or tone clips with a caption rail. Does playback advance through every boundary?   | per-clip gap 0–0.3 s; gain 0–1 ratio; manual unavailable-source toggle                  | Continuous / Breath between; test start, pause, retry and natural completion   |
| Audio mix / film-audio-mix                    | A voice-like foreground pulse over a quiet sustained bed. What does ducking change?                                     | voice/bed gain 0–1 ratio; attack 0.02–0.4 s; release 0.05–1 s; supported duck depth     | Clear voice / Gentle bed; keep source levels fixed and compare envelope output |
| Type and annotations / film-world-annotations | One plane moves behind a caption rail and a world-pinned label. Which text follows the subject?                         | world offset ±1 unit; caption inset 16–80 px; reveal 0.1–1 s                            | World label / Screen caption; compare their positions under camera motion      |
| Picture adjustment / film-adjustments         | One fixed local image and a single supported treatment. Is the effect changing the picture or its geometry?             | treatment strength 0–1 ratio; blend or exposure only if the picture contract exposes it | Neutral / Treated; hold the camera and clock fixed                             |

## Implementation order and acceptance

1. Build the docs-only registry and reusable study frame, then Frame a subject,
   Relative 3D pose, Projected DOM, and Exact seek. These establish the coordinate,
   control, lifecycle and transport boundaries used by later studies.
2. Add the remaining spatial studies plus Spine and shots, Named scheduling and
   Join ownership. Use the public exported vocabulary; do not introduce a second
   animation implementation just to make a small example easier.
3. Add media, audio, readiness and annotation studies. Audio starts from an
   explicit gesture. Failure toggles exercise a real recovery path, with a clear
   visible state, rather than relying on arbitrary delays.
4. Replace each guide's composite embed only when its focused study teaches the
   same concept more clearly. Retain a link to the larger example as “Combine
   this with…”. Do not remove the larger demo's teaching notes or source links.

Before implementation, verify the control names and supported modes against the
exported API and its guide. The ranges above are design targets, not new API
promises. Every implemented study needs a prediction, one-variable experiment,
actual code excerpt, limitation, and a composition link. Check live editing
without remount, original-value restoration, keyboard operation, reduced motion,
teardown, and the same seek reached forward/backward/fresh where applicable.
Test two simultaneously embedded studies to catch shared stores or global clocks.
