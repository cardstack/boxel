# Seam Readiness and Exact Capture

A transition can be timed correctly and still show its images in the wrong order. A full-resolution captured image is not necessarily paintable in the same frame that its URL is assigned to the DOM. If the camera moves first, the viewer can briefly see the incoming shot, then the old still, then the intended transition.

## Waiting for a Paintable Still

The `Seam` helper gates a cut until the outgoing still has decoded. Its hold method accepts the still, the cut operation, and an optional maximum wait. When there is no still to decode, the cut can run synchronously rather than acquiring an unnecessary frame of latency.

```ts title="Component logic excerpt"
import { Seam } from '@cardstack/choreo/film';

const seam = new Seam();
seam.hold(outgoingStill, () => {
  // Apply the incoming pose and begin the transition together.
  commitCut();
});
```

The still and commitCut in this fragment are supplied by the renderer integration. The helper coordinates image readiness; it does not create a frame capture or choose a join. Its finite decode cap prevents a damaged image from holding the film forever, and a newer still-bearing cut retires an earlier pending one.

## Distinguishing Readiness From Timing

Do not compensate for a decode race by making the fade longer. The wrong frame can still appear before the fade starts. Keep the outgoing picture live until the replacement representation is ready, then commit the camera change and overlay as one presentation boundary.

This same reasoning applies to a static gallery tile becoming live. An iframe load event is not proof that its nested canvas has drawn. Keep the preview until the real content reports readiness and has had a chance to paint. Timing and readiness are related, but they are not the same signal.

## Rendering a Requested Frame

An interactive seek can choose to land beyond a seam for responsive navigation. A film export needs the exact requested transition frame and may need to reconstruct the outgoing state, capture it, decode it, and then restore the incoming state. Use FilmHandle.renderAt for that stronger contract instead of simulating a scrub-bar drag.

Inspect a cold capture at the first transition and a repeated capture after assets are cached. Also interrupt one pending cut with another and verify that a late completion cannot overwrite the newer shot. Look for doubled geometry, stale stills, blank overlays, and captions that belong to a different scene. These artifacts point to ordering or ownership failures even when average rendering performance looks healthy.

## API Coverage

**@cardstack/choreo/film**: `Seam`.

Read the implementation: [`seam.ts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/seam.ts).
