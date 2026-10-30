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
 * packages/choreo-gallery/realm/docs/nested-choreo.md has the reasoning.
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
 * Measure the live beacons, in the same window the region measures `final`.
 *
 * Re-measured every pass, never cached: the trash can move without the list
 * rendering at all — a header that hides, a column that resizes, a scroll.
 *
 * A region passes the names its score asked for, so a pass measures only
 * those: a page can claim hundreds of beacons (every chip a sheet may open
 * from), and each region measuring every one on every pass would cost a
 * layout read per beacon per region. Without `names`, every claimed beacon
 * is measured.
 */
export function measureBeacons(
  root: DOMRect,
  names?: Iterable<string>,
): Map<string, Bounds> {
  const out = new Map<string, Bounds>();
  const wanted = names
    ? [...names].map((name) => [name, registry.get(name)] as const)
    : [...registry];
  for (const [name, el] of wanted) {
    if (!el?.isConnected) {
      continue;
    }
    const bounds = measureBounds(el, root);
    if (bounds) {
      out.set(name, bounds);
    }
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
