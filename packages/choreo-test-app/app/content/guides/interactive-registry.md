# Region Lookup and External Providers

Most templates receive their Choreo context directly from the region. Integrations such as an external player or a host-controlled lane need to locate a region after it mounts. The registry APIs provide explicit lookup while retaining the distinction between a region and its participants.

## Choosing a Lookup

`closestChoreo(element)` finds the nearest ancestor host for a participant. `choreoHostAt(element)` looks up the host registered on a region element itself. `choreoHostById(id)` finds a region declared with that identifier. These functions answer different questions; passing a region element to an ancestor lookup can select its parent instead of the region you intended.

```ts title="Component logic excerpt"
import { choreoHostById } from 'glimmer-motion';

const host = choreoHostById('presentation');
const run = host?.currentRun();
run?.pause();
```

Lookup can return nothing before mount or after destruction. A host's `currentRun()` can also return null between runs. Treat these as normal lifecycle states, not as a reason to scan every animation in the document or start a polling timer with no cleanup.

## Understanding the Host Contract

`ChoreoHost` includes participant registration and claiming removed nodes, plus current-run access. Those methods are adapter responsibilities. Ordinary application code should not manually register the same element that the modifier already owns. Double ownership can lead to duplicate measurements or a departing element being released at the wrong time.

`ChoreoProvider` is the structural interface for something that supplies a `node()`. The host's `contribute()` method accepts an external provider and returns a removal function. The source marks this lane-oriented surface as a spike, so use it as an advanced integration boundary and pin its behavior with local tests rather than presenting it as a required application pattern.

## Preserving Lifecycle Ownership

Keep the remover returned by contribution and call it when the integration ends. Use a stable provider object whose node method is pure. An external provider joins the region's score; it does not receive permission to run another independent animation clock over the same elements.

For transport, prefer a function that resolves the current owned run on every operation. A region can be re-keyed under the same identifier while the prior instance is being destroyed. The registry guards replacement ownership, but a cached reference to the old host still points to old work.

Test lookup before mount, after replacement, and after teardown. Verify that destroying one of two regions does not remove the surviving region's registration. Explicit identity and cleanup are what make cross-region tools reliable as the application changes shape.

## API Coverage

**glimmer-motion**: `ChoreoHost`, `choreoHostAt`, `choreoHostById`, `ChoreoProvider`, `closestChoreo`.

Read the implementation: [`registry.ts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/registry.ts).
