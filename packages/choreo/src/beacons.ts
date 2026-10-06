/**
 * Beacons — a named box that does not animate.
 *
 * Ember Animated's primitive: `<AnimatedBeacon>` measures its child when a
 * transition starts, stores a sprite on the motion service, and a generator
 * reads `context.beacons` to say "start here" or "end there". The beacon
 * itself never moves.
 *
 *   <button {{beacon 'trash'}}>Trash</button>
 *
 *   <Choreo as |c|>
 *     …
 *     <c.Move @of={{c.removed 'row'}} @to={{c.beacon 'trash'}} />
 *   </Choreo>
 *
 * This is deliberately NOT `layoutId`. `layoutId` pairs two real elements that
 * share an identity and morphs one into the other — putting it on a leaving row
 * and on the bin would make the bin a shared element, and it would stretch. A
 * beacon has no identity in the changeset: it is not inserted, kept or removed,
 * it is a point other sprites may borrow. A beacon moving on its own never
 * starts a run.
 *
 * The registry is document-global on purpose. The case that wants beacons is an
 * inbox — the trash lives in the chrome, the list lives in the outlet, and they
 * are different regions precisely so their changesets stay apart. A region-local
 * registry could not see across that boundary, which is the whole point.
 * docs/nested-choreo.md has the reasoning.
 */
import { measureBounds } from './measure.ts';
import type { Bounds } from './types.ts';

/** name → the element claiming it. First registration this pass wins, as Ember Animated's `hasBeacon` does. */
const registry = new Map<string, Element>();

export function registerBeacon(name: string, element: Element): () => void {
  if (!registry.has(name)) {
    registry.set(name, element);
  }
  return () => {
    if (registry.get(name) === element) {
      registry.delete(name);
    }
  };
}

/**
 * Measure every live beacon, in the same window the region measures `final`.
 *
 * Re-measured every pass, never cached: the trash can move without the list
 * rendering at all — a header that hides, a column that resizes, a scroll.
 */
export function measureBeacons(root: DOMRect): Map<string, Bounds> {
  const out = new Map<string, Bounds>();
  for (const [name, el] of registry) {
    if (!el.isConnected) {
      continue;
    }
    out.set(name, measureBounds(el, root));
  }
  return out;
}

/**
 * Forget every claimed name. The registry outlives any one owner, so a test
 * that tore down mid-flight would otherwise leave a dead element holding a
 * name the next test wants — first-wins turns into first-test-wins.
 * `setupChoreo(hooks)` runs this before and after every test; nothing in an
 * app should.
 */
export function resetBeacons() {
  registry.clear();
}

/** `{{c.beacon 'trash'}}` — a named point, not a sprite query */
export interface BeaconRef {
  beacon: string;
}

export const isBeaconRef = (v: unknown): v is BeaconRef =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as BeaconRef).beacon === 'string';
