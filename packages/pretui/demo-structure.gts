// The usage pages this module used to hold now live in
// components/<slug>.usage.gts; what remains here is the fixtures they
// share. The header below describes those pages, not this file.
// Pretui — demo-structure: boxel-ui freestyle usage pages ported to the
// structure/overlay/fitted territories, rendered with the ported
// ember-freestyle machinery (FreestyleUsage + yielded Args components).
// Sources: container, card-container, header, tabbed-header, tooltip, menu,
// dropdown, modal (drawer semantics), fitted-card usage.gts.

// ── Tooltip ← tooltip/usage.gts ──────────────────────────────────────────

export const SIDE_OPTIONS = ['top', 'bottom', 'left', 'right'];

// ── Popover ← dropdown/usage.gts ─────────────────────────────────────────

export const PLACEMENT_OPTIONS = [
  'top',
  'top-start',
  'top-end',
  'bottom',
  'bottom-start',
  'bottom-end',
  'left',
  'left-start',
  'left-end',
  'right',
  'right-start',
  'right-end',
];

// ── Drawer ← modal/usage.gts (drawer semantics) ──────────────────────────

export const DRAWER_PLACEMENT_OPTIONS = ['end', 'start', 'bottom'];

// ── Registry ─────────────────────────────────────────────────────────────

