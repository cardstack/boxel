// Pretui — blocks: stateless sample assemblies (Appendix I, Blocks tier).
//
// A BLOCK is not a component. It takes all of its data through args,
// composes components the kit already ships, and owns nothing persistent —
// no @tracked, no state machine, no timers, no internal selection. The
// moment one of these needs to remember something between renders it has
// stopped being a block and become a component, and it moves out of this
// file. That line is the whole point of the tier: blocks are how the kit
// shows what its components look like standing next to each other, and a
// block that hides state is a lie about composition.
//
// Corollary, and it is load-bearing: there is almost no new CSS here beyond
// layout and the Appendix E variant recipes. Where one of these blocks
// wanted a visual treatment the kit does not own, the gap is written down
// in the doc comment as a finding against the COMPONENT rather than patched
// locally. `!important`, `:deep()` and `:global()` do not appear, and the
// reason they do not appear is that nothing here reaches into a child.
//
// Sourced from boxel-catalog.md Bucket 3 (B1–B4). Every source defect named
// there is listed against the block that inherits the idea, with what this
// cut does instead.
//
// Pretui — the heading-level contract every block shares.

/** Heading level a block's own headline should occupy in the host page.
 * A block cannot know where it sits, so the caller says. */
export type BlockHeadingLevel = 1 | 2 | 3 | 4;

/** `aria-level` for the block's `<h2>`, or `undefined` at the native level
 * so no redundant attribute is emitted. Every block renders a real heading
 * element and overrides only the LEVEL, which is the one thing that is a
 * property of the page rather than of the block. */
export function ariaLevelFor(level: BlockHeadingLevel | undefined) {
  return level === undefined || level === 2 ? undefined : String(level);
}
