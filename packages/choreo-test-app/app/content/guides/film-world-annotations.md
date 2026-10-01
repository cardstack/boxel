# World Annotations and Construction Cues

A spatial film can explain more than a sequence of camera angles. Labels can stand near the part they name, a construction clock can reveal the subject over time, and a trace can direct attention to a specific feature. These operations belong to the picture's capabilities and the film's semantic shot data.

## Choosing an Annotation

The graph includes Stamp, Sky, Mark, Trace, and Lineup. A stamp communicates a time or term; sky text belongs to the scene's world treatment; a mark identifies a location or height; traces select features to reveal; a lineup cycles related subjects within a held shot. Their meaning is richer than an arbitrary text overlay at fixed screen coordinates.

```gts title="Component template excerpt"
<f.Shot @name='construction' @ticks={{4}}
  @dolly={{1}} @yaw={{25}} @pitch={{14}} @lookY={{0}}>
  <f.picture.Build @clock={{this.constructionRange}} @by={{0.7}} />
  <f.Stamp @year={{this.labelYear}} @at={{0.1}} />
</f.Shot>
```

The example assumes the renderer's construction clock and the film's label value are supplied by the host. A clock range is not necessarily wall-clock seconds or a calendar year; `FilmClock` maps between the film's domain labels and the picture's own time representation.

## Keeping Relationships Visible

A world annotation should remain attached to the relevant subject as the lens moves. Its placement therefore needs the renderer's projection or world-space typography support. A lower third, by contrast, belongs to the screen and remains readable independently of perspective. Choose the model based on whether the spatial relationship itself carries meaning.

A feature reveal may need the picture to report readiness before a trace or label starts. This is especially important when construction geometry or text assets are created asynchronously. The timeline should not display a confident label pointing into an empty scene.

## Avoiding Hidden Inheritance

An exact beat must resolve the state needed for its annotation, subject, and construction clock. Do not assume an earlier shot selected the correct model or cleared the previous label. Inspect a direct render of a middle shot on a fresh page to expose those dependencies.

## Testing the Explanation

Check the annotation's beginning, its readable interval, and its removal. Test bright and dark backgrounds, different aspect ratios, and a camera angle that places the label near the frame edge. For lineups, confirm each stamp agrees with the displayed subject rather than advancing on a separate timer. These features are most effective when they explain an observable change in the scene; adding them without that relationship creates more visual material for the viewer to decode without adding understanding.

## API Coverage

**glimmer-motion/film**: `GraphStamp`, `Lineup`, `Mark`, `Sky`, `Trace`.

**FilmVocabulary**: `f.Lineup`, `f.Mark`, `f.Sky`, `f.Stamp`, `f.Trace`.

Read the implementation: [`nodes.gts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/nodes.gts), [`host.gts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/host.gts).
