# Arming and Reliable Activation

A host often needs to know that a scene change is underway before Choreo has compiled the resulting run. It may suppress entrance effects, hold an expensive renderer, or keep a preview visible until the landing. `createArming()` provides that lifecycle signal without coupling the library to a router.

## Beginning Before Render

Create an arming instance and call `begin(region)` when the host commits to the change. The region argument only needs to expose its current run through the `ArmingRegion` contract. `active()` is tracked, so a template can read it, and `settled()` resolves when the watch stands down.

```ts title="Component logic excerpt"
import { createArming } from '@cardstack/choreo';

const crossing = createArming({ deadline: 4000 });
// After obtaining the region instance:
// crossing.begin(region);
// perform the application state change
// await crossing.settled();
// activate the expensive content if this request is still current
```

The deadline is in milliseconds, unlike step durations in seconds. It is a backstop for an aborted or identical change that never produces a run. It is not a replacement for the run's actual duration and should not be tuned as a cinematic delay.

## Following the Surviving Run

A crossing can be interrupted and replaced. The old run's `finished` promise can resolve while its successor is still moving, so waiting on that one promise is insufficient. Arming follows the current surviving run and uses generations to prevent an older completion from standing down a newer crossing.

`end()` lets the host stand down explicitly, and `onStandDown` provides a cleanup hook. A parked or standing run represents a settled condition rather than motion that must eventually finish. The helper accounts for that distinction so an annotation does not block activation forever.

## Keeping Readiness Separate

Arming describes the crossing lifecycle. It does not prove that an iframe, texture, font, or audio asset has loaded. A tile handoff still needs a separate readiness signal from the incoming content. Keep the static preview visible until that content has actually painted, then switch ownership without revealing a blank layer.

After awaiting a watch, confirm the activation request is still current. A user may have selected another tile while the first was waiting. The helper protects its own watch generations; the host remains responsible for the identity of its pending mount or data request.

Test no-op navigation, aborted changes, repeated selections, and a successor run started before the prior one settles. These are the cases where a boolean set at the beginning and cleared by a fixed timeout becomes unreliable. The helper exists to encode those cases once rather than reproduce them in every gallery or application shell.

## API Coverage

**@cardstack/choreo**: `Arming`, `ArmingOptions`, `ArmingRegion`, `createArming`.

Read the implementation: [`arming.ts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/arming.ts).
