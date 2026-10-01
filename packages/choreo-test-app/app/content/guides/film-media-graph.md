# Media Attachments and Picture-in-Picture

A film graph can attach supporting media without changing the main picture's camera model. Use an insert when a reference photograph or recorded detail helps explain the live scene. Its placement and duration should support the narration while leaving the subject of the shot readable.

## Attaching Media

The graph's `f.Attach` supplies the time window around `f.Insert`, `f.Freeze`, or `f.Video`. It is exported as GraphAttach to distinguish it from Choreo's run attachment. The media node supplies the source or freeze behavior, while the wrapper places that content on the shot's clock.

```gts title="Component template excerpt"
<f.Attach @at={{1}} @for={{3}} @end='remove'>
  <f.Video @src='clips/detail.mp4' @in={{2}} @rate={{1}} />
</f.Attach>
```

This is a fragment inside a shot. The source resolves against the picture's asset configuration. A freeze captures the picture rather than loading an external file, so its readiness and capture requirements differ from an ordinary image insert.

## Choosing a Presentation

An editorial insert is a framed reference image with room for a caption or credit. A picture-in-picture layer is a positioned visual layer without that same card treatment. `f.Inset` expresses the latter through frame-relative placement, width, corner radius, and fade. The underlying ClipSpec distinguishes cover, inset, and pip fits.

Choose placement after considering the lower third, the active demo control, and the camera's intended subject. Percentages make the placement responsive to the frame, but they do not guarantee that a wide source and a tall source will leave the same content visible. Review the crop and caption at the final distribution aspect ratio.

## Styling the Clip

`f.clip.Look` applies the browser-supported clip adjustments to that media layer. This is separate from `f.picture.Look`, which affects the rendered scene. A graded background with an ungraded insert can be a deliberate comparison, but it should not happen because the author assumed one adjustment automatically affected both actors.

## Reviewing Time and Ownership

Give each concurrently visible layer an intentional lane and end policy. A media layer can outlive the shot that introduced it; that is useful for a continuous explanation, but it can also obscure the next demonstration if the window is too long. Inspect the resolved clip state at the outgoing and incoming beat boundaries.

For export, verify the actual source frame after a direct seek. A visually correct opacity animation over an undecoded or stale video is still a broken insert. The graph defines the composition; the media element and picture adapter remain responsible for delivering the pixels requested by that composition.

## API Coverage

**glimmer-motion/film**: `Freeze`, `GraphAttach`, `GraphInsert`, `Video`.

**FilmVocabulary**: `f.Attach`, `f.Freeze`, `f.Insert`, `f.Inset`, `f.Video`.

Read the implementation: [`nodes.gts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/nodes.gts), [`host.gts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/host.gts).
