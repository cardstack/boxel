import lesson4 from '../content/guides/core-header.md?raw';
import lesson1 from '../content/guides/core-reorder-grid.md?raw';
import lesson3 from '../content/guides/core-reveal.md?raw';
import lesson2 from '../content/guides/core-shared-layout.md?raw';
import circleLoop from '../content/guides/interactive-circle-loop.md?raw';
import lesson5 from '../content/guides/interactive-drift.md?raw';
import lesson6 from '../content/guides/interactive-hang.md?raw';
import lesson0 from '../content/guides/interactive-slides.md?raw';
import type { Guide } from './guides';
export const demoGuides: Guide[] = [
  {
    slug: 'interactive-circle-loop',
    title: 'Composing a Continuous Loop',
    section: 'interactive',
    summary: 'Keyframe timing connects cluster, field, and grid',
    source: circleLoop,
    demo: {
      id: 'circle-loop',
      title: 'Circle continuity',
      instruction:
        'Compare Soft Orbit and Punchy Mosaic. Adjust zoom separately from grid spacing to separate parent motion from local arrangement.',
    },
  },
  {
    slug: 'interactive-slides',
    title: 'Composing Slide Changes',
    section: 'interactive',
    summary: 'Stable roles connect changing compositions',
    source: lesson0,
    demo: {
      id: 'slides',
      title: 'Composing Slide Changes \u2014 live example',
      instruction:
        'Move forward, reverse mid-transition, and compare the plate edge with the departing sentence. Try Elastic typography and Editorial snap.',
    },
  },
  {
    slug: 'core-reorder-grid',
    title: 'Reordering a Wrapped Grid',
    section: 'core',
    summary: 'Reordering preserves a tile while neighbours move',
    source: lesson1,
    demo: {
      id: 'grid',
      title: 'Reordering a Wrapped Grid \u2014 live example',
      instruction:
        "Drag diagonally across a row boundary, reverse, and release. Compare Playful pickup and Precise pickup while following one cover's colour.",
    },
  },
  {
    slug: 'core-shared-layout',
    title: 'Moving a Shared Selection Marker',
    section: 'core',
    summary: 'One visual marker can travel between distinct nodes',
    source: lesson2,
    demo: {
      id: 'tabs',
      title: 'Moving a Shared Selection Marker \u2014 live example',
      instruction:
        'Switch between distant tabs quickly. Follow the marker and compare Jelly tab with Magnetic tab; the selected label updates immediately while the marker catches up.',
    },
  },
  {
    slug: 'core-reveal',
    title: 'Revealing Data on Arrival',
    section: 'core',
    summary: 'An arrival should reveal the meaning of a value',
    source: lesson3,
    demo: {
      id: 'reveal',
      title: 'Revealing Data on Arrival \u2014 live example',
      instruction:
        'Scroll one row into view, then compare it with another. Try Curtain call and Flash reveal while checking that the final values remain readable.',
    },
  },
  {
    slug: 'core-header',
    title: 'Responding to Scroll Direction',
    section: 'core',
    summary: 'Direction needs hysteresis and boundary handling',
    source: lesson4,
    demo: {
      id: 'header',
      title: 'Responding to Scroll Direction \u2014 live example',
      instruction:
        'Scroll down, reverse slightly, then reverse decisively. Repeat near the top and bottom and compare Floating header with Instant response.',
    },
  },
  {
    slug: 'interactive-drift',
    title: 'Keeping Simulation and Choreography Separate',
    section: 'interactive',
    summary: 'A simulation and a transition have different responsibilities',
    source: lesson5,
    demo: {
      id: 'drift',
      title: 'Keeping Simulation and Choreography Separate \u2014 live example',
      instruction:
        "Hold the pointer on the track, change the car's own grip controls, and drive again. Use Bouncy parking and Precision parking to compare the surrounding transitions separately.",
    },
  },
  {
    slug: 'interactive-hang',
    title: 'Turning a Gesture into a Scored Throw',
    section: 'interactive',
    summary: 'Release velocity is information that layout cannot provide',
    source: lesson6,
    demo: {
      id: 'hang',
      title: 'Turning a Gesture into a Scored Throw \u2014 live example',
      instruction:
        'Flick from a similar release point at two speeds. Compare the resulting travel, then try Rubber hang and Decisive release for the transition response.',
    },
  },
];
