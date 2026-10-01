# Clip Windows, Lanes, and Source Time

A clip is media laid over the main picture for a defined interval. It can be a video, an image, or a freeze of the picture itself. The film resolves its state from the current clock so seeking into the middle of an insert does not require playing from the beginning to discover whether it should exist.

## Mapping Source Time

`ClipSpec` describes the media kind, source, start offset, duration or out point, playback rate, and end policy. Source time is the in point plus elapsed film-window time multiplied by the rate. `clipWindow()` calculates the corresponding film duration.

```ts title="Component logic excerpt"
import { clipWindow } from 'glimmer-motion/film';
import type { ClipSpec } from 'glimmer-motion/film';

const clip: ClipSpec = {
  kind: 'video',
  src: 'clips/detail.mp4',
  at: 1,
  in: 2,
  out: 6,
  rate: 1,
  end: 'remove',
  lane: 0,
};
const duration = clipWindow(clip, 0, 10); // four film seconds
```

An explicit duration takes precedence; otherwise a source out point can define the window, or the clip lasts through the remaining beat. Use a positive meaningful playback rate and source times that the actual media can supply.

## Ending and Replacing a Clip

End policies distinguish removal, holding the final sample, and freezing without further source writes. `ClipState` reports absent, active, held, or frozen; `ResolvedClip` includes the current source time where applicable. `resolveClip()` resolves one lane and `resolveClips()` handles the concurrent lanes. `clipLanes()` exposes their identities.

Within a lane, a newer clip takes responsibility rather than revealing an older clip again after it ends. Across lanes, clips coexist. This allows a picture-in-picture insert over a full-frame video. Assign a lane explicitly when a later beat should replace earlier media instead of appearing beside it.

## Handling the Browser Media Boundary

A correct source-time number is not yet a decoded frame. A recording harness must wait for the video element to seek and decode before capturing. For playback, keep the clip's own volume policy explicit so it does not unexpectedly compete with the guide's narration.

Test a clip that starts late, a clip that spans the next beat, and a held clip replaced on the same lane. Then seek backward across each boundary. The visual layer and source time should match the requested film time without leaving an old frame behind. Use the graph media components to author these facts in the template rather than maintaining a separate imperative media scheduler.

## API Coverage

**glimmer-motion/film**: `Clip`, `ClipEnd`, `ClipKind`, `clipLanes`, `ClipSpec`, `ClipState`, `clipWindow`, `resolveClip`, `resolveClips`, `ResolvedClip`.

Read the implementation: [`clip.gts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/clip.gts), [`clips.ts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/clips.ts).
