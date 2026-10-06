# Derived Motion With Follow

A badge that stays attached to a moving card needs more than a target calculated once. Its position depends on where the card is on every frame. `c.Follow` supplies a controlled derived-value model that reads the run's composed geometry rather than repeatedly measuring its own output from the live page.

## Describing the Relationship

`@of` selects the follower and `@to` selects its sources. `@read` receives a `DeriveContext` and returns the properties to write. `@rest` declares what those properties are when the step is not driving them, allowing measurement to temporarily restore the participant's real layout state.

```ts title="Component logic excerpt"
import type { DeriveContext } from '@cardstack/choreo';

const corner = ({ rest, sources }: DeriveContext) => {
  const card = sources[0];
  if (!card) return { x: 0, y: 0 };
  return {
    x: card.now.x + card.now.width - rest.x - rest.width - 8,
    y: card.now.y - rest.y - 8,
  };
};
```

```gts title="Component template excerpt"
<c.Follow @of={{c.id 'badge'}} @to={{c.id 'card'}}
  @read={{corner}} @rest={{to x=0 y=0}} />
```

Each `FollowSource` exposes its before box, after box, and composed current box. The context also includes the follower's rest box, camera state, normalized progress, and run time. The example calculates translations relative to the follower's own rest position rather than treating a page coordinate as a local transform.

## Keeping the Function Pure

Do not read `getBoundingClientRect()` inside the derived function or keep a previous frame in a closure. The same context must produce the same output when the run seeks backward or reasserts a still. Reading the page can accidentally read the transform just written, creating feedback or a one-frame delay.

Derived writes are restricted to properties such as transform, opacity, and filter, rather than layout dimensions. A width change would alter the measurements on which the next frame depends. Following another follower is also rejected because the dependency ordering would otherwise become ambiguous or cyclic.

## Understanding the Cost

A follower is evaluated on the main thread for each relevant frame. It does not become a compositor-only animation merely because the source movement can be accelerated. Use it for relationships that need it, and profile a scene with many followers on the target device.

Test the relationship throughout the flight and after interruption. Checking only the final corner can miss a stale first frame. Also replace the source's layout while following: the new pass should remeasure the relationship and preserve continuity without carrying an obsolete captured box into the next run.

## API Coverage

**@cardstack/choreo**: `DeriveContext`, `FollowSource`.

**ChoreoContext**: `c.Follow`.

Read the implementation: [`types.ts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/types.ts), [`choreo.gts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo.gts).
