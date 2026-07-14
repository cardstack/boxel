---
validated: source-proven
---

# layout-design-board — Parent card as layout shell, children render at per-field formats

**What this gives you:** A parent card whose entire job is layout — it has N `linksTo` children, and each child is rendered in the parent's template at a _chosen_ format (one as `isolated`, one as `embedded`, one as `fitted`). The result: a single scrollable board composed of independent, separately-owned cards.

**When to use:** Design-system pages, internal pitch decks, onboarding flows, micro-mockups, dashboards composed of fully self-contained sub-cards. Any "document made of independent cards" where you want each section editable in isolation but presented together.

**The insight:** CardDef is a composition primitive. You don't have to put all sections in one big card with `containsMany` — instead, give the parent `linksTo Section1`, `linksTo Section2`, etc., and render each in its own preferred format. Children are individually editable, can be reused across boards, and the parent stays focused on layout.

**The chrome-strip trick:** Sections styled as standalone cards bring their own card chrome (borders, padding, background). When delegated into a board, you usually want them flush. One CSS line solves it: `.board-sections > * { background: transparent !important; border: none !important; }`. Reusable across all design-board uses.

**Recipe shape:**

1. Parent has `@field hero = linksTo(HeroSection)`, `@field metrics = linksTo(MetricsPanel)`, etc.
2. Parent's `isolated` template renders each via `<@fields.hero @format='isolated' />`, `<@fields.metrics @format='embedded' />`, etc.
3. CSS strip-chrome on `.board-sections > *`.

**Gotchas:**

- Empty `linksTo` field renders nothing — guard with `{{#if @model.hero}}` for empty states.
- Per-field format override is `@format='…'` on the field invocation, not on `@fields.foo` itself.
- Don't recurse — a board card linking to a board card linking to a board card will work but reads badly.

**Source:** tessar-general `micro-mockups.gts:28-99` (the linksTo fields rendered at chosen formats), `:200-215` (the chrome-strip CSS).

**See also:** `boxel/references/fitted-formats.md`, `boxel/references/delegated-rendering.md`, `layout-card-gallery` (planned).
