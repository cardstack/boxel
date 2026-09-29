# Film Math and Formatting Utilities

The film subpath exports a small set of arithmetic and formatting helpers used throughout its interface and presentation code. They are useful when extending a player or overlay, but their deliberately narrow contracts matter. A helper that formats time or blends two numbers does not supply a color-management or camera-simulation system.

## Interpolation and Progress

`lerp(a, b, t)` linearly interpolates between two numbers. It does not clamp t, which is useful for some extrapolations but means callers should use `clamp01()` when progress must stay within an interval. `smooth()` applies a clamped smoothstep curve. `RAD` converts degrees to radians by multiplication.

```ts title="Component logic excerpt"
import { clamp01, lerp, smooth, RAD, mmss } from 'glimmer-motion/film';

const progress = clamp01(elapsed / duration);
const opacity = smooth(progress);
const yawRadians = lerp(10, 30, progress) * RAD;
const label = mmss(elapsed);
```

Validate duration before dividing by it. A zero or invalid duration is a host data problem, not something a progress helper can make meaningful. For an authored Choreo step, use the step's timing and easing model rather than duplicating the same curve in a second animation loop.

## Color Helpers

`hex()` parses a six-digit hexadecimal color into normalized RGB channels. `rgba()` formats a supported color with alpha. `luminance()` calculates the lightweight weighted brightness measure used by the film's UI decisions. It operates on the parsed channels without a full color-space conversion, so do not use it as a standards-compliant contrast audit or a substitute for linear-light compositing.

The helpers expect the formats documented by their implementation. Short hex colors, arbitrary CSS color functions, and wide-gamut values need a different parser. An overlay extension should either keep its input constrained or validate and convert before calling these helpers.

## Formatting Time

`mmss()` provides a compact nonnegative minute-and-second label. It is suitable for a transport readout, but it does not encode frame numbers, drop-frame timecode, or the film's domain-specific clock. A construction-year rail should use FilmClock rather than relabeling seconds as years.

## Choosing the Right Boundary

These helpers are convenient building blocks for custom presentation components and diagnostics. They should remain pure calculations. Keep asset loading, frame readiness, and transport ownership in the appropriate player or picture layer.

Test edge values that your interface can produce: progress before the window, progress after the tail, an empty duration, and a malformed color. Then compare the resulting labels and overlays against the actual rendered picture. A mathematically smooth opacity can still be unreadable over a bright scene, and a correctly formatted time can still be stale if it reads from the wrong clock.

## API Coverage

**glimmer-motion/film**: `clamp01`, `hex`, `lerp`, `luminance`, `mmss`, `RAD`, `rgba`, `smooth`.

Read the implementation: [`math.ts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/math.ts).
