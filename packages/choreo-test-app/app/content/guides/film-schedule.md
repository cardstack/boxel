# The Headless Film Schedule

A film's schedule is arithmetic over its shot data. The same calculation can drive the browser and a command-line inspection tool, making timing changes visible before a long render. Use the exported schedule functions rather than reimplementing offsets in a narration script or recording harness.

## Reading the Timeline

Import the functions from `@cardstack/choreo/film`. `totalSecs` calculates the nominal running time, `secsBefore` accumulates earlier beats, and `beatStart` resolves the actual start used by the film. `TICK` is two seconds in the current model. Lead intervals and the opening pose influence where later cues fall, so nominal cumulative duration and actual beat start are not always identical.

```ts title="Component logic excerpt"
import { schedule } from '@cardstack/choreo/film';

// beats and chapters are the compiled graph's data.
const report = schedule(beats, chapters, 'dip');
console.log(report);
```

`cues` produces the semantic beat and atmosphere cue table. `waypoints` produces the camera path, and `tailFor` resolves the end pose of a beat. Those results must agree on the same origin or the camera can arrive before the narration and type that describe it.

## Inspecting Chapters and Joins

`chapterHeads` identifies chapter boundaries, while `contents` produces the menu-oriented summary. `joinInto` resolves the seam entering a beat. `Schedule`, `Cue`, `Waypoint`, and `Content` describe these outputs for tooling. They are related views of the same edit, not independent sources of timing truth.

A useful review compares the schedule before and after a graph edit. A change to a look should not unexpectedly add waypoints; a change to shot duration should visibly retime the affected cues. Store intentional schedule fixtures for representative films and review their diffs when changing compiler or scheduling behavior.

## Testing the Boundary

Pure schedule tests are fast and precise, but they cannot prove that a renderer has loaded its models or decoded a video frame. Pair them with a small number of browser samples at meaningful boundaries. In particular, inspect a shot with lead time, a hard cut, a chapter start, and the end of an attached clip.

Keep export scripts tied to the same compiled graph used in playback. An old hand-maintained shot table can continue producing plausible durations while silently diverging from the template. The purpose of the headless module is to share the calculation, not to create another edit that someone has to keep synchronized by hand.

When publishing runtime information, derive it from this schedule. A hard-coded “45 seconds” label becomes misleading as soon as a narration or demonstration change adds another beat.

## API Coverage

**@cardstack/choreo/film**: `TICK`, `beatStart`, `chapterHeads`, `Content`, `contents`, `Cue`, `cues`, `joinInto`, `Schedule`, `schedule`, `secsBefore`, `tailFor`, `totalSecs`, `Waypoint`, `waypoints`, `FilmClock`.

Read the implementation: [`types.ts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/types.ts), [`film.gts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/film.gts), [`schedule.ts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/schedule.ts).
