# CS-13460: setupMotion in the choreo-test-app Motion suites

## Goal

Every choreo-test-app suite that renders motion elements calls `setupMotion(hooks)` (or `setupChoreo(hooks)`), so glimmer-motion's document-wide state is reset around each of its tests. That state is the projection-root block, the motion speed, the layout-loop guard and every registered reset. The layout-loop guard report in `setupMotion`'s `afterEach` then runs for these suites too.

## Scope

`setupMotion(hooks)` goes into every top-level QUnit module (including those generated in `for` loops) of these suites:

- `tests/integration/motion/`: `animate-presence-reentry`, `animate-presence`, `animate-prop`, `delay`, `layout-group`, `motion-config`, `presence-late-child`, `speed`, `style-prop`, `transition-keyframes`, `unmount-motion-value`, `variant`
- `tests/integration/motion/drag/`: all 9 suites
- `tests/integration/motion/gestures/`: all 5 suites
- `tests/integration/motion/layout/`: all 5 suites
- `tests/integration/table-plan-test.gts` (renders `Grip`, which uses `motion` and drag controls)

The call goes directly after `setupRenderingTest(hooks)`, following the existing setup-calling suites.

`speed-test` drops its own `afterEach(() => setMotionSpeed(1))`, because `resetMotion()` already resets the speed.

### Out of scope

- Suites that render `<Choreo>` (directly, or through the fold/hang/film components) take `setupChoreo` and are covered separately.
- Suites that render no motion elements: `film/clip-look`, `film/graph` and `film/join-presentation` (the film graph renders node markers, not motion elements), `motion/scroll-test` (`useInView` / `useScroll` over plain elements), and `motion/fixture-viewport-test`.
- Unit tests.

## Testing

- `pnpm lint` in `packages/choreo-test-app` (includes `ember-tsc`).
- Full choreo-test-app suite: `pnpm test`. Any test that only passed because of state a previous test left behind gets fixed in the test itself.
