# Recorded & Film Choreo

A recorded presentation needs to reproduce a particular moment on demand. Unlike a live interaction, it cannot depend on how long a browser happened to spend rendering the previous frame.

This section covers two related tools. **choreo-player** gives an external clock control over selected Choreo runs. **Film** adds a structure for shots, chapters, narration, overlays, and playback.

## Motivation

A live application responds to whatever a person does next. A presentation needs a planned sequence that can be played, paused, reviewed, and recorded consistently. A film also needs the picture, narration, and titles to agree about which moment is being shown.

Recorded and Film Choreo connect those needs to the same motion system used by the interactive examples. Use an external player for a recordable scene, or a Film composition when the edit itself needs shots, chapters, and narration.

## Learning Goals

By the end of this section, you will be able to:

- Give an external clock ownership of specific Choreo runs.
- Reconstruct application state when seeking directly to a timestamp.
- Organize a picture into chapters, shots, and camera movements.
- Coordinate separate narration clips with readable overlays.
- Review and deliver a deterministic recording and a working hosted experience.

## Choosing a Starting Point

Use `choreo-player` when you already have a Choreo scene and want to scrub or record it. The player controls runs that your application explicitly supplies. It does not discover unrelated animations on the page.

Use `Film` when the presentation itself needs a shot list, chapter navigation, voice, and a picture renderer. Its components describe the edit while the renderer supplies the picture.

```ts title="Package Entry Points"
import { createChoreoPlayer } from 'choreo-player';
import { Film } from 'glimmer-motion/film';
```

Install `choreo-player` separately when you need that transport. Film is provided by the `glimmer-motion` package through its film subpath.

## Keeping the Original Interaction

A demo can support both a person using its controls and a recorder supplying time. Keep those modes explicit. Entering the page should preserve its ordinary interactions; an external recording request can prepare and take ownership of the runs it needs.

Application state must also be reproducible. If a recorded click opens a panel at three seconds, seeking to four seconds must reconstruct that open panel even when the recorder never visited three seconds.

## Seeing a Complete Presentation

The [3D gallery](/_widgets) includes a quick highlights tour and a longer guided tour. The [Towers film](/towers) demonstrates a presentation with chapters and narration.

Start with [Driving an External Clock](/docs/film-clock), then read [Building a Film](/docs/film-shots). The final guide covers recording checks and portable deployment.

## API Coverage

**glimmer-motion**: `Film`.

**glimmer-motion/film**: `Film`, `FilmContext`, `FilmSignature`.

Read the implementation: [`film.ts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film.ts), [`film.gts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/film.gts).
