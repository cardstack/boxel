/**
 * boxel-motion's Changeset: the sprites one render pass produced, and the
 * spritesFor / spriteFor queries its transitions selected them with.
 */
import type { Bounds, ChangesetLike, Query, Sprite } from './types.ts';

/**
 * Is any part of this sprite inside the window (Query.onstage)?
 *
 * A removed sprite is judged where the OLD scene showed it — its initial box,
 * captured before the crossing scrolled the window — and everything else where
 * the new scene will show it. Both boxes are client-space measurements taken
 * on their own side of the scroll, so each is compared against the viewport
 * that was (or will be) actually on screen with it.
 */
function onstage(s: Sprite): boolean {
  const box = (s.type === 'removed' ? s.initial : (s.final ?? s.initial))?.page;
  if (!box) {
    return true;
  }
  return (
    box.x < window.innerWidth &&
    box.y < window.innerHeight &&
    box.x + box.width > 0 &&
    box.y + box.height > 0
  );
}

const isStill = (s: Sprite) =>
  !s.delta ||
  (s.delta.x === 0 &&
    s.delta.y === 0 &&
    s.delta.width === 0 &&
    s.delta.height === 0);

export class Changeset implements ChangesetLike {
  readonly inserted: Sprite[];
  readonly kept: Sprite[];
  readonly removed: Sprite[];

  /**
   * The box a `{{beacon}}` claimed this pass, or null if nothing claimed that
   * name. It is a measurement, not a sprite: a beacon is never inserted, kept
   * or removed, and a missing one is a no-op for whatever wanted to borrow it.
   *
   * Closed over rather than stored as a field, so this class stays structurally
   * identical to ChangesetLike — a property function written against the
   * concrete Changeset must still accept the interface it is handed.
   */
  readonly beacon: (name: string) => Bounds | null;

  /**
   * The camera zoom the world was measured under (§6.3). Every box in this
   * changeset is a page-space measurement taken through the region's frame
   * transform, but a step's values are written in the sprite's own local
   * space — so geometry that becomes inline pixels must be divided back by
   * this before it is animated. 1 when the frame is at rest.
   */
  readonly measureZoom: number;

  /** the frame's own size in local pixels, from the same final layout */
  readonly frame?: { height: number; width: number };

  /** what the page shows behind this region — see ChangesetLike.ground */
  readonly ground?: string;

  constructor(
    inserted: Sprite[],
    removed: Sprite[],
    kept: Sprite[],
    beacons: Map<string, Bounds> = new Map(),
    measureZoom = 1,
    frame?: { height: number; width: number },
    ground?: string,
  ) {
    this.inserted = inserted;
    this.removed = removed;
    this.kept = kept;
    this.beacon = (name) => beacons.get(name) ?? null;
    this.measureZoom = measureZoom;
    this.frame = frame;
    this.ground = ground;
  }

  get all(): Sprite[] {
    return [...this.kept, ...this.inserted, ...this.removed];
  }

  /** something happened this pass that a choreography could animate */
  get dirty(): boolean {
    return (
      this.inserted.length > 0 ||
      this.removed.length > 0 ||
      this.kept.some((s) => !isStill(s))
    );
  }

  sprites(query: Query | Query[]): Sprite[] {
    if (Array.isArray(query)) {
      const out: Sprite[] = [];
      for (const q of query) {
        for (const s of this.sprites(q)) {
          if (!out.includes(s)) {
            out.push(s);
          }
        }
      }
      return out;
    }
    let pool: Sprite[];
    switch (query.type) {
      case 'inserted':
        pool = this.inserted;
        break;
      case 'removed':
        pool = this.removed;
        break;
      case 'kept':
        pool = this.kept;
        break;
      case 'still':
        pool = this.kept.filter(isStill);
        break;
      case 'moved':
        pool = this.kept.filter((s) => !isStill(s));
        break;
      case 'received':
        // the receiving half of a counterpart / far match: kept, but only
        // because an arriving element claimed a leaving one's identity
        pool = this.kept.filter((s) => s.counterpart);
        break;
      case 'counterpart':
        // the removed half that was claimed — the old element, orphaned so a
        // step can cross-fade it while its replacement flies
        pool = this.removed.filter((s) => s.claimed);
        break;
      case 'departed':
        // what only the old scene had: removed, claimed by nobody, not
        // carried on by another region — the crossing's LEAVES
        pool = this.removed.filter((s) => !s.claimed && !s.sent);
        break;
      default:
        pool = this.all;
    }
    return pool.filter(
      (s) =>
        (query.id === undefined || s.id === query.id) &&
        (query.role === undefined || s.role === query.role) &&
        (!query.onstage || onstage(s)),
    );
  }

  sprite(query: Query | Query[]): Sprite | null {
    const found = this.sprites(query);
    if (found.length > 1) {
      throw new Error(
        `choreo: more than one sprite matches ${JSON.stringify(query)}`,
      );
    }
    return found[0] ?? null;
  }
}

export default Changeset;
