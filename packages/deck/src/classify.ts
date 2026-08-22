// What to do with a URL-shaped string when a tree moves.
//
// Part of the browser-safe surface (see `resolve.ts`): no `node:` import
// here, or in anything this file reaches.
//
// THE BUG THIS EXISTS TO PREVENT. The obvious way to re-home a tree is to
// search and replace: take `{from, to}` prefix pairs and rewrite every
// string in every JSON file. That is what the cardpack implementation did,
// and it works right up until a piece of DATA looks like a reference. A card
// with
//
//     "backgroundURL": "https://boxel-images.example/background-82x.jpg"
//
// survives today only because that host happens not to match a rule. Nothing
// makes it safe; it is luck. A source URL that happened to prefix an asset
// URL would silently corrupt content, and the damage would be invisible
// until someone opened the card months later.
//
// So this module refuses to guess twice over.
//
//   1. The CALLER says whether a string sits in a reference position. A
//      value that is merely data is never touched, whatever it looks like.
//      `role` has no default — a caller that has not thought about it should
//      not compile.
//   2. Among references, only what the decklist DECLARES is treated as a
//      dependency. Enumeration, not pattern matching.
//
// Everything else is left alone, and reported, so a caller can tell someone
// what it did not do.

/**
 * Whether a string is a reference at all.
 *
 * `reference` — an import specifier, a module pointer, a link between
 * documents. Something whose job is to name another file.
 *
 * `opaque` — everything else: an image URL, a webhook endpoint, a string
 * that merely looks like a URL. Never rewritten, never rebound, no matter
 * what it matches.
 */
export type ReferenceRole = 'reference' | 'opaque';

export type Classification =
  // Nothing to do, and why not.
  | {
      action: 'leave';
      reason:
        | 'opaque' // not a reference — data
        | 'relative' // position-independent already
        | 'bare' // a specifier; the import map handles it
        | 'foreign'; // absolute, and not ours to move
    }
  // A declared dependency. The caller re-resolves `specifier` against the
  // destination's map, rather than rewriting the string it found.
  | {
      action: 'rebind';
      reason: 'declared-dependency';
      specifier: string;
      rest: string;
    }
  // Points at the tree being moved. The caller re-points it at the
  // destination base.
  | { action: 'rewrite'; reason: 'source-base'; rest: string };

export interface ClassifyOptions {
  value: string;
  role: ReferenceRole;
  /**
   * The flattened decklist: specifier → where that dependency currently
   * lives. This is what turns "is this a dependency?" from a guess into a
   * lookup.
   */
  imports?: Record<string, string>;
  /**
   * The URL prefix that means "this tree" at the source — the one thing
   * that certainly has to be re-pointed when the tree lands somewhere else.
   */
  sourceBase?: string;
}

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

function isRelative(value: string): boolean {
  return value.startsWith('./') || value.startsWith('../');
}

function isAbsolute(value: string): boolean {
  return HAS_SCHEME.test(value) || value.startsWith('/') || value.startsWith('//');
}

export function classifyReference(options: ClassifyOptions): Classification {
  let { value, role, imports = {}, sourceBase } = options;

  // Rule 1. Data is data.
  if (role === 'opaque') {
    return { action: 'leave', reason: 'opaque' };
  }

  // A within-tree reference is already position-independent: it means the
  // same thing wherever the tree is mounted. This is why most of a
  // well-written realm needs no re-homing at all.
  if (isRelative(value)) {
    return { action: 'leave', reason: 'relative' };
  }

  if (!isAbsolute(value)) {
    // A bare specifier resolves through the import map, so moving the tree
    // cannot break it — the map moves too.
    return { action: 'leave', reason: 'bare' };
  }

  // Rule 2. Declared dependencies, longest target prefix first — the same
  // discipline `resolveSpecifier` uses, for the same reason: `lib` and
  // `lib-extra` must not depend on key order.
  //
  // Declared beats source-base on purpose. A deck usually lists its OWN
  // modules in its map, so those match both; rebinding is the better answer
  // because it re-resolves through the destination's map instead of assuming
  // the destination lays the tree out the same way.
  let best: { specifier: string; target: string } | undefined;
  for (let [specifier, target] of Object.entries(imports)) {
    if (!target || !value.startsWith(target)) {
      continue;
    }
    if (!best || target.length > best.target.length) {
      best = { specifier, target };
    }
  }
  if (best) {
    return {
      action: 'rebind',
      reason: 'declared-dependency',
      specifier: best.specifier,
      rest: value.slice(best.target.length),
    };
  }

  if (sourceBase && value.startsWith(sourceBase)) {
    return {
      action: 'rewrite',
      reason: 'source-base',
      rest: value.slice(sourceBase.length),
    };
  }

  // Absolute, in a reference position, and neither declared nor ours.
  //
  // Left alone deliberately. Rewriting it would point it somewhere that may
  // not exist, and dropping it would lose information — so it survives, and
  // the caller is told, which is how a pack reports the links it carries but
  // cannot resolve.
  return { action: 'leave', reason: 'foreign' };
}

export interface ClassificationReport {
  rebind: number;
  rewrite: number;
  leave: number;
  /** Absolute references that are neither declared nor ours: the honest
   *  "here is what this artifact does not carry" list. */
  foreign: string[];
}

/**
 * Summarise a run, so intake can say what it did and what it left.
 *
 * A migration that reports only its successes reads as complete when it is
 * not. The `foreign` list is the part worth printing.
 */
export function summarise(
  seen: readonly { value: string; result: Classification }[],
): ClassificationReport {
  let report: ClassificationReport = {
    rebind: 0,
    rewrite: 0,
    leave: 0,
    foreign: [],
  };
  for (let { value, result } of seen) {
    if (result.action === 'rebind') {
      report.rebind += 1;
    } else if (result.action === 'rewrite') {
      report.rewrite += 1;
    } else {
      report.leave += 1;
      if (result.reason === 'foreign') {
        report.foreign.push(value);
      }
    }
  }
  return report;
}
