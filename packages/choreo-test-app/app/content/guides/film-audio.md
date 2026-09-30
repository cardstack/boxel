# Narration and Overlays

Narration explains why a demonstration matters. The picture should illustrate that explanation, and an overlay should help the viewer identify the point without competing with the interface.

## Writing to the Demonstration

Describe an observable behavior before introducing its implementation. For example: “The card keeps its identity as it moves between panels” gives the viewer something to watch. A later sentence can name cross-region matching.

Keep a quick tour organized around capabilities rather than giving every tile equal time. A longer tour can visit more examples while still explaining what changes and why it is useful.

## Using Separate Clips

Separate narration clips can belong to separate shots. In a Film score, a voice node associates a line and its measured reading duration with the shot.

```gts title="Narration Inside a Shot — Excerpt"
<f.Voice
  @line="The same interface stays interactive as the camera moves."
  @read={{4.2}}
/>
```

The line describes the read; it does not generate an audio file. Prepare the recording separately and provide the assets expected by the Film host. Use the duration of the actual recording rather than estimating from the number of words.

## Starting and Advancing Reliably

Start audible playback from a person's Play action. Test this with the actual deployed media in Safari as well as your development browser. A failed source load needs a recovery path; calling `play()` repeatedly on the same failed media source may leave the tour waiting forever.

Decide which clock owns advancement. If narration drives a guided tour, do not let an independent visual timer advance to the next exhibit while the clip is still loading. Keep pause, resume, completion, and retry behavior connected to that same transport.

The gallery's narration helper is application-level orchestration. It complements the reusable Film and Choreo contracts; it is not an exported audio API of `glimmer-motion`.

## Placing Text

Keep lower thirds in a readable overlay region, clear of the controls being demonstrated. Use short labels for the capability and captions for the spoken content when available. Text should remain readable at the final delivery size, including on a phone.

The [Film reference](https://github.com/cardstack/choreo/blob/main/docs/film.md) covers the built-in type, voice, and sound controls.
