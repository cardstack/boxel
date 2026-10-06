# Picture Adjustments, Grades, and Filters

A film's atmosphere is part of its direction. A shot can establish a grade, lighting, weather, or construction state while the camera and narration explain the subject. Graph adjustments keep those settings with the shot or group that owns them, instead of relying on whatever the previous shot happened to leave behind.

## Applying a Look

`f.picture.Look` selects the picture's grade, named look, and LUT. `FilmGrade` describes numeric grading parameters and `LookFx` describes additional appearance settings used by the reference renderer. The picture's specification supplies the named configurations and the amount of LUT treatment.

```gts title="Component template excerpt"
<f.Chapter @n='02' @title='Inside the scene'>
  <f.picture.Look @grade='amber' />
  <f.picture.Sun @az={{120}} @el={{25}} />
  {{! Shots in this chapter inherit these adjustments. }}
</f.Chapter>
```

The names and values must be supported by the picture. A new renderer does not acquire an amber grade simply because the graph contains that string. Keep named looks in the renderer configuration and use the graph to choose when they apply.

## Setting the Environment

The iframe picture vocabulary includes Weather, Winter, Sun, Light, Set, and Build. Weather covers atmosphere and time-of-day controls; Winter supplies settled snow and gust settings; Sun and Light direct illumination; Set chooses surroundings; Build controls the subject's construction time or selected form. These are capabilities of the supplied picture, not universal motion properties.

Group-level adjustments establish reusable defaults. Shot-level adjustments express local changes. Make each compiled beat's resolved state complete enough for direct seeking, because an exact film cannot rely on having played the previous weather or construction command first.

## Understanding Extension Classes

`Adjustment` is the base for a value held on an actor over a window. `Filter` specializes it for frame processing, and `PatchComponent` supplies graph patches. `IFRAME_PICTURE` publishes the reference picture's adjustment set. Extend this surface when an actual renderer has another capability; do not add arbitrary field names that the picture never consumes.

Clip adjustments are separate. `f.clip.Look` uses browser filters on a media element and does not provide every operation of a WebGL grading pipeline. Curves, secondaries, or a LUT over a clip require pixel processing that the DOM-only filter path does not supply.

Review atmosphere changes with a fixed camera as well as in the full edit. That isolates whether a perceived flash comes from exposure, a join, or camera movement. Confirm labels remain readable in both bright and dark frames, and verify a backward seek restores the intended shot's complete environment.

## API Coverage

**@cardstack/choreo/film**: `ClipLook`, `Build`, `IFRAME_PICTURE`, `Light`, `Look`, `Set`, `Sun`, `Weather`, `Winter`, `FilmGrade`, `LookFx`.

**FilmVocabulary**: `f.clip`, `f.picture`.

Read the implementation: [`types.ts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/types.ts), [`clips.ts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/clips.ts), [`adjust.gts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/adjust.gts), [`host.gts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/host.gts).
