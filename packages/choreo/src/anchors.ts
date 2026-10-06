/**
 * Anchors — "with / after build N", as typed helpers rather than a string
 * micro-DSL (docs/choreo-constructs.md §4.2). A step names itself with
 * `@name`; any later step may start against it with `@at`:
 *
 *   <c.Tween @name='head' … />
 *   <c.Tween @at={{at 'head' 0.4}} … />     start at 40% of head
 *   <c.Tween @at={{after 'head' 0.2}} … />  start 0.2s after head ends
 *
 * `at name 1` and `after name` are the same moment. Anchors point up the
 * score, the way Keynote's build list does; a forward reference is a
 * compile error, as is a duplicate name.
 */

export interface AnchorRef {
  anchor: string;
  /** seconds past the named step's end (`after`) */
  delay?: number;
  edge: 'end' | 'start';
  /** 0..1 of the named step's own length (`at`) */
  progress?: number;
}

/** start at the named step's start, plus `progress` (0–1) of its length */
export function at(name: string, progress = 0): AnchorRef {
  return { anchor: name, edge: 'start', progress };
}

/** start at the named step's end, plus `delay` seconds */
export function after(name: string, delay = 0): AnchorRef {
  return { anchor: name, delay, edge: 'end' };
}
