# Diagnose Motion Problems

Start with the visible symptom, then identify who owns the affected state, property, or clock. A working animation can fail when it is embedded in another layout or driven by a recorder. The checks below come from the gallery's integration work and point to smaller reproductions you can use before changing the engine.

## The element jumps when application state changes

Inspect the element for a bound style attribute as well as a motion modifier. A Glimmer update to the style attribute can replace transforms written by the animation engine. Move animated styles into the modifier's style argument. Keep the item's ID stable across reorders, and check whether a second component is using the same identity unintentionally. The task board in [the first application tutorial](/docs/core-first-app) provides a small interruption example.

If a row disappears immediately, check who owns removal. Presence manages the content it yields; Choreo retains participants named by its exit score. Combining both around the same scene can obscure which system should release the leaving element. Do not read newly selected application data to render an old exiting item.

## Rounded corners distort during a shared-layout transition

Declare borderRadius through motion's style input so layout scale correction can account for it. Then test the component outside any transformed ancestor. If it works flat but fails inside a moving 3D tile, the external camera may be contaminating viewport measurements. The gallery isolates Lightbox in its own document to give it a stable local coordinate system. This is a host-level boundary, not a reason to disable correction across the library.

## A live tile appears blank or the room stutters

Separate loading from rendering. An image load event does not prove that a model, font, canvas, and application have all painted their first useful frame. Retain the preview until the replacement reports readiness, and inspect failed asset requests. A missing model URL and an overloaded GPU can both look like a blank tile but require different fixes.

Profile the number of active renderers and layout updates. Freeze or unmount offscreen examples, avoid reading every tile's geometry on every pointer event, and measure on the target phone. Slowing a camera can reduce perceived rush; it does not establish that the scene meets its frame budget. Start with one live plane in [the spatial tutorial](/docs/spatial-first-scene).

## The sound stops or starts at the wrong position

Check the media request, content type, and playback rejection before changing timeline durations. Browser playback must begin from an allowed user gesture. For separate clips, retain the clip identity and local time, remove listeners when replacing a clip, and distinguish natural completion from cancellation. A resumed clip needs an explicit seek; assigning the same source alone may not restart it.

The gallery keeps a checkpoint for the full tour and uses the media clock for the short tour. Its exported MP4 has separate encoded audio. Passing a browser playback check does not verify that the exported mix is aligned, and an offline encoder cannot validate Safari's sound-start permissions.

## A recorded frame depends on how you reached it

Request the same timestamp after a forward seek, a backward seek, and a fresh page load. Compare both application state and pixels. A seekable motion run cannot recreate a panel that application code never opened. An accumulated camera spring also needs an explicit reconstruction strategy. The [MP4 tutorial](/docs/film-first-export) includes a small pixel comparison and a complete recorder.

Before filing an issue, reduce the case to one component and report the library version, browser, expected result, actual result, and shortest action sequence. Include whether the failure requires a transformed parent, reduced motion, route change, or external clock. That context usually makes a bug much easier to reproduce than a long recording of the complete gallery.
