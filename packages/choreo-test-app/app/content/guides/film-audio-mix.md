# Voice Cues, Mixing, and Browser Playback

A reliable narration system needs both a timing model and a browser playback model. The score determines which line belongs to the current shot; the media system must start, resume, and seek the corresponding audio successfully. A silent clip should not leave a tour waiting forever or allow the next shot to run without its explanation.

## Declaring a Voice

`f.Voice` attaches a line and its measured read duration to a shot. The film resolves the associated narration asset from its configured asset location and shot identity. Keep the duration metadata tied to the actual generated recording, especially when replacing a voice or changing the script.

```gts title="Component template excerpt"
<f.Voice @line='The card keeps its momentum when the target changes.'
  @read={{3.2}} />
<f.sound.Mix @music={{0.18}} @voice={{1}} />
```

The example's measured duration is illustrative; use the real file's duration for a production cut. `Mix`, exposed through SOUND, controls the picture's audio buses such as voice, music, effects, and weather. A video's own audio volume is a separate clip setting.

## Starting From a User Gesture

Call the film's sound-enabled begin operation from a real button or equivalent user action. Browsers can reject playback started later without an eligible gesture. Handle rejected play promises and provide a clear retry action rather than assuming a timeline event guarantees audible output.

Keep the media elements and audio context owned by the player lifecycle. Repeatedly replacing an audio element at each shot can interact differently with autoplay policy from reusing a prepared element. Test the supported browser rather than treating Chromium success as Safari evidence.

## Seeking and Advancing

Seeking into a line should choose the corresponding audio offset or follow the film's explicit silent-seek policy. Backward navigation must not leave the old line playing over the new shot. Priming the next source can reduce gaps, but readiness must be tracked separately from the camera's scheduled time.

For a tour built from separate clips, advance according to the intended narration and shot contract. A stalled or missing file needs an explicit recovery path. Avoid chaining the whole experience exclusively through ended callbacks without accounting for failed starts, cancellation, or a user seeking elsewhere.

## Reviewing the Mix

Listen at ordinary device volume and confirm the guide remains intelligible over music and demo sound. Check the first line, several consecutive clip boundaries, pause and resume, backgrounding, and a direct jump into the middle. Audio reliability is not proven by a rendered silent frame; it needs a real playback pass through the browser's media policy and the tour's lifecycle.

## API Coverage

**glimmer-motion/film**: `Mix`, `SOUND`, `Voice`.

**FilmVocabulary**: `f.Voice`, `f.sound`.

Read the implementation: [`adjust.gts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/adjust.gts), [`nodes.gts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/nodes.gts), [`host.gts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/host.gts).
