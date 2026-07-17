# live-activity-feed-card — A "more alive" activity/log card

**What this gives you:** the working recipe for a live activity feed —
status-gated motion, ticking clocks, append-only entries with per-entry
linked cards/images, newest-first display. Proven live as a software-factory
run-log live blog card.

## The five load-bearing moves

1. **Append-only `containsMany(EntryFieldDef)` with per-entry `linksTo`,
   newest-first via CSS.** Entries append (stable `entries.N.card` /
   `entries.N.image` indexed relationship keys); the template renders
   `{{#each @fields.entries as |Entry|}}<Entry />{{/each}}` inside a
   `display:flex; flex-direction:column-reverse` container. **NEVER
   prepend** — index shifts rewrite every existing relationship key.
   Never use the plural-field wrapper (`<@fields.entries />`) — it defeats
   the reversal. `justify-content: flex-end` pins content to the visual
   top when the container is taller than the feed. DOM-first children
   render at the visual BOTTOM — put a static intro/explainer block before
   the `{{#each}}` and it becomes the story's start.
2. **All motion gated on a status attribute.**
   `data-status={{@model.status}}` on the root; scan line / pulse /
   arrival-wash CSS only under `[data-status='running']` (plus
   `{{#if this.running}}` for extra DOM like a throbber). The card visibly
   "goes quiet" when the run ends. Vocabulary: `softpulse` 2s opacity,
   `scan` 2.4s gradient sweep (background-size 200% + background-position
   keyframes), one-shot `animation: arrive 3s ease-out 1` on
   `.feed > :last-child` (DOM-last = newest).
3. **Ticking clocks**: `@tracked nowMs = Date.now()` + `setInterval` in the
   component constructor + `registerDestructor(this, () =>
   clearInterval(...))`. Elapsed label derives from `startedAt` vs `nowMs`
   while running, frozen at the last entry's timestamp when done. Per-entry
   relative labels ("3m ago") use a 30s interval per entry component.
4. **One `linksTo`, three renders.** The same `card` field renders
   `@format='embedded'` for payoff moments (ship it!), a sized
   `@format='fitted'` frame (~460×92, parent owns the box) for reference
   moments, and `@format='atom'` chips for compact detail links — pick per
   entry kind. Parent owns all chrome via `:deep(.boxel-card-container)`.
   Entry images: `image = linksTo(() => FileDef)` — NEVER CardDef-typed.
5. **CSS-only equalizer throbber**: three `<i>` bars, staggered
   `animation-delay`, `scaleY` keyframes — reads as "working" next to the
   NOW item without JS.

Entry FieldDef shape that worked: `kind` (drives glyph + chip color via
`data-kind`), `at` (DatetimeField), `who` (voice: orchestrator / executor /
operator), `headline`, `body` (MarkdownField), `imageUrl` fallback +
`image`/`card` links.

**Writer-side caveat** (if an external process appends): the
`/_atomic?waitForIndex=true` sync path strips containsMany FieldDef data —
raw-write the instance (plain file write of the full JSON) after every such
sync.
