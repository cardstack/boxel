# Choreo — the quick tour

50 seconds. Five capability chapters. Thirteen featured live demos. Twenty-three real interactions. George narrates one continuous take, timed with ElevenLabs character alignment.

The camera follows one Choreo Camera3D spline, passing through its waypoints without tile focus stops. The shared cursor lives above the room and tracks projected control positions while the camera moves. Motion values carry the cursor without Glimmer rerenders.

## 1. UX / Continuity — 0.00s

Watch this. A profile becomes an editor. A thumbnail becomes the hero. These are the same live elements, keeping their identity as the interface changes around them.

| Time  | Live demo   | Action                 |
| ----- | ----------- | ---------------------- |
| 1.08s | inline-edit | profile becomes        |
| 2.88s | lightbox    | thumbnail becomes      |
| 6.18s | lightbox    | keeping their identity |
| 7.46s | layout      | interface changes      |

## 2. UX / Orchestration — 9.57s

Now coordinate the whole scene. Messages make room for each other. Change direction mid-flight, and the motion responds. Open a card, and everything else knows where to go.

| Time   | Live demo | Action             |
| ------ | --------- | ------------------ |
| 11.25s | inbox     | Messages make room |
| 12.31s | inbox     | each other         |
| 13.00s | interrupt | Change direction   |
| 13.82s | interrupt | mid-flight         |
| 14.66s | interrupt | motion responds    |
| 16.02s | sequence  | Open a card        |

## 3. Interaction / Time — 18.75s

Even time becomes interactive. Scrub the kiln backwards: the app reconstructs what happened. Then flick a puck, and watch the choreography follow the consequences of your gesture.

| Time   | Live demo | Action                   |
| ------ | --------- | ------------------------ |
| 19.03s | fold      | time becomes interactive |
| 20.99s | fold      | kiln backwards           |
| 24.09s | hang      | flick a puck             |
| 26.27s | hang      | consequences             |

## 4. Spatial computing — 28.00s

Now give the interface depth. Open a real app inside a spatial device. Fly into a photograph. The camera and the interface share the same choreography, so space becomes part of the interaction.

| Time   | Live demo | Action                      |
| ------ | --------- | --------------------------- |
| 29.63s | mockup    | Open a real app             |
| 30.98s | mockup    | spatial device              |
| 32.53s | camera    | Fly into a photograph       |
| 35.05s | camera    | share the same choreography |

## 5. Filmmaking / Build Order — 38.58s

And now, direct a film. One continuous camera move carries the story. Scrub an entire edit, then finish in Build Order: arrange the beats, retime the reveal, and play it again. That is Choreo.

| Time   | Live demo   | Action                |
| ------ | ----------- | --------------------- |
| 39.01s | long-take   | direct a film         |
| 42.71s | playhead    | Scrub an entire edit  |
| 44.37s | build-order | finish in Build Order |
| 45.48s | build-order | arrange the beats     |
| 47.40s | build-order | play it again         |

## Playback

The home screen starts with “50-second highlights”; the complete audio tour remains available separately. Pause freezes narration, camera and automated actions; resume keeps the same cursor and clock. Replay prepares the highlighted demos again. Reduced-motion mode replaces camera travel with stationary views of the relevant demonstrations. The final chapter finishes in Build Order.

The runtime score is `test-app/app/lib/widget-quick-score.json`; its timing comes from the generated George recording, not guessed reading speed. Narration source is `test-app/public/widget-tour/quick-script.json`. Audio and alignment are local assets. No key is stored in the application.

Provider timing reference: [ElevenLabs speech with timestamps](https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps).

Validation: `scripts/verify-widget-freeze.mjs` runs the complete highlights,
checking all 23 interactions, single active tile, errors, and retained DOM state.
Use `FREEZE_BROWSER=webkit` for an iPhone-sized WebKit run.
