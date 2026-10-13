# The Choreo guides

Start with one element. Coordinate an interaction. Bring it into space. Then direct a film. The guides cover four connected areas of the same motion system, with live demos you can tune, and every public API with the concepts behind it. [API and Concept Inventory](core-api-inventory.md) maps each export to the guide that teaches it.

## 01 Core glimmer-motion

Animate the elements you already have. Learn targets, springs, presence, layout, and gestures. Start with [Getting Started](core-start.md).

- [Getting Started](core-start.md): Install the library and make your first element appear.
- [Build Your First Choreo Application](core-first-app.md): Create a clean Ember app and build an interruptible task board.
- [Animating an Element](core-elements.md): Connect tracked state to targets and choose a transition.
- [Entering and Leaving](core-presence.md): Keep leaving items mounted until their exit finishes.
- [Animating Layout](core-layout.md): Animate changes to bounds and connect shared identities.
- [Gestures and Scroll](core-input.md): Respond to hover, press, drag, and scroll.
- [Accessibility and Testing](core-testing.md): Honor reduced motion and test observable outcomes.
- [Diagnose Motion Problems](core-troubleshooting.md): Diagnose ownership, geometry, readiness, audio, and recording failures.
- [API and Concept Inventory](core-api-inventory.md): Find every public API and its substantial concept guide.
- [Targets, Styles, and Property Ownership](core-targets.md): Use to, styles, and perValue without competing with the renderer.
- [Spring Transitions](core-springs.md): Choose physical parameters or a perceived duration, and preserve continuity.
- [Tweens, Easing, and Keyframes](core-tweens.md): Author a timed journey and give each property its own curve.
- [Variants and Staggered Children](core-variants.md): Name visual states and propagate them through a component tree.
- [Motion Values and Derived Values](core-motion-values.md): Keep continuous input outside the Glimmer render loop.
- [Dragging, Constraints, and Momentum](core-drag.md): Design a drag interaction that hands off cleanly at release.
- [Drag Handles and Coordinate Correction](core-drag-handles.md): Start a drag from a handle and account for scaled or SVG surfaces.
- [Reordering Lists and Grids](core-reorder.md): Keep visual order and application order in agreement.
- [Scroll Progress and Viewport Observation](core-scroll.md): Choose continuous progress or a discrete visibility state.
- [Motion Configuration and Reduced Motion](core-config.md): Establish defaults at a DOM boundary and preserve user preferences.
- [Page Transitions and Live Crossings](core-page-transitions.md): Choose a snapshot transition or a live scene based on the content.
- [Slow Motion and Playback Rate](core-tempo.md): Distinguish transition duration scaling from a running clock.
- [Host Adapters and the Render Pipeline](core-host.md): Understand MotionNode, scheduling, and layout settlement.
- [Testing Time, Gates, and Settlement](core-test-timing.md): Wait for the behavior under test instead of guessing a duration.
- [Testing Geometry, Identity, and Cleanup](core-test-geometry.md): Assert the live subject and inspect intermediate frames.
- [Reordering a Wrapped Grid](core-reorder-grid.md): Reordering preserves a tile while neighbours move
- [Moving a Shared Selection Marker](core-shared-layout.md): One visual marker can travel between distinct nodes
- [Revealing Data on Arrival](core-reveal.md): An arrival should reveal the meaning of a value
- [Responding to Scroll Direction](core-header.md): Direction needs hysteresis and boundary handling

## 02 Interactive Choreo

Give an interaction a shared timeline. Coordinate changesets, regions, semantic actions, and interactive timelines. Start with [Understanding a Choreo Scene](interactive-start.md).

- [Understanding a Choreo Scene](interactive-start.md): Understand participants, identity, roles, and changesets.
- [Writing a Timeline](interactive-timelines.md): Compose sequences and parallel steps over a render pass.
- [Connecting Regions and Destinations](interactive-beacons.md): Move to a destination and transfer identity between regions.
- [Changesets, Sprites, and Queries](interactive-queries.md): Select participants by identity, role, and what changed.
- [Sequences and Parallel Blocks](interactive-blocks.md): Build timing relationships that survive edits.
- [Gates, Advance, and Retreat](interactive-gates.md): Let a presenter control builds without losing the timeline.
- [Named Anchors and Overlap](interactive-anchors.md): Place work relative to another step or block.
- [Tween and Spring Steps](interactive-property-steps.md): Animate selected properties over a changeset.
- [Measured Movement, Size, and Paths](interactive-move.md): Move between real layouts without confusing shape with identity.
- [Holds, Waits, and Standing Steps](interactive-holds.md): Give temporary properties and persistent annotations explicit lifetimes.
- [Elevation and Directed Scrolling](interactive-raise-scroll.md): Move above local clipping and reveal a subject in its container.
- [Text Delivery and Stagger](interactive-delivery.md): Reveal words, characters, paragraphs, or objects on one score.
- [Derived Motion With Follow](interactive-follow.md): Compute a follower from captured geometry and the current score.
- [Tethers and Connector Geometry](interactive-tethers.md): Draw a relationship between moving participants.
- [Nested Regions and Far Matching](interactive-regions.md): Coordinate independent scenes without flattening their ownership.
- [Live Scene Crossings](interactive-crossings.md): Preserve real content while the surrounding scene changes.
- [Arming and Reliable Activation](interactive-arming.md): Watch a crossing before its run exists and through replacements.
- [The Run and Interruption](interactive-run.md): Own transport state and distinguish completion from replacement.
- [Perform Commands and Backward Folding](interactive-commands.md): Reconstruct application state from semantic timeline actions.
- [Creating Composite Steps](interactive-composites.md): Extend the vocabulary through public timeline nodes.
- [Region Lookup and External Providers](interactive-registry.md): Find an owned region without treating the document as one timeline.
- [Composing a Continuous Loop](interactive-circle-loop.md): Keyframe timing connects cluster, field, and grid
- [Composing Slide Changes](interactive-slides.md): Stable roles connect changing compositions
- [Keeping Simulation and Choreography Separate](interactive-drift.md): A simulation and a transition have different responsibilities
- [Turning a Gesture into a Scored Throw](interactive-hang.md): Release velocity is information that layout cannot provide

## 03 Spatial & 3D Choreo

Put real interfaces in space. Work with cameras, live DOM planes, room design, and interactive exhibits. Start with [Spatial & 3D Choreo](spatial-start.md).

- [Spatial & 3D Choreo](spatial-start.md): Place live DOM in a camera-directed three-dimensional scene.
- [Build Your First Spatial Scene](spatial-first-scene.md): Build a small live HTML plane before adding a WebGL model.
- [Directing a 3D Camera](spatial-cameras.md): Direct a camera without introducing a second animation clock.
- [Keeping the Interface Live](spatial-dom.md): Project real controls into the scene and keep their hit targets aligned.
- [Building a Spatial Gallery](spatial-gallery.md): Design a room, allocate exhibit sizes, and manage active rendering work.
- [Framing and Aiming a DOM Camera](spatial-frame.md): Fit a subject or recenter it without changing magnification.
- [Relative Pans and Slow Zooms](spatial-relative.md): Continue a shot from the pose already in force.
- [The Camera3D Renderer Contract](spatial-camera3d.md): Let Choreo direct the pose while the host renders the scene.
- [Camera Paths, Cuts, and Smoothing](spatial-paths.md): Author a continuous tour that can also be rendered exactly.
- [Plane Coordinates and Hit Testing](spatial-coordinates.md): Convert rectangles through a camera without measuring the output again.
- [DOM and WebGL Compositing](spatial-compositing.md): Preserve crisp controls while placing them in a rendered scene.

## 04 Recorded & Film Choreo

Turn a scene into a repeatable presentation. Direct the camera, connect narration, and render a film. Start with [Recorded & Film Choreo](film-start.md).

- [Recorded & Film Choreo](film-start.md): Choose a transport or a complete film composition.
- [Render Your First MP4](film-first-export.md): Capture deterministic frames, mix audio, and encode a playable MP4.
- [Driving an External Clock](film-clock.md): Give an external clock explicit ownership of selected runs.
- [Building a Film](film-shots.md): Organize a picture into shots, chapters, and camera moves.
- [Narration and Overlays](film-audio.md): Connect separate narration clips and readable overlays.
- [Recording and Deployment](film-delivery.md): Review deterministic frames and deploy the complete experience.
- [Authoring a Film Graph](film-graph.md): Describe chapters and shots in the template that renders them.
- [Shots, Tail Poses, and Eye-Level Views](film-poses.md): State what the lens sees at the beginning and end of a shot.
- [The Headless Film Schedule](film-schedule.md): Inspect timing without launching a renderer.
- [Film Handles, Playback, and Exact Rendering](film-transport.md): Choose the correct operation for interaction or export.
- [Attaching Another Region to a Clock](film-attachments.md): Drive a child run through an explicit window.
- [The Standalone Choreo Player](film-player.md): Control selected runs without taking over the document.
- [Registering a Picture and Its Capabilities](film-picture.md): Connect the film to the renderer that actually draws it.
- [Clip Windows, Lanes, and Source Time](film-clips.md): Place video, images, and freezes on the film clock.
- [Media Attachments and Picture-in-Picture](film-media-graph.md): Author inserts as graph components with clear placement and lifetime.
- [Joins and Transition Presentations](film-joins.md): Make the outgoing frame and incoming shot agree at an edit.
- [Seam Readiness and Exact Capture](film-seam-readiness.md): Prevent the incoming frame from flashing before the outgoing still.
- [Picture Adjustments, Grades, and Filters](film-adjustments.md): Hold renderer settings at the group or shot that owns them.
- [World Annotations and Construction Cues](film-world-annotations.md): Connect labels and reveals to the subject they explain.
- [Lower Thirds, Captions, and Screen Overlays](film-typography.md): Give explanatory text its own readable interval.
- [Voice Cues, Mixing, and Browser Playback](film-audio-mix.md): Keep separate narration clips aligned with the tour.
- [Posters, Menus, Rails, and Player Controls](film-interface.md): Make the film usable before, during, and after playback.
- [Graph Compilation and Custom Adjustments](film-graph-extension.md): Extend authoring through typed nodes and patches.
- [Film Math and Formatting Utilities](film-utilities.md): Reuse small calculations without confusing them with a rendering engine.
