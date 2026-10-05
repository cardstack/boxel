# Lower Thirds, Captions, and Screen Overlays

A camera can direct attention, but text gives a demonstration precise meaning. Lower thirds, captions, and inserts should explain what is currently visible without forcing the viewer to read faster than the shot allows. The film uses ordinary Choreo regions for these overlays, coordinated by the same controlling score.

## Declaring the Type

`f.Type` places the semantic text fields on a shot. It supports title and lower-third treatments as well as clearer or more spatially pointed modes through `PlateMode`. The rendering Plate component owns the corresponding DOM and its entrance and exit choreography.

```gts title="Component template excerpt"
<f.Type @mode='lower' @kicker='INTERACTIVE CHOREO'
  @word='Continuity' @reading='Change your mind mid-flight' />
```

Keep the term and explanation short enough to read while watching the action. A technical paragraph belongs in the guide, not over the active demo. The shot's spoken narration can explain the significance while the overlay supplies the concise label the viewer should remember.

## Sharing the Clock

The plate is a separate Choreo region. Film attaches its time to the score rather than launching an unrelated animation when a beat-change callback happens. This lets a paused frame include the correct text state, and lets a recording reconstruct the same lower third at a requested time.

The exported Captions, Insert, Stamp, and Track components provide additional screen-level presentation pieces. Their names can resemble graph nodes, but their role differs: graph nodes declare semantic shot data, while presentation components render the corresponding interface. Use the graph and Film's standard composition unless you are deliberately authoring a custom shell.

## Coordinating With Joins

Decide whether a transition covers the picture only or the entire frame. If the incoming title is outside a still that shows the outgoing scene, it can describe the wrong subject. An everything seam can reveal the incoming text with its scene; a picture-only seam needs the text timing to respect the separate layer.

## Reviewing Readability

Inspect the actual 16:9 and mobile viewing sizes, not only a large authoring monitor. Keep safe margins, sufficient contrast, and a useful reading interval. Do not solve a crowded scene by shrinking text until it becomes decorative. Move the lower third away from the control the guide is about to click, or shorten the message.

Test caption changes during backward seeking and at a clip boundary. A lingering line from the previous beat is a state reconstruction bug even when the camera looks correct. Include reduced-motion checks so text remains available when its spatial entrance is simplified. The purpose of the overlay is to improve comprehension, and its motion should preserve that purpose.

## API Coverage

**@cardstack/choreo/film**: `Type`, `Captions`, `Insert`, `Stamp`, `Track`, `Plate`, `PlateMode`.

**FilmVocabulary**: `f.Type`.

Read the implementation: [`nodes.gts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/nodes.gts), [`overlays.gts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/overlays.gts), [`plate.gts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/plate.gts), [`types.ts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/types.ts), [`host.gts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/host.gts).
