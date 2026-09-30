import topic0 from '../content/guides/core-api-inventory.md?raw';
import topic10 from '../content/guides/core-config.md?raw';
import topic6 from '../content/guides/core-drag.md?raw';
import topic7 from '../content/guides/core-drag-handles.md?raw';
import topic13 from '../content/guides/core-host.md?raw';
import topic5 from '../content/guides/core-motion-values.md?raw';
import topic11 from '../content/guides/core-page-transitions.md?raw';
import topic8 from '../content/guides/core-reorder.md?raw';
import topic9 from '../content/guides/core-scroll.md?raw';
import topic2 from '../content/guides/core-springs.md?raw';
import topic1 from '../content/guides/core-targets.md?raw';
import topic12 from '../content/guides/core-tempo.md?raw';
import topic57 from '../content/guides/core-test-geometry.md?raw';
import topic56 from '../content/guides/core-test-timing.md?raw';
import topic3 from '../content/guides/core-tweens.md?raw';
import topic4 from '../content/guides/core-variants.md?raw';
import topic49 from '../content/guides/film-adjustments.md?raw';
import topic42 from '../content/guides/film-attachments.md?raw';
import topic52 from '../content/guides/film-audio-mix.md?raw';
import topic45 from '../content/guides/film-clips.md?raw';
import topic38 from '../content/guides/film-graph.md?raw';
import topic54 from '../content/guides/film-graph-extension.md?raw';
import topic53 from '../content/guides/film-interface.md?raw';
import topic47 from '../content/guides/film-joins.md?raw';
import topic46 from '../content/guides/film-media-graph.md?raw';
import topic44 from '../content/guides/film-picture.md?raw';
import topic43 from '../content/guides/film-player.md?raw';
import topic39 from '../content/guides/film-poses.md?raw';
import topic40 from '../content/guides/film-schedule.md?raw';
import topic48 from '../content/guides/film-seam-readiness.md?raw';
import topic41 from '../content/guides/film-transport.md?raw';
import topic51 from '../content/guides/film-typography.md?raw';
import topic55 from '../content/guides/film-utilities.md?raw';
import topic50 from '../content/guides/film-world-annotations.md?raw';
import topic17 from '../content/guides/interactive-anchors.md?raw';
import topic27 from '../content/guides/interactive-arming.md?raw';
import topic15 from '../content/guides/interactive-blocks.md?raw';
import topic29 from '../content/guides/interactive-commands.md?raw';
import topic30 from '../content/guides/interactive-composites.md?raw';
import topic26 from '../content/guides/interactive-crossings.md?raw';
import topic22 from '../content/guides/interactive-delivery.md?raw';
import topic23 from '../content/guides/interactive-follow.md?raw';
import topic16 from '../content/guides/interactive-gates.md?raw';
import topic20 from '../content/guides/interactive-holds.md?raw';
import topic19 from '../content/guides/interactive-move.md?raw';
import topic18 from '../content/guides/interactive-property-steps.md?raw';
import topic14 from '../content/guides/interactive-queries.md?raw';
import topic21 from '../content/guides/interactive-raise-scroll.md?raw';
import topic25 from '../content/guides/interactive-regions.md?raw';
import topic31 from '../content/guides/interactive-registry.md?raw';
import topic28 from '../content/guides/interactive-run.md?raw';
import topic24 from '../content/guides/interactive-tethers.md?raw';
import topic34 from '../content/guides/spatial-camera3d.md?raw';
import topic37 from '../content/guides/spatial-compositing.md?raw';
import topic36 from '../content/guides/spatial-coordinates.md?raw';
import topic32 from '../content/guides/spatial-frame.md?raw';
import topic35 from '../content/guides/spatial-paths.md?raw';
import topic33 from '../content/guides/spatial-relative.md?raw';
import type { Guide } from './guides';
export const referenceGuides: Guide[] = [
  {
    ...{
      slug: 'core-api-inventory',
      title: 'API and Concept Inventory',
      summary: 'Find every public API and its substantial concept guide.',
      section: 'core',
    },
    source: topic0,
  },
  {
    ...{
      slug: 'core-targets',
      title: 'Targets, Styles, and Property Ownership',
      summary:
        'Use to, styles, and perValue without competing with the renderer.',
      section: 'core',
      demo: {
        id: 'enter',
        title: 'Targets, Styles, and Property Ownership \u2014 live example',
        instruction:
          'Replay the entrance, then compare the motion controls with the original settings.',
      },
    },
    source: topic1,
  },
  {
    ...{
      slug: 'core-springs',
      title: 'Spring Transitions',
      summary:
        'Choose physical parameters or a perceived duration, and preserve continuity.',
      section: 'core',
      demo: {
        id: 'interrupt',
        title: 'Spring Transitions \u2014 live example',
        instruction:
          'Choose another target before the movement settles. Compare the spring response with the tween.',
      },
    },
    source: topic2,
  },
  {
    ...{
      slug: 'core-tweens',
      title: 'Tweens, Easing, and Keyframes',
      summary: 'Author a timed journey and give each property its own curve.',
      section: 'core',
      demo: {
        id: 'keyframes',
        title: 'Tweens, Easing, and Keyframes \u2014 live example',
        instruction:
          'Watch the intermediate values, then replay at a different duration.',
      },
    },
    source: topic3,
  },
  {
    ...{
      slug: 'core-variants',
      title: 'Variants and Staggered Children',
      summary:
        'Name visual states and propagate them through a component tree.',
      section: 'core',
      demo: {
        id: 'stagger',
        title: 'Variants and Staggered Children \u2014 live example',
        instruction: 'Replay the group and inspect the order of its children.',
      },
    },
    source: topic4,
  },
  {
    ...{
      slug: 'core-motion-values',
      title: 'Motion Values and Derived Values',
      summary: 'Keep continuous input outside the Glimmer render loop.',
      section: 'core',
      demo: {
        id: 'pointer',
        title: 'Motion Values and Derived Values \u2014 live example',
        instruction:
          'Move the pointer within the demo and watch the continuous response.',
      },
    },
    source: topic5,
  },
  {
    ...{
      slug: 'core-drag',
      title: 'Dragging, Constraints, and Momentum',
      summary: 'Design a drag interaction that hands off cleanly at release.',
      section: 'core',
      demo: {
        id: 'drag',
        title: 'Dragging, Constraints, and Momentum \u2014 live example',
        instruction:
          'Drag and release the cover. Compare a slow pull with a fast throw.',
      },
    },
    source: topic6,
  },
  {
    ...{
      slug: 'core-drag-handles',
      title: 'Drag Handles and Coordinate Correction',
      summary:
        'Start a drag from a handle and account for scaled or SVG surfaces.',
      section: 'core',
      demo: {
        id: 'grip',
        title: 'Drag Handles and Coordinate Correction \u2014 live example',
        instruction:
          'Move a guest by the corner handle, then edit the card without dragging it.',
      },
    },
    source: topic7,
  },
  {
    ...{
      slug: 'core-reorder',
      title: 'Reordering Lists and Grids',
      summary: 'Keep visual order and application order in agreement.',
      section: 'core',
      demo: {
        id: 'reorder',
        title: 'Reordering Lists and Grids \u2014 live example',
        instruction:
          'Drag a row, then use Move first to last to compare pointer and data-driven ordering.',
      },
    },
    source: topic8,
  },
  {
    ...{
      slug: 'core-scroll',
      title: 'Scroll Progress and Viewport Observation',
      summary: 'Choose continuous progress or a discrete visibility state.',
      section: 'core',
      demo: {
        id: 'parallax',
        title: 'Scroll Progress and Viewport Observation \u2014 live example',
        instruction:
          'Scroll inside the example and watch the layers respond to the same progress.',
      },
    },
    source: topic9,
  },
  {
    ...{
      slug: 'core-config',
      title: 'Motion Configuration and Reduced Motion',
      summary:
        'Establish defaults at a DOM boundary and preserve user preferences.',
      section: 'core',
      demo: {
        id: 'gestures',
        title: 'Motion Configuration and Reduced Motion \u2014 live example',
        instruction:
          'Hover or press the globe and compare the configured response.',
      },
    },
    source: topic10,
  },
  {
    ...{
      slug: 'core-page-transitions',
      title: 'Page Transitions and Live Crossings',
      summary:
        'Choose a snapshot transition or a live scene based on the content.',
      section: 'core',
      demo: {
        id: 'crossing',
        title: 'Page Transitions and Live Crossings \u2014 live example',
        instruction: 'Change scenes while the live content is still moving.',
      },
    },
    source: topic11,
  },
  {
    ...{
      slug: 'core-tempo',
      title: 'Slow Motion and Playback Rate',
      summary: 'Distinguish transition duration scaling from a running clock.',
      section: 'core',
      demo: {
        id: 'path',
        title: 'Slow Motion and Playback Rate \u2014 live example',
        instruction:
          'Change Time Scale and replay to inspect the stroke at the new tempo.',
      },
    },
    source: topic12,
  },
  {
    ...{
      slug: 'core-host',
      title: 'Host Adapters and the Render Pipeline',
      summary: 'Understand MotionNode, scheduling, and layout settlement.',
      section: 'core',
    },
    source: topic13,
  },
  {
    ...{
      slug: 'interactive-queries',
      title: 'Changesets, Sprites, and Queries',
      summary: 'Select participants by identity, role, and what changed.',
      section: 'interactive',
      demo: {
        id: 'lists',
        title: 'Changesets, Sprites, and Queries \u2014 live example',
        instruction:
          'Move a person between the lists and identify the participants that were kept or received.',
      },
    },
    source: topic14,
  },
  {
    ...{
      slug: 'interactive-blocks',
      title: 'Sequences and Parallel Blocks',
      summary: 'Build timing relationships that survive edits.',
      section: 'interactive',
      demo: {
        id: 'sequence',
        title: 'Sequences and Parallel Blocks \u2014 live example',
        instruction: 'Change the selected card and watch the ordered phases.',
      },
    },
    source: topic15,
  },
  {
    ...{
      slug: 'interactive-gates',
      title: 'Gates, Advance, and Retreat',
      summary: 'Let a presenter control builds without losing the timeline.',
      section: 'interactive',
      demo: {
        id: 'presentation',
        title: 'Gates, Advance, and Retreat \u2014 live example',
        instruction:
          'Advance and retreat through builds, including a click while a build is moving.',
      },
    },
    source: topic16,
  },
  {
    ...{
      slug: 'interactive-anchors',
      title: 'Named Anchors and Overlap',
      summary: 'Place work relative to another step or block.',
      section: 'interactive',
      demo: {
        id: 'build-order',
        title: 'Named Anchors and Overlap \u2014 live example',
        instruction:
          'Edit a build\u2019s timing and compare its relationship to the other named steps.',
      },
    },
    source: topic17,
  },
  {
    ...{
      slug: 'interactive-property-steps',
      title: 'Tween and Spring Steps',
      summary: 'Animate selected properties over a changeset.',
      section: 'interactive',
      demo: {
        id: 'trail',
        title: 'Tween and Spring Steps \u2014 live example',
        instruction:
          'Push a path and pop a crumb to inspect the entry and exit properties.',
      },
    },
    source: topic18,
  },
  {
    ...{
      slug: 'interactive-move',
      title: 'Measured Movement, Size, and Paths',
      summary:
        'Move between real layouts without confusing shape with identity.',
      section: 'interactive',
      demo: {
        id: 'inline-edit',
        title: 'Measured Movement, Size, and Paths \u2014 live example',
        instruction:
          'Open the editor and compare the content and geometry throughout the transition.',
      },
    },
    source: topic19,
  },
  {
    ...{
      slug: 'interactive-holds',
      title: 'Holds, Waits, and Standing Steps',
      summary:
        'Give temporary properties and persistent annotations explicit lifetimes.',
      section: 'interactive',
      demo: {
        id: 'sheet',
        title: 'Holds, Waits, and Standing Steps \u2014 live example',
        instruction:
          'Drag the sheet and inspect how the hand releases ownership to the resting response.',
      },
    },
    source: topic20,
  },
  {
    ...{
      slug: 'interactive-raise-scroll',
      title: 'Elevation and Directed Scrolling',
      summary:
        'Move above local clipping and reveal a subject in its container.',
      section: 'interactive',
      demo: {
        id: 'jump',
        title: 'Elevation and Directed Scrolling \u2014 live example',
        instruction:
          'Advance to another failure and watch the selected row come into view.',
      },
    },
    source: topic21,
  },
  {
    ...{
      slug: 'interactive-delivery',
      title: 'Text Delivery and Stagger',
      summary: 'Reveal words, characters, paragraphs, or objects on one score.',
      section: 'interactive',
      demo: {
        id: 'build-order',
        title: 'Text Delivery and Stagger \u2014 live example',
        instruction:
          'Compare the lettering builds and their place in the shared score.',
      },
    },
    source: topic22,
  },
  {
    ...{
      slug: 'interactive-follow',
      title: 'Derived Motion With Follow',
      summary:
        'Compute a follower from captured geometry and the current score.',
      section: 'interactive',
      demo: {
        id: 'escort',
        title: 'Derived Motion With Follow \u2014 live example',
        instruction:
          'Send the parcel again mid-flight and watch its annotation follow the live subject.',
      },
    },
    source: topic23,
  },
  {
    ...{
      slug: 'interactive-tethers',
      title: 'Tethers and Connector Geometry',
      summary: 'Draw a relationship between moving participants.',
      section: 'interactive',
      demo: {
        id: 'wires',
        title: 'Tethers and Connector Geometry \u2014 live example',
        instruction:
          'Hover a text mark and watch the connector hold the relationship to its comment.',
      },
    },
    source: topic24,
  },
  {
    ...{
      slug: 'interactive-regions',
      title: 'Nested Regions and Far Matching',
      summary:
        'Coordinate independent scenes without flattening their ownership.',
      section: 'interactive',
      demo: {
        id: 'far',
        title: 'Nested Regions and Far Matching \u2014 live example',
        instruction:
          'Move a card across regions and watch the receiving scene preserve its identity.',
      },
    },
    source: topic25,
  },
  {
    ...{
      slug: 'interactive-crossings',
      title: 'Live Scene Crossings',
      summary: 'Preserve real content while the surrounding scene changes.',
      section: 'interactive',
      demo: {
        id: 'crossing',
        title: 'Live Scene Crossings \u2014 live example',
        instruction:
          'Switch scenes repeatedly and inspect the live counterpart handoff.',
      },
    },
    source: topic26,
  },
  {
    ...{
      slug: 'interactive-arming',
      title: 'Arming and Reliable Activation',
      summary:
        'Watch a crossing before its run exists and through replacements.',
      section: 'interactive',
      demo: {
        id: 'lightbox',
        title: 'Arming and Reliable Activation \u2014 live example',
        instruction:
          'Open and close the detail quickly to inspect repeated activation and teardown.',
      },
    },
    source: topic27,
  },
  {
    ...{
      slug: 'interactive-run',
      title: 'The Run and Interruption',
      summary:
        'Own transport state and distinguish completion from replacement.',
      section: 'interactive',
      demo: {
        id: 'rack',
        title: 'The Run and Interruption \u2014 live example',
        instruction:
          'Scrub the arrangement and compare direct seeks with ordinary movement.',
      },
    },
    source: topic28,
  },
  {
    ...{
      slug: 'interactive-commands',
      title: 'Perform Commands and Backward Folding',
      summary: 'Reconstruct application state from semantic timeline actions.',
      section: 'interactive',
      demo: {
        id: 'fold',
        title: 'Perform Commands and Backward Folding \u2014 live example',
        instruction:
          'Scrub backward through commands and check that the host state is reconstructed.',
      },
    },
    source: topic29,
  },
  {
    ...{
      slug: 'interactive-composites',
      title: 'Creating Composite Steps',
      summary: 'Extend the vocabulary through public timeline nodes.',
      section: 'interactive',
      demo: {
        id: 'split',
        title: 'Creating Composite Steps \u2014 live example',
        instruction:
          'Change the split and inspect the combined steps acting as one interaction.',
      },
    },
    source: topic30,
  },
  {
    ...{
      slug: 'interactive-registry',
      title: 'Region Lookup and External Providers',
      summary:
        'Find an owned region without treating the document as one timeline.',
      section: 'interactive',
    },
    source: topic31,
  },
  {
    ...{
      slug: 'spatial-frame',
      title: 'Framing and Aiming a DOM Camera',
      summary: 'Fit a subject or recenter it without changing magnification.',
      section: 'spatial',
      demo: {
        id: 'camera',
        title: 'Framing and Aiming a DOM Camera \u2014 live example',
        instruction:
          'Choose a subject and inspect the framing at the destination.',
      },
    },
    source: topic32,
  },
  {
    ...{
      slug: 'spatial-relative',
      title: 'Relative Pans and Slow Zooms',
      summary: 'Continue a shot from the pose already in force.',
      section: 'spatial',
      demo: {
        id: 'long-take',
        title: 'Relative Pans and Slow Zooms \u2014 live example',
        instruction:
          'Follow the camera through the live screen and compare the relative reframing.',
      },
    },
    source: topic33,
  },
  {
    ...{
      slug: 'spatial-camera3d',
      title: 'The Camera3D Renderer Contract',
      summary: 'Let Choreo direct the pose while the host renders the scene.',
      section: 'spatial',
      demo: {
        id: 'mockup',
        title: 'The Camera3D Renderer Contract \u2014 live example',
        instruction:
          'Switch to 3D, then use the screen controls while the device remains spatial.',
      },
    },
    source: topic34,
  },
  {
    ...{
      slug: 'spatial-paths',
      title: 'Camera Paths, Cuts, and Smoothing',
      summary: 'Author a continuous tour that can also be rendered exactly.',
      section: 'spatial',
      demo: {
        id: 'sylva',
        title: 'Camera Paths, Cuts, and Smoothing \u2014 live example',
        instruction:
          'Start the world tour and watch the camera move through several subjects.',
      },
    },
    source: topic35,
  },
  {
    ...{
      slug: 'spatial-coordinates',
      title: 'Plane Coordinates and Hit Testing',
      summary:
        'Convert rectangles through a camera without measuring the output again.',
      section: 'spatial',
      demo: {
        id: 'subdivision',
        title: 'Plane Coordinates and Hit Testing \u2014 live example',
        instruction:
          'Drag a seam and inspect the relationship between pointer coordinates and real layout.',
      },
    },
    source: topic36,
  },
  {
    ...{
      slug: 'spatial-compositing',
      title: 'DOM and WebGL Compositing',
      summary:
        'Preserve crisp controls while placing them in a rendered scene.',
      section: 'spatial',
      demo: {
        id: 'mockup',
        title: 'DOM and WebGL Compositing \u2014 live example',
        instruction: 'Switch to 3D and open an app on the real screen.',
      },
    },
    source: topic37,
  },
  {
    ...{
      slug: 'film-graph',
      title: 'Authoring a Film Graph',
      summary: 'Describe chapters and shots in the template that renders them.',
      section: 'film',
      demo: {
        id: 'towers',
        title: 'Authoring a Film Graph \u2014 live example',
        instruction:
          'Start the film and inspect how its chapters organize the edit.',
      },
    },
    source: topic38,
  },
  {
    ...{
      slug: 'film-poses',
      title: 'Shots, Tail Poses, and Eye-Level Views',
      summary: 'State what the lens sees at the beginning and end of a shot.',
      section: 'film',
      demo: {
        id: 'sagrada',
        title: 'Shots, Tail Poses, and Eye-Level Views \u2014 live example',
        instruction:
          'Start the film and compare the establishing views with the detail shots.',
      },
    },
    source: topic39,
  },
  {
    ...{
      slug: 'film-schedule',
      title: 'The Headless Film Schedule',
      summary: 'Inspect timing without launching a renderer.',
      section: 'film',
    },
    source: topic40,
  },
  {
    ...{
      slug: 'film-transport',
      title: 'Film Handles, Playback, and Exact Rendering',
      summary: 'Choose the correct operation for interaction or export.',
      section: 'film',
      demo: {
        id: 'playhead',
        title:
          'Film Handles, Playback, and Exact Rendering \u2014 live example',
        instruction:
          'Pause and seek directly to a moment, then replay the same interval.',
      },
    },
    source: topic41,
  },
  {
    ...{
      slug: 'film-attachments',
      title: 'Attaching Another Region to a Clock',
      summary: 'Drive a child run through an explicit window.',
      section: 'film',
    },
    source: topic42,
  },
  {
    ...{
      slug: 'film-player',
      title: 'The Standalone Choreo Player',
      summary: 'Control selected runs without taking over the document.',
      section: 'film',
      demo: {
        id: 'playhead',
        title: 'The Standalone Choreo Player \u2014 live example',
        instruction: 'Compare a direct scrub with playback to the same moment.',
      },
    },
    source: topic43,
  },
  {
    ...{
      slug: 'film-picture',
      title: 'Registering a Picture and Its Capabilities',
      summary: 'Connect the film to the renderer that actually draws it.',
      section: 'film',
    },
    source: topic44,
  },
  {
    ...{
      slug: 'film-clips',
      title: 'Clip Windows, Lanes, and Source Time',
      summary: 'Place video, images, and freezes on the film clock.',
      section: 'film',
    },
    source: topic45,
  },
  {
    ...{
      slug: 'film-media-graph',
      title: 'Media Attachments and Picture-in-Picture',
      summary:
        'Author inserts as graph components with clear placement and lifetime.',
      section: 'film',
    },
    source: topic46,
  },
  {
    ...{
      slug: 'film-joins',
      title: 'Joins and Transition Presentations',
      summary: 'Make the outgoing frame and incoming shot agree at an edit.',
      section: 'film',
    },
    source: topic47,
  },
  {
    ...{
      slug: 'film-seam-readiness',
      title: 'Seam Readiness and Exact Capture',
      summary:
        'Prevent the incoming frame from flashing before the outgoing still.',
      section: 'film',
    },
    source: topic48,
  },
  {
    ...{
      slug: 'film-adjustments',
      title: 'Picture Adjustments, Grades, and Filters',
      summary: 'Hold renderer settings at the group or shot that owns them.',
      section: 'film',
    },
    source: topic49,
  },
  {
    ...{
      slug: 'film-world-annotations',
      title: 'World Annotations and Construction Cues',
      summary: 'Connect labels and reveals to the subject they explain.',
      section: 'film',
    },
    source: topic50,
  },
  {
    ...{
      slug: 'film-typography',
      title: 'Lower Thirds, Captions, and Screen Overlays',
      summary: 'Give explanatory text its own readable interval.',
      section: 'film',
      demo: {
        id: 'presentation',
        title:
          'Lower Thirds, Captions, and Screen Overlays \u2014 live example',
        instruction:
          'Advance the presentation and inspect each title\u2019s readable interval.',
      },
    },
    source: topic51,
  },
  {
    ...{
      slug: 'film-audio-mix',
      title: 'Voice Cues, Mixing, and Browser Playback',
      summary: 'Keep separate narration clips aligned with the tour.',
      section: 'film',
    },
    source: topic52,
  },
  {
    ...{
      slug: 'film-interface',
      title: 'Posters, Menus, Rails, and Player Controls',
      summary: 'Make the film usable before, during, and after playback.',
      section: 'film',
    },
    source: topic53,
  },
  {
    ...{
      slug: 'film-graph-extension',
      title: 'Graph Compilation and Custom Adjustments',
      summary: 'Extend authoring through typed nodes and patches.',
      section: 'film',
    },
    source: topic54,
  },
  {
    ...{
      slug: 'film-utilities',
      title: 'Film Math and Formatting Utilities',
      summary:
        'Reuse small calculations without confusing them with a rendering engine.',
      section: 'film',
    },
    source: topic55,
  },
  {
    ...{
      slug: 'core-test-timing',
      title: 'Testing Time, Gates, and Settlement',
      summary:
        'Wait for the behavior under test instead of guessing a duration.',
      section: 'core',
    },
    source: topic56,
  },
  {
    ...{
      slug: 'core-test-geometry',
      title: 'Testing Geometry, Identity, and Cleanup',
      summary: 'Assert the live subject and inspect intermediate frames.',
      section: 'core',
    },
    source: topic57,
  },
];
