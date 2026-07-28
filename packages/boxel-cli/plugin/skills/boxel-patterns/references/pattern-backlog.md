# Planned Pattern Backlog

Slugs reserved in the taxonomy but **not yet extracted** — a roadmap for future extraction, not a menu. **Do not chase these when building**: if you need one now, fall back to source realms or core skills (`boxel`, `boxel-design`, `boxel-ui-guidelines`). This file exists for pattern *authors* deciding what to extract next; agents routing a user request should stay in the Ready Patterns list in `../SKILL.md`.

## Show (planned)

- `show-diagram` — Inline mermaid diagram inside a card body.
- `show-map` — GeoJSON / TopoJSON map renderer with pan/zoom.
- `show-chart` — Configurable chart (type + data).
- `show-table-from-csv` — Auto-rendered table from CSV-fenced data.
- `show-3d-model` — STL viewer fence.
- `show-math` — LaTeX block via `math` fence.
- `show-slides` — Markdown-driven slide deck.
- `show-whiteboard` — Excalidraw fenced block.
- `show-canvas-3d` — Custom WebGL/Three.js canvas inside a card.
- `show-external-embed` — URL preview / oEmbed.

## Pick / Input (planned)

- `pick-color` — Color FieldDef with hex/HSL/HSB variant dispatch and LRU-cached parser.
- `pick-date` — Flex date/time field with required/optional, partial precision.
- `pick-from-enum` — `enumField` for constrained-value dropdowns. (See `boxel/references/enumerations.md`.)
- `pick-from-query` — Dropdown of cards matching a query.
- `pick-multiple-tags` — Multi-select chips backed by an enum.
- `pick-geo-point` — Address-search → lat/lng with reverse geocoding.
- `attach-image` — Image upload via FileDef + dropzone variant.
- `attach-multiple-images` — Gallery of uploaded images with state machine.
- `attach-file-generic` — Any-file FileDef. (See `boxel-file-def`.)
- ~~`attach-remote-image`~~ — **PROMOTED to Ready** with the URL/ImageDef pair-of-fields recipe.
- `compose-rich-text` — Long-form markdown field with BFM. (See `boxel-flavored-markdown`.)

## Build / Template (planned)

- `build-quote-document` — Quote card with line items, totals, computed taxes.
- `build-invoice-document` — Invoice template with due date, status, line items.
- `build-contract-document` — Contract template with signature blocks + approvals.
- `build-email-campaign` — Mail-merge template with per-recipient variables.
- `build-report-from-query` — Report card that pulls metrics from a query.
- `build-form-with-conditionals` — Form whose sections appear/hide based on prior answers.
- `build-document-with-toc` — Long document card with computed TOC + headings.

## Automate / Compute (planned)

- `automate-backlinks` — `backlinks` fenced block listing inbound references.
- `automate-outlinks` — `outlinks` fenced block.
- `automate-graph-view` — Cross-card graph renderer.
- `automate-tag-rollup` — Aggregate cards by tag with counts.
- `automate-task-rollup` — Pull all open tasks from descendant cards.
- `automate-toc` — Auto-generate table of contents from headings.

## Layout / Surfaces (planned)

- `layout-dashboard` — Canvas with fitted card frames grouped by section.
- `layout-card-gallery` — Grid of fitted frames, click-to-open isolated.
- `layout-comparison-view` — Same card in multiple frames at different sizes.
- `layout-design-review` — Cards at each fitted size for responsive check.
- `layout-moodboard-cross-realm` — Mixed cards from multiple realms on one canvas.
- `layout-brainstorm` — Text + card nodes connected by edges.
- `layout-architecture-diagram` — Component nodes + data-flow edges.
- `layout-timeline` — Date + event entries renderer.
- `show-kanban-from-query` — Status-grouped column view built with one `@context.searchResultsComponent` per kanban column. Lower-friction alternative to `layout-kanban-drag-drop` when drag-and-drop isn't needed; the column queries do the grouping. Extracted as the fallback shape during the 2026-05-22 sales kit.

## Link / Navigate (planned)

- `link-clickable-card` — Make any embedded card clickable to open isolated.
- `link-cross-realm` — Reference cards across realms.
- `link-inline-card-embed` — Inline-embed another card inside markdown.

## Collaborate / Discuss (planned)

- `collab-threaded-comments` — Comment system with replies and mentions.
- `collab-approvals` — Approve/flag/resolve state machine on a card.
- `collab-task-comments` — Comments that double as tracked tasks.
- `collab-agent-annotations` — Agent-authored comments distinguished from human ones.

## Integrate external (planned)

- `integrate-mime-realm-export-import` — Export/import a whole realm as MIME.

## Organize (planned)

- `organize-field-co-location` — `fields/foo/{components,util,modifiers}/*` layout.
- `organize-canvas-modifier-with-fingerprinting` — DOM modifier that rebuilds only when input fingerprint changes.
- `polymorphic-card-subclass` — CardDef hierarchy (base + N subclasses) where each subclass instance has its own URL and `adoptsFrom` discriminates the type. Different from FieldDef polymorphism (`polymorphic-field-subclass`, which mutates a field slot at runtime). Common shape for typed activity feeds, review variants, clause variants. Identified during the 2026-05-22 legal kit when `polymorphic-field-subclass` didn't match the CardDef case.

## Make Command (planned)

- `command-ad-hoc-creation` — Author a brand-new Command on the fly via `CreateCard(adoptsFrom: Command)`.
- `command-realm-search-and-transform` — Query a realm then transform results in batches.
- `command-confirmable-action` — Command that requires user approval before executing.
