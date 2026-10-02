// Pretui — structure/layout: the four atoms a React-trained agent reaches for
// before any domain UI exists.
//
//   Stack          the default React layout atom (Mantine Stack/Group,
//                  Chakra HStack/VStack, MUI Stack)
//   Card           header / media / body / footer COMPOSITION (shadcn Card)
//   Collapsible    a single disclosure (Radix Collapsible) — Accordion is the
//                  multi-panel set
//   AspectRatio    Law 8 in one component (Radix AspectRatio, Mantine
//                  AspectRatio) — also exported as `AspectBox`, the shared
//                  frame Gallery / AssetWell / MediaPlayer / CopyFit /
//                  Skeleton all want
//
// ── The kit constraint that shaped every one of these ────────────────────
//
// The scoped-CSS transpiler appends a `data-scopedcss-<fileHash>-<blockHash>`
// attribute selector to the LAST COMPOUND of every selector, and each template
// block in a file gets its own block hash. Verified through
// `boxel read-transpiled structure.gts`:
//
//     .pretui-panel-header h2   →   .pretui-panel-header h2[data-scopedcss-…]
//
// So a component can only style elements IT authored. `.pretui-stack > * + *`
// would compile to `… > * + *[data-scopedcss-mine]` and match nothing, because
// yielded children carry the CALLER's hash. That single fact decides three
// designs below and is why none of them reach for `:deep()`:
//
//   • Stack's `@dividers` and the `min-inline-size: 0` overflow fix are only
//     available in the `@items` + `<:item>` form, where the cell is authored
//     here. The plain `{{yield}}` form says so rather than shipping a rule
//     that silently does nothing.
//   • Card authors every region wrapper, so its header grid needs no `:has()`.
//   • AspectRatio's `contain`/`cover` modes paint the image themselves rather
//     than styling a caller's `<img>`.
//
// ── Realm laws in force ─────────────────────────────────────────────────
// No timers, no `Date.now()`, no `Math.random()`, no `!important`, no
// `:deep()`, no `:global()`, no dark-mode branches (Appendix F), unnamed
// container queries only, every colour a token with a light fallback.
//
// Pretui — the layout vocabulary shared by Stack, Card, Collapsible and StackDivider: the size and orientation alias maps.
import { resolveSize } from '../pretui-primitives';
import type { PretuiSize } from '../pretui-primitives';

// ── Shared vocabulary + the inbound alias map ────────────────────────────
//
// Appendix E owns the size scale (`xs | s | m | l | xl`). Agents trained on
// shadcn/Tailwind emit `sm | md | lg | default`; those resolve here rather
// than becoming a second enum. This is Button's `@variant` model generalised:
// aliases resolve IN the component, docs teach the house name.

/** Every spelling of a size this kit will accept. */
export type SizeAlias = PretuiSize | 'sm' | 'md' | 'lg' | 'default';

/** Resolve any accepted size spelling to the house enum. */
export function pretuiSize(
  raw: string | undefined,
  fallback: PretuiSize = 'm',
): PretuiSize {
  return resolveSize(raw, fallback);
}

/**
 * Logical orientation. `direction` is accepted as an alias because MUI Stack
 * and react-resizable-panels both spell it that way, and `row`/`column` are
 * accepted because that is what an agent copying flexbox will type.
 */
export type Orientation = 'horizontal' | 'vertical';
export type OrientationAlias = Orientation | 'row' | 'column';

const ORIENTATIONS: Record<string, Orientation> = {
  horizontal: 'horizontal',
  row: 'horizontal',
  vertical: 'vertical',
  column: 'vertical',
};

/** Resolve `@orientation` / `@direction` to the house enum. */
export function pretuiOrientation(
  primary: string | undefined,
  alias: string | undefined,
  fallback: Orientation,
): Orientation {
  let hit = primary === undefined ? undefined : ORIENTATIONS[primary];
  let alt = alias === undefined ? undefined : ORIENTATIONS[alias];
  return hit ?? alt ?? fallback;
}
