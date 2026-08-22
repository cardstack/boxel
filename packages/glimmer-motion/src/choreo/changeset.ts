/**
 * boxel-motion's Changeset: the sprites one render pass produced, and the
 * spritesFor / spriteFor queries its transitions selected them with.
 */
import type { ChangesetLike, Query, Sprite } from './types.ts';

const isStill = (s: Sprite) =>
  !s.delta ||
  (s.delta.x === 0 &&
    s.delta.y === 0 &&
    s.delta.width === 0 &&
    s.delta.height === 0);

export default class Changeset implements ChangesetLike {
  readonly inserted: Sprite[];
  readonly kept: Sprite[];
  readonly removed: Sprite[];

  constructor(inserted: Sprite[], removed: Sprite[], kept: Sprite[]) {
    this.inserted = inserted;
    this.removed = removed;
    this.kept = kept;
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
      default:
        pool = this.all;
    }
    return pool.filter(
      (s) =>
        (query.id === undefined || s.id === query.id) &&
        (query.role === undefined || s.role === query.role),
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
