# Building a Film

`Film` organizes a presentation around shots and chapters. It owns the clock and the edit, while a separate picture implementation draws the scene. This keeps the script readable without making the film component responsible for every renderer.

## Reading the Structure

A film's default block yields its composition vocabulary. A spine contains chapters, and chapters contain shots. The following excerpt shows the shape used inside an existing Film host.

```gts title="A Chapter — Inside the Film Default Block"
<f.Spine @join="dip">
  <f.Chapter @n="01" @title="THE ROOM">
    <f.Shot @name="arrival" @ticks={{5}} @dolly={{0.5}} @yaw={{35}} @pitch={{14}} @lookY={{0}}>
      <f.To @dolly={{0.74}} @yaw={{52}} @pitch={{14}} @lookY={{0}} />
      <f.Type @mode="title" @kicker="A GUIDED TOUR" @word="Welcome" />
    </f.Shot>
  </f.Chapter>
</f.Spine>
```

Here, `f` is yielded by `Film`. The shot defines a starting camera pose, `f.To` supplies its destination, and `f.Type` adds a title. The camera units belong to the picture's camera model; they are not CSS pixels.

This excerpt is a score, not a standalone renderer. A complete host must also provide the picture and its assets. The [Film reference](https://github.com/cardstack/choreo/blob/main/docs/film.md) documents those host arguments and the picture contract.

## Planning the Edit

Group shots by what the viewer should understand. A chapter about interface coordination might show a sequence, an interruption, and a cross-region transfer. Give each shot a distinct job before choosing a transition.

Shot lengths use the film schedule's ticks. The current `TICK` constant is two seconds. Use the schedule helpers before translating narration durations into shot lengths, because lead intervals and camera waypoints also affect the actual beat start.

## Choosing a Seek Mode

`@seek="exact"` makes the film evaluate a requested moment for reproducible scrubbing and recording. `@seek="cut"` supports the chased camera model described in the reference, where jumping between shots is treated as an edit.

Use exact mode when a renderer must capture frames in any order. Smoothness during live playback and repeatability during offline recording are separate things to verify.

Next, connect the picture to [Narration and Overlays](/docs/film-audio).

## Separating the Authoring Layers

The film graph now has dedicated guides for its spine, chapters, shot poses, tail poses, eye-level views, joins, media windows, and renderer adjustments. Use those chapters when extending a real film. The short example here establishes the overall relationship; it is not the complete API surface. Compile and inspect the schedule after editing a graph so a visual change does not accidentally alter the timing of narration or attached regions.
