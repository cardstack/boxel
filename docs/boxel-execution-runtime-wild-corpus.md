# Boxel execution runtime: real-card URL smoke matrix

## What this matrix is

This is the URL-first compatibility lane for the execution runtime. It uses 50
persisted cards from ordinary CTSE workspaces—not synthetic GTS fixtures and
not the Sandbox Compatibility Corpus. Each row compares the same card and data
through two Hosts:

- **Staging** is the current product reference.
- **Localhost** is this branch, connected to the same staging realm server.

The executable source of truth is
[`execution-runtime-wild-corpus.mjs`](../packages/host/scripts/execution-runtime-wild-corpus.mjs).
The runner can consume the matrix directly, so this document and automated
smoke input cannot quietly become different lists.

## Skeptical visual acceptance plan

This lane starts from the assumption that an iframe-based Boxel runtime is
_not_ compatible merely because an iframe paints. A successful render is the
first checkpoint, not the verdict. The candidate is acceptable only when the
same persisted card can complete the same visible user journey as the staging
Host while the Host-side Loader tripwire remains intact.

Every comparison uses the staging and candidate URLs from the same matrix row,
the same account, and the same staging realm data. A result is recorded as a
pass only from visible browser evidence or an interaction result obtained
through the real DOM/event path. Text found in prerendered HTML is not evidence
that the Sandbox child booted, and the presence of an iframe is not evidence
that its controls, navigation, persistence, or teardown work.

### The two-session rule

Each selected journey runs twice:

1. **Cold:** open the URL in a fresh Host application instance. This proves
   pre-Loader classification, child bootstrap, document materialization, and
   first paint.
2. **Warm:** navigate to the URL after at least one unrelated authored card
   and one card with a shared transitive dependency. This proves that ordinary
   application use cannot let a legacy Host Loader path win the admission race.

A cold pass and warm failure is a release failure. Reloading the page is a
diagnostic, not a workaround.

### Visible gates

| Gate                       | Browser action                                                       | Required evidence                                                                                                                  | Typical matrix cards                             |
| -------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Admission                  | Open cold, then repeat in a contaminated tab                         | No authored module executes in the Host; no `Cannot admit` error; exactly one live child for an isolated Sandbox card              | Recipe Gallery, Tier Maker                       |
| First paint and geometry   | Compare screenshots at the same viewport                             | Same format hierarchy, intrinsic/allocated size, theme, fonts, scoped CSS, and host chrome; no prerender-only false positive       | Architecture Thesis, Airline, Tribeca dashboards |
| Query projection           | Wait for real results, then act on one                               | Result count/content matches staging and the selected result remains usable                                                        | Recipe Gallery, Coffee Shop Dashboard            |
| Stack navigation           | Click a related or query result                                      | The same card opens in the same stack position as staging; Back/Close restores the prior card                                      | Recipe Gallery, Signet                           |
| Local interaction          | Toggle controls without saving                                       | Pressed state, labels, undo state, focus, and keyboard behavior match staging inside the live child                                | Tier Maker, keyboard surface                     |
| Drag and drop              | Move one item, undo, restore                                         | Pointer/keyboard drag changes the intended slot, Undo restores it, and no Host DOM outside the allocated slot changes              | Tier Maker, poster/canvas boards                 |
| Edit transition            | Enter Edit from a live Sandbox card                                  | No rematerialization error; default or authored editor has the same fields and values as staging                                   | Nested Field Host, Tier Maker, Release           |
| Text entry and persistence | Change a reversible field, wait for save, reload, then restore       | Child-to-Host write is authorized, acknowledged, survives reload, and restoring the original value also persists                   | Nested Field Host, invoice/deal forms            |
| Nested composition         | Open and edit values several relationships deep                      | Card/Field/File descendants, trusted Base fields, and authored descendants preserve identity and format through every boundary     | Release, Airline, clinical cards                 |
| Images and resources       | Inspect all visible images before and after interaction              | Non-zero natural dimensions, stable URLs, no delayed replacement with a broken asset                                               | Tier Maker, Poster Board, format preview         |
| Rich content               | Scroll, follow an internal link, inspect embeds                      | Markdown, Mermaid, tables, Guide/Annotation, fitted prerendered HTML, and internal navigation match staging                        | Architecture Thesis, Rich Markdown               |
| Media/browser APIs         | Start, observe progress, pause, resume                               | A user gesture reaches the child, playback state advances, teardown stops the resource, and reopening works                        | Track, MIDI/FileDef, 3D                          |
| Recovery and teardown      | Rapidly switch cards/formats and return                              | No closed client, stale generation, duplicate iframe, leaked audio/canvas, or lost scroll/focus                                    | Track, Poster Board, Recipe Gallery              |
| Code mode metadata         | Open Schema, Preview, and Spec without loading authored code in Host | Header/type/fields/formats come through the document or child message channel; Preview uses the classified tier before first paint | capability probe, real authored card             |

For each gate the runner or tester records: staging URL, candidate URL, cold or
warm session, execution mode, iframe count, visible assertion, action performed,
post-action assertion, screenshot when geometry matters, and the first causal
error. A failure is assigned to admission, transport, semantic projection,
rendering, capability/navigation, mutation, or lifecycle ownership before any
fix is attempted. Expectations are not weakened to match the candidate.

### Current skeptical findings (2026-08-28)

The candidate is currently **not review-ready**. Initial manual comparison has
already falsified three important compatibility assumptions:

| Journey                                           | Staging                                                                          | Candidate                                                                                                                                                                                                                                       | Finding                                                                                                  |
| ------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Recipe Gallery, cold query render                 | Eight query-backed recipes render                                                | Eight recipes render in one Sandbox child                                                                                                                                                                                                       | Query projection and cold first paint can work                                                           |
| Workspace, click Open Recipe Gallery              | Opens `RecipeGallery/home` as the next stack card                                | The child initially rendered but Base's ordinary `CardCrudFunctionsContextName` was absent, so the button silently did nothing. The child now receives a gesture-scoped `viewCard` request capability; authenticated visual re-test is pending. | Root Card API navigation is a protocol gate, not only nested-card modifier behavior                      |
| Recipe Gallery, click Banana Bread                | Opens `RecipeFlow/banana-bread` as the next stack card                           | Pending after the same root Card API repair                                                                                                                                                                                                     | Must prove a second recursive child→Host→child stack transition, not just one successful open            |
| Recipe Gallery after unrelated cards              | Renders normally                                                                 | `Cannot admit ... realm-script-tool-v3 ... after the Host Loader has already loaded it`                                                                                                                                                         | Pre-Loader admission is not yet universal across a normal session                                        |
| Tier Maker, cold isolated view                    | Twenty ranked images and controls render                                         | Twenty healthy images render; tile-size toggle works after a slow handoff                                                                                                                                                                       | Basic DOM events and private image delivery can work in the child                                        |
| Tier Maker, enter Edit                            | Forty-three controls render                                                      | The released-handle failure is patched by retaining the Sandbox process/instance across isolated↔edit; authenticated browser re-test is pending                                                                                                 | Not cleared until field count, entry, save, reload, and return all pass                                  |
| Nested Field Host, enter Edit                     | Seven controls include all nested address values                                 | The retained iframe now reaches seven controls without the released-handle error; permissions propagation, text entry, save, reload, and restore still need an authenticated re-test                                                            | Lifecycle repair is promising but this gate remains red                                                  |
| Document-first child write with a foreign root ID | Rejects before mutation or persistence                                           | A focused regression initially showed the proposal was silently normalized to the authorized root ID                                                                                                                                            | Repaired with explicit root-identity rejection before relationship constraint/PATCH; focused test passes |
| Architecture Thesis, staging reference            | Rich table/list content scrolls 461px within the card without moving Host chrome | Candidate re-test blocked by the invalidated local login                                                                                                                                                                                        | Reference captured; candidate gate remains red, not skipped                                              |
| Release edit, staging reference                   | 38 inputs, 3 textareas, 3,861px edit body; verified 900px inner scroll           | Candidate re-test blocked by the invalidated local login                                                                                                                                                                                        | Reference captured; candidate must match controls and scroll before clearance                            |

These are hard gates. Focused regressions currently pass for fitted prerender
geometry and bounded document-first writes, but that is not browser parity.
The matrix remains red until the same journeys pass cold and warm in the
authenticated local Host. Rebuilding the local Host invalidated its browser
login during this run; that environment interruption is recorded as a blocked
candidate observation, never converted into a pass.

## Freshness and selection rule

The matrix was rebuilt from the current `~/boxel-workspaces` staging mirror on
2026-08-10. Selection excluded `.boxel-history`, the synthetic compatibility
realm, deleted realm mirrors, and stale UUIDs. Every row was checked to have:

1. a current persisted JSON instance;
2. an `adoptsFrom` that resolves to a current non-history GTS module, or to
   trusted Base;
3. a live staging URL returning HTTP 200; and
4. a distinct execution-runtime behavior worth preserving.

“Newest” means the instance and module present in the current mirror. File
mtimes are sync times, not reliable authoring dates, so the matrix does not
claim chronological freshness from mtimes. When a realm has versioned
experiments, the stable named instance is preferred; a UUID is retained only
when it is the current persisted example for that module.

## The 50 URL pairs

|   # | Area               | Case                          | Staging reference                                                                                                                                             | Local branch                                                                                                                                                                | What it exercises                                                   |
| --: | ------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
|   1 | formats            | `format-preview-news`         | [staging](https://realms-staging.stack.cards/ctse/electoral-rooster/FormatPreview/news-preview)                                                               | [localhost](https://host.codex-execution-runtime.localhost/ctse/electoral-rooster/FormatPreview/news-preview)                                                               | all card formats delegated through one real preview card            |
|   2 | formats            | `view-transitions`            | [staging](https://realms-staging.stack.cards/ctse/ivory-foreshore/ViewTransitionsDemo/0aeb0691-fdc5-4270-8974-e21fa6a3fbbf)                                   | [localhost](https://host.codex-execution-runtime.localhost/ctse/ivory-foreshore/ViewTransitionsDemo/0aeb0691-fdc5-4270-8974-e21fa6a3fbbf)                                   | view-transition groups, animation state, and authored CSS           |
|   3 | formats            | `filedef-design-board`        | [staging](https://realms-staging.stack.cards/ctse/filedef-format-research/design-board)                                                                       | [localhost](https://host.codex-execution-runtime.localhost/ctse/filedef-format-research/design-board)                                                                       | FileDef rendering, embedded files, and a design-board composition   |
|   4 | formats            | `filedef-embedding-guide`     | [staging](https://realms-staging.stack.cards/ctse/filedef-format-research/file-embedding-field-guide)                                                         | [localhost](https://host.codex-execution-runtime.localhost/ctse/filedef-format-research/file-embedding-field-guide)                                                         | nested file fields and embedded-file projection                     |
|   5 | media              | `filedef-audio`               | [staging](https://realms-staging.stack.cards/ctse/filedef-format-research/live/live-master-take-3)                                                            | [localhost](https://host.codex-execution-runtime.localhost/ctse/filedef-format-research/live/live-master-take-3)                                                            | audio FileDef loading and media controls                            |
|   6 | rich content       | `rich-markdown`               | [staging](https://realms-staging.stack.cards/ctse/integral-wolverine/RichMarkdown/63218668-c5d3-4d0d-985e-8f8214e01cb9)                                       | [localhost](https://host.codex-execution-runtime.localhost/ctse/integral-wolverine/RichMarkdown/63218668-c5d3-4d0d-985e-8f8214e01cb9)                                       | rich markdown, Mermaid, links, images, and edit projection          |
|   7 | rich content       | `rich-document`               | [staging](https://realms-staging.stack.cards/ctse/full-meerkat/RichDocument/showcase)                                                                         | [localhost](https://host.codex-execution-runtime.localhost/ctse/full-meerkat/RichDocument/showcase)                                                                         | rich document layout, nested blocks, and code-backed content        |
|   8 | rich content       | `embedded-rich-markdown`      | [staging](https://realms-staging.stack.cards/ctse/striped-firefly/EmbeddedFieldRichMarkdown/082a18e7-5158-480f-a9b5-ba85a1db7c2a)                             | [localhost](https://host.codex-execution-runtime.localhost/ctse/striped-firefly/EmbeddedFieldRichMarkdown/082a18e7-5158-480f-a9b5-ba85a1db7c2a)                             | embedded markdown across nested component and field boundaries      |
|   9 | clinical           | `clinical-study-site`         | [staging](https://realms-staging.stack.cards/ctse/middle-wolverine/Clinical/StudySite/stdy-301-site-001-onpace)                                               | [localhost](https://host.codex-execution-runtime.localhost/ctse/middle-wolverine/Clinical/StudySite/stdy-301-site-001-onpace)                                               | clinical relationships, BXL/computeVia output, and themed status    |
|  10 | clinical           | `hospital-operations`         | [staging](https://realms-staging.stack.cards/ctse/working-loon/Hospital/HospitalOperations/st-aurelius-medical-center)                                        | [localhost](https://host.codex-execution-runtime.localhost/ctse/working-loon/Hospital/HospitalOperations/st-aurelius-medical-center)                                        | hospital dashboard composition over patients and staff              |
|  11 | clinical           | `hospital-patient`            | [staging](https://realms-staging.stack.cards/ctse/working-loon/Hospital/HospitalPatient/sun-li-park)                                                          | [localhost](https://host.codex-execution-runtime.localhost/ctse/working-loon/Hospital/HospitalPatient/sun-li-park)                                                          | nested clinical values, medication lists, and patient presentation  |
|  12 | clinical           | `hospital-staff`              | [staging](https://realms-staging.stack.cards/ctse/working-loon/Hospital/HospitalStaff/dr-amara-osei)                                                          | [localhost](https://host.codex-execution-runtime.localhost/ctse/working-loon/Hospital/HospitalStaff/dr-amara-osei)                                                          | staff fields, enums, dates, and relationship projection             |
|  13 | rich content       | `bpm-architecture-thesis`     | [staging](https://realms-staging.stack.cards/ctse/bpm-architecture/ArchitectureDoc/01-thesis)                                                                 | [localhost](https://host.codex-execution-runtime.localhost/ctse/bpm-architecture/ArchitectureDoc/01-thesis)                                                                 | rich document table, typography, and Sandbox presentation           |
|  14 | Tribeca Prep       | `classroom-workflow`          | [staging](https://realms-staging.stack.cards/ctse/voluntary-llama/ClassroomWorkflowDashboard/classroom-2a)                                                    | [localhost](https://host.codex-execution-runtime.localhost/ctse/voluntary-llama/ClassroomWorkflowDashboard/classroom-2a)                                                    | classroom workflow, lists, controls, and dense status UI            |
|  15 | Tribeca Prep       | `head-of-school-dashboard`    | [staging](https://realms-staging.stack.cards/ctse/early-swift/HeadOfSchoolDashboardMockup/main)                                                               | [localhost](https://host.codex-execution-runtime.localhost/ctse/early-swift/HeadOfSchoolDashboardMockup/main)                                                               | school-wide dashboard composition and responsive layout             |
|  16 | Tribeca Prep       | `hero-classroom-dashboard`    | [staging](https://realms-staging.stack.cards/ctse/early-swift/HeroClassroomDashboardMockup/main)                                                              | [localhost](https://host.codex-execution-runtime.localhost/ctse/early-swift/HeroClassroomDashboardMockup/main)                                                              | classroom hero dashboard, cards, controls, and images               |
|  17 | dashboards         | `daily-briefing-dashboard`    | [staging](https://realms-staging.stack.cards/ctse/proper-cuckoo/Dashboard/daily-briefing)                                                                     | [localhost](https://host.codex-execution-runtime.localhost/ctse/proper-cuckoo/Dashboard/daily-briefing)                                                                     | production dashboard composed from boards and report data           |
|  18 | 3D                 | `tribeca-sign-maker`          | [staging](https://realms-staging.stack.cards/ctse/coherent-crocodile/tribeca-prep-sign)                                                                       | [localhost](https://host.codex-execution-runtime.localhost/ctse/coherent-crocodile/tribeca-prep-sign)                                                                       | Three.js/3MF, canvas, browser APIs, and intrinsic height            |
|  19 | 3D                 | `tribeca-logo-cube`           | [staging](https://realms-staging.stack.cards/ctse/coherent-crocodile/logo-cube-maker)                                                                         | [localhost](https://host.codex-execution-runtime.localhost/ctse/coherent-crocodile/logo-cube-maker)                                                                         | 3D source card with editable parameters and media output            |
|  20 | 3D                 | `gltf-chair`                  | [staging](https://realms-staging.stack.cards/ctse/nova-enclave/3-d-model-viewer-cb85e6c3-8e70-4b5e-8ceb-bc8b6cee20fd/3d-model-viewer/GltfViewer/modern-chair) | [localhost](https://host.codex-execution-runtime.localhost/ctse/nova-enclave/3-d-model-viewer-cb85e6c3-8e70-4b5e-8ceb-bc8b6cee20fd/3d-model-viewer/GltfViewer/modern-chair) | nested imported GLTF viewer and allocated canvas rendering          |
|  21 | 3D                 | `gltf-viewer`                 | [staging](https://realms-staging.stack.cards/ctse/frostbay-haven/GltfViewer/9e6492ee-343b-492a-8745-a7ee4bddd677)                                             | [localhost](https://host.codex-execution-runtime.localhost/ctse/frostbay-haven/GltfViewer/9e6492ee-343b-492a-8745-a7ee4bddd677)                                             | a second independent GLTF implementation and asset path             |
|  22 | music              | `live-music-coder`            | [staging](https://realms-staging.stack.cards/ctse/frostbay-haven/LiveMusicCoder/b294e0bc-c042-4dab-b477-37a3a4fb1557)                                         | [localhost](https://host.codex-execution-runtime.localhost/ctse/frostbay-haven/LiveMusicCoder/b294e0bc-c042-4dab-b477-37a3a4fb1557)                                         | live audio graph, editor state, and playback interaction            |
|  23 | music              | `music-coder`                 | [staging](https://realms-staging.stack.cards/ctse/frostbay-haven/MusicCoder/e3e86660-a2be-4b5d-bcd0-b294e0bcc042)                                             | [localhost](https://host.codex-execution-runtime.localhost/ctse/frostbay-haven/MusicCoder/e3e86660-a2be-4b5d-bcd0-b294e0bcc042)                                             | music composition state and browser audio APIs                      |
|  24 | music              | `kpop-musical`                | [staging](https://realms-staging.stack.cards/ctse/personal/KPopDemonHunterMusical/c797808d-15eb-4a8c-bd7a-0f61dbbac88c)                                       | [localhost](https://host.codex-execution-runtime.localhost/ctse/personal/KPopDemonHunterMusical/c797808d-15eb-4a8c-bd7a-0f61dbbac88c)                                       | nested cast and musical-number composition                          |
|  25 | music              | `music-library`               | [staging](https://realms-staging.stack.cards/ctse/persistent-possum/MusicLibraryMockup/demo)                                                                  | [localhost](https://host.codex-execution-runtime.localhost/ctse/persistent-possum/MusicLibraryMockup/demo)                                                                  | surface-based library, player layout, selection, and scrolling      |
|  26 | queries            | `assistant-recipe-gallery`    | [staging](https://realms-staging.stack.cards/ctse/assistant-realm-runner-poc/RecipeGallery/home)                                                              | [localhost](https://host.codex-execution-runtime.localhost/ctse/assistant-realm-runner-poc/RecipeGallery/home)                                                              | query-backed gallery and linked recipe cards                        |
|  27 | async              | `assistant-run`               | [staging](https://realms-staging.stack.cards/ctse/assistant-realm-runner-poc/AssistantRun/5b0c9ccb-80a7-40ba-a869-7212e25345a9)                               | [localhost](https://host.codex-execution-runtime.localhost/ctse/assistant-realm-runner-poc/AssistantRun/5b0c9ccb-80a7-40ba-a869-7212e25345a9)                               | Host tools, progress, and long-running assistant state              |
|  28 | interaction        | `surface-keyboard-navigation` | [staging](https://realms-staging.stack.cards/ctse/persistent-possum/KeyboardSurfaceNavigation/demo)                                                           | [localhost](https://host.codex-execution-runtime.localhost/ctse/persistent-possum/KeyboardSurfaceNavigation/demo)                                                           | focus ladder, keyboard traversal, and selection                     |
|  29 | composition        | `surface-combinatorial`       | [staging](https://realms-staging.stack.cards/ctse/persistent-possum/CombinatorialWorkspace/demo)                                                              | [localhost](https://host.codex-execution-runtime.localhost/ctse/persistent-possum/CombinatorialWorkspace/demo)                                                              | recursively nested Surface types and stable paths                   |
|  30 | interaction        | `tier-fast-food`              | [staging](https://realms-staging.stack.cards/ctse/tier-maker/TierList/national-fast-food-ranking)                                                             | [localhost](https://host.codex-execution-runtime.localhost/ctse/tier-maker/TierList/national-fast-food-ranking)                                                             | drag/drop, twenty private images, and edit-return continuity        |
|  31 | queries            | `coffee-shop-dashboard`       | [staging](https://realms-staging.stack.cards/ctse/mythic-alcove/coffee-shop/CoffeeShopDashboard/main-dashboard)                                               | [localhost](https://host.codex-execution-runtime.localhost/ctse/mythic-alcove/coffee-shop/CoffeeShopDashboard/main-dashboard)                                               | query/list results, orders, customers, menu items, and actions      |
|  32 | computed           | `airline-international`       | [staging](https://realms-staging.stack.cards/ctse/middle-wolverine/Airline/AirlineFlight/aa4500-ord-lhr)                                                      | [localhost](https://host.codex-execution-runtime.localhost/ctse/middle-wolverine/Airline/AirlineFlight/aa4500-ord-lhr)                                                      | deep computeVia/BXL graph, currency, percentages, and theme         |
|  33 | forms              | `invoice-billing`             | [staging](https://realms-staging.stack.cards/ctse/software-periodic-workspace/InvoiceBillingForm/inv-2081)                                                    | [localhost](https://host.codex-execution-runtime.localhost/ctse/software-periodic-workspace/InvoiceBillingForm/inv-2081)                                                    | nested Base fields, configuration, currency, validation, and writes |
|  34 | forms              | `deal-intake`                 | [staging](https://realms-staging.stack.cards/ctse/software-periodic-workspace/DealIntakeForm/daybreak-wholesale)                                              | [localhost](https://host.codex-execution-runtime.localhost/ctse/software-periodic-workspace/DealIntakeForm/daybreak-wholesale)                                              | writable form, validation, enum, currency, and relationships        |
|  35 | Base fields        | `currency-field-demo`         | [staging](https://realms-staging.stack.cards/ctse/software-periodic-workspace/CurrencyDemo/041-currency)                                                      | [localhost](https://host.codex-execution-runtime.localhost/ctse/software-periodic-workspace/CurrencyDemo/041-currency)                                                      | compound CurrencyField projection and formatting                    |
|  36 | Base fields        | `enum-field-demo`             | [staging](https://realms-staging.stack.cards/ctse/software-periodic-workspace/EnumDemo/049-enum)                                                              | [localhost](https://host.codex-execution-runtime.localhost/ctse/software-periodic-workspace/EnumDemo/049-enum)                                                              | enum and FieldConfiguration semantics                               |
|  37 | surfaces           | `surface-canvas-board`        | [staging](https://realms-staging.stack.cards/ctse/persistent-possum/CanvasBoard/scratch)                                                                      | [localhost](https://host.codex-execution-runtime.localhost/ctse/persistent-possum/CanvasBoard/scratch)                                                                      | pan/zoom, positioned nodes, edges, and pointer interaction          |
|  38 | surfaces           | `surface-basic-layout`        | [staging](https://realms-staging.stack.cards/ctse/persistent-possum/BasicLayout/airline)                                                                      | [localhost](https://host.codex-execution-runtime.localhost/ctse/persistent-possum/BasicLayout/airline)                                                                      | deep Surface layout/grid/flow composition                           |
|  39 | surfaces           | `surface-spreadsheet`         | [staging](https://realms-staging.stack.cards/ctse/persistent-possum/SpreadsheetMockup/demo)                                                                   | [localhost](https://host.codex-execution-runtime.localhost/ctse/persistent-possum/SpreadsheetMockup/demo)                                                                   | Surface grid cells, values, and keyboard navigation                 |
|  40 | surfaces           | `poster-board`                | [staging](https://realms-staging.stack.cards/ctse/loyal-chicken/PosterBoardDemo/demo)                                                                         | [localhost](https://host.codex-execution-runtime.localhost/ctse/loyal-chicken/PosterBoardDemo/demo)                                                                         | poster frames, x/y/w/h layout, and pointer interaction              |
|  41 | spreadsheets       | `spreadsheet`                 | [staging](https://realms-staging.stack.cards/ctse/disturbing-cephalopod/Spreadsheet/sample-quarterly-sales)                                                   | [localhost](https://host.codex-execution-runtime.localhost/ctse/disturbing-cephalopod/Spreadsheet/sample-quarterly-sales)                                                   | editing, formulas, grouping, keyboard input, and scrolling          |
|  42 | dashboards         | `northwind-dashboard`         | [staging](https://realms-staging.stack.cards/ctse/annual-cicada/NorthwindDashboard/main)                                                                      | [localhost](https://host.codex-execution-runtime.localhost/ctse/annual-cicada/NorthwindDashboard/main)                                                                      | queries, charts, large business data, and responsive CSS            |
|  43 | dashboards         | `sales-dashboard`             | [staging](https://realms-staging.stack.cards/ctse/petal-promenade/SalesDashboard/my-dashboard)                                                                | [localhost](https://host.codex-execution-runtime.localhost/ctse/petal-promenade/SalesDashboard/my-dashboard)                                                                | lead/contact relationships, metrics, and nested sections            |
|  44 | dashboards         | `analytics-dashboard`         | [staging](https://realms-staging.stack.cards/ctse/full-meerkat/SampleCard/AnalyticsDashboard/monthly-revenue)                                                 | [localhost](https://host.codex-execution-runtime.localhost/ctse/full-meerkat/SampleCard/AnalyticsDashboard/monthly-revenue)                                                 | charts, metrics, responsive CSS, and inherited sample cards         |
|  45 | dense layout       | `integrated-layer-atlas`      | [staging](https://realms-staging.stack.cards/ctse/software-periodic-workspace/IntegratedLayerAtlas/home)                                                      | [localhost](https://host.codex-execution-runtime.localhost/ctse/software-periodic-workspace/IntegratedLayerAtlas/home)                                                      | wide matrix, grouped rows, nested fields, and theme                 |
|  46 | dense layout       | `operations-grid`             | [staging](https://realms-staging.stack.cards/ctse/software-periodic-workspace/GridDemo/operations-grid)                                                       | [localhost](https://host.codex-execution-runtime.localhost/ctse/software-periodic-workspace/GridDemo/operations-grid)                                                       | dense table/grid presentation and repeated cells                    |
|  47 | theme              | `joinery-brand-guide`         | [staging](https://realms-staging.stack.cards/ctse/north-branch-joinery/BrandGuide/north-branch-brand-guide)                                                   | [localhost](https://host.codex-execution-runtime.localhost/ctse/north-branch-joinery/BrandGuide/north-branch-brand-guide)                                                   | trusted Base BrandGuide, cardInfo theme, and many images            |
|  48 | theme              | `joinery-home`                | [staging](https://realms-staging.stack.cards/ctse/north-branch-joinery/north-branch-home)                                                                     | [localhost](https://host.codex-execution-runtime.localhost/ctse/north-branch-joinery/north-branch-home)                                                                     | workspace composition over an image and relationship graph          |
|  49 | trusted components | `card-frame-catalog`          | [staging](https://realms-staging.stack.cards/ctse/prepared-asp/CardFrameDesignSystem/catalog)                                                                 | [localhost](https://host.codex-execution-runtime.localhost/ctse/prepared-asp/CardFrameDesignSystem/catalog)                                                                 | trusted CardFrame components and dense nested examples              |
|  50 | trusted components | `adorn-showcase`              | [staging](https://realms-staging.stack.cards/ctse/prepared-asp/AdornExamples/showcase)                                                                        | [localhost](https://host.codex-execution-runtime.localhost/ctse/prepared-asp/AdornExamples/showcase)                                                                        | trusted layout/adornment modules and nested presentation            |

## What a smoke pass compares

The lane does not merely check for a card-shaped rectangle. For each URL pair
it records:

| Plane       | Evidence                                                                                                                     |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Semantic    | visible staging signature; query/relationship output; computed and formatted values                                          |
| Rendering   | non-empty authored content; formats; scoped Host chrome; images; controls                                                    |
| Execution   | selected Direct/Sandbox tier; Sandbox handoff; no lifecycle error                                                            |
| Interaction | text entry, scrolling, drag/drop, focus, media, or edit/return where the row calls for it                                    |
| Performance | cold readiness and Sandbox interactive handoff; warm timing can be added without changing the corpus                         |
| Diagnosis   | reference drift, environment/auth gate, semantic projection gap, render adapter gap, capability gap, or lifecycle regression |

The first successful local run records the selected execution tier. Until
then, `expectedExecution: 'discover'` is explicit; the matrix does not invent a
passing tier from source inspection.

## FileTwin format lane

The broad 50-card matrix is supplemented by a tighter FileDef lane in
[`execution-runtime-file-twin-corpus.mjs`](../packages/host/scripts/execution-runtime-file-twin-corpus.mjs).
It contains all 27 persisted twins under `filedef-format-research/fixtures`,
plus 17 live-capability cases covering every FileDef adapter in that realm.
Unlike the broad lane, every row explicitly expects Sandbox execution: the
point is to exercise one authored FileTwin graph against very different
resource and renderer boundaries.

The lane covers 14 families—JSON/card data, PDF, ZIP, SVG/JPEG/GIF images,
GLB, TypeScript/GTS, DOCX/PPTX/XLSX, MP3/M4A, opaque binary, Markdown/text,
variable fonts, MP4, CSV, and generic unsupported data—plus normal, empty,
failed, generating, malformed, queued/loading, stale, and unsupported states.
DOM requirements are part of the manifest where they are meaningful: PDF and
GLB must produce canvases; audio and video must produce native media elements;
images must decode; and structured CSV/XLSX output must retain tables.

Run this lane with the same browser runner:

```js
let smoke =
  await import('./packages/host/scripts/execution-runtime-browser-smoke.mjs');
let fileTwins =
  await import('/Users/chris/Projects/boxel/packages/host/scripts/execution-runtime-file-twin-corpus.mjs');
let result = await smoke.runExecutionRuntimeBrowserSmoke({
  browser,
  candidateOrigin: 'https://host.codex-execution-runtime.localhost',
  cases: fileTwins.executionRuntimeFileResearchCases,
  continueOnReferenceDrift: true,
});
let matrix = smoke.summarizeExecutionRuntimeSmokeRun(result);
```

### Current FileTwin evidence

- All 27 staging and local twins, plus all 17 live adapters, were compared
  sequentially against the same persisted card data. The run keeps one browser
  tab and never starts more than one media resource at a time.
- The Sandbox resource projection now loads non-module resources through an
  exact, GET-only, size-bounded capability. PDF and GLB no longer travel
  through the executable module broker.
- PDF paging, decoded JPEG dimensions, and interactive GLB canvas/orbit UI
  were checked after the transport repair.
- PDF, ZIP, GLB, MP3, M4A, MP4, binary, and MIDI prove that a scalar
  `resourceUrl` crosses as one exact, authenticated, non-executable
  capability. SVG, JPEG, GIF, Markdown, CSV, JSON, TS, GTS, and text exercise
  the parallel relationship-backed projection path.
- The live MIDI case further proves that the projected 111,434 bytes parse
  into 14 musical tracks / 10,681 notes, Play becomes enabled, and the Web
  Audio playback clock advances inside the Sandbox.
- Canonical Library navigation reaches the DOCX, PPTX, and WOFF2 Sandbox
  renderers successfully. Their persisted fixture cards have null JSON:API
  IDs, so a guessed `/fixtures/...` route is not a valid substitute for this
  navigation test.
- The Library-level cross-check showed all 20 representative file names on
  both staging and the staging-backed local Host with no alert panels.
- The 24 non-data-error persisted twins reach their expected substantive
  presentation.
- The authored `DataFilePreview` modifier was repaired on 2026-08-11 by
  deferring tracked loading state until `afterRender` and cancelling scheduled
  or asynchronous work on teardown. A targeted authenticated check now renders
  `q4-revenue` as an interactive eight-column Sandbox grid on both the candidate
  Host and direct staging, with no last-known-good alert. `model-2026` and
  `state-malformed-export` still require a matrix rerun before their incomplete
  handoff rows can be cleared; the execution runtime continues to preserve
  Glimmer's same-computation assertion rather than suppress it.

## Run it

Use the existing browser smoke runner with this single matrix:

```js
let smoke =
  await import('/Users/chris/Projects/boxel/packages/host/scripts/execution-runtime-browser-smoke.mjs');
let wild =
  await import('./packages/host/scripts/execution-runtime-wild-corpus.mjs');
let result = await smoke.runExecutionRuntimeBrowserSmoke({
  browser,
  candidateOrigin: 'https://host.codex-execution-runtime.localhost',
  cases: wild.executionRuntimeWildCorpusCases,
  continueOnReferenceDrift: true,
});
let matrix = smoke.summarizeExecutionRuntimeSmokeRun(result);
```

The candidate origin is deliberately centralized in the executable matrix. If
the staging-backed local Host moves to another port, change that origin once;
the 50 card paths remain identical.

## Current evidence

- All 50 persisted instances and their current source modules were found in
  the workspace mirror.
- All 50 staging reference URLs returned HTTP 200 on 2026-08-10.
- The executable manifest validation and its six Node smoke-runner tests pass.
- A targeted authenticated Img-to-3D check on 2026-08-11 passed the Studio's
  current model, both history rounds, and a standalone `SculptedModel` on the
  candidate Host and direct staging. Protected model source returned `200`/`304`
  through the outer resource capability and the inline viewer no longer made a
  credentialless nested request that returned `401`. This authored-realm repair
  is evidence for the matrix case, not a substitute for the full batch.
- A full signed-in staging-versus-local browser comparison of this refreshed
  batch has **not** yet been claimed. The matrix is the input for that next
  run, and its failures should become reusable protocol tests rather than
  card-specific exceptions.

### Authenticated 15-card readiness sample — 2026-08-12

The first signed-in sample used the dedicated staging-backed Host at
`https://host.codex-execution-runtime.localhost`. A row is not called correct
merely because the card shell mounted: its authored semantic signature had to
appear, the selected execution tier had to be observable, and Sandbox rows had
to expose substantive content inside the child document.

| Outcome                          | Cards                                                                                                                                                                                                                                                         | Evidence                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Eventually correct               | `bpm-architecture-thesis`, `format-preview-news`, `assistant-recipe-gallery`, `clinical-study-site`, `airline-international`, `invoice-billing`, `joinery-brand-guide`, `currency-field-demo`, `surface-basic-layout`, `tier-fast-food`, `tribeca-sign-maker` | Earlier three-tier runs produced substantive persisted output. Under the current two-model gate these authored cases must be re-proven in Sandbox; the old Capsule result is historical evidence, not a pass. The sample includes queries, deep BXL/computeVia graphs, nested links, Base fields, private images, and Three.js.               |
| Inconclusive environment failure | `rich-markdown`, `hospital-operations`, `filedef-design-board`, `deal-intake`                                                                                                                                                                                 | Three cards remained in the pre-routing `Loading card` state while the Host recorded staging fetch failures. Rich Markdown retained its readable last-known-good document, but its external ProseMirror bundle fetch from Vercel failed, so interactivity could not be evaluated. No runtime semantic verdict is assigned to these four rows. |

This sample found no new semantic mismatch after readiness completed, but it
did find an unacceptable readiness problem. Clean cards commonly took 68–143
seconds after a full navigation. `invoice-billing` and
`surface-basic-layout` required roughly three minutes before the Sandbox child
became substantive. `tier-fast-food` took 143 seconds and
`tribeca-sign-maker` took 129 seconds. Full navigation also repeatedly rebooted Host/Matrix work,
so the next runner revision must record two timings separately:

1. application/auth readiness, and
2. execution-session routing through substantive trusted Direct or authored Sandbox
   output.

The smoke runner must persist each case as it completes and bound cancellation
per case. A single long in-memory batch can otherwise exceed the browser
control deadline and hide already-collected evidence. Pre-routing network
failure, runtime failure, semantic mismatch, interaction failure, and slow but
eventually correct output are separate statuses; none should be collapsed into
one red/green value.
