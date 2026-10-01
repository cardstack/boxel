# Motion Configuration and Reduced Motion

A motion system needs a common response without requiring every element to repeat the same configuration. `MotionConfig` supplies defaults to the elements beneath it, including transition settings and reduced-motion policy. It is also the right boundary for pointer-coordinate correction shared by a transformed subtree.

## Supplying Defaults

The component registers itself in the DOM and descendants use the closest configuration. Nested configurations inherit the surrounding values and apply their own explicitly supplied arguments. An individual modifier can still provide its own transition for an interaction that needs a different response.

```gts title="Component template excerpt"
import { MotionConfig, motion, spring, to } from 'glimmer-motion';
const response = spring({ stiffness: 280, damping: 28 });

<template>
  <MotionConfig @transition={{response}} @reducedMotion='user'>
    <button {{motion whileHover=(to scale=1.02)}}>Continue</button>
  </MotionConfig>
</template>
```

The transition resolver supports inheritance rules from the engine; use a transition with `inherit: true` when you intend its fields to merge with the parent's transition. Treat a nested configuration as a design boundary, not as an invisible global setting. `closestMotionConfig(element)` exposes the resolved context for integrations that need to inspect the same boundary.

## Respecting Motion Preferences

This binding defaults to the user's reduced-motion preference. Keep `@reducedMotion='user'` unless a product requirement calls for a stricter policy. `always` forces reduced motion. Do not use `never` merely to make a showcase more dramatic. The interaction must still communicate state when large spatial motion is reduced.

`skipAnimations` is a separate control for immediate completion, useful in some end-to-end or visual checks. It does not replace tests of interruption and continuity. Those tests need real intermediate frames; making every animation instant would remove the behavior they are supposed to verify.

## Additional Host Settings

`transformPagePoint` corrects pointer coordinates for all relevant descendants. Supply it at the narrowest boundary that shares a transform. `nonce` provides the CSP nonce used by styles injected for features such as popLayout. These are host integration settings rather than artistic timing controls, but they belong in the same inherited context.

Check nested configurations in the actual DOM structure. A component hierarchy that renders into a different DOM location may not have the ancestor you expected. Keep the resolved behavior visible in a small fixture, then verify one ordinary transition, one reduced-motion transition, and a transformed drag. The result should be consistent without requiring the page to rewrite every modifier argument.

## API Coverage

**glimmer-motion**: `MotionConfigContext`, `closestMotionConfig`, `MotionConfig`.

Read the implementation: [`motion-config.gts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/motion-config.gts).
