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

|   # | Area               | Case                          | Staging reference                                                                                                                                             | Local branch                                                                                                                                        | What it exercises                                                   |
| --: | ------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
|   1 | formats            | `format-preview-news`         | [staging](https://realms-staging.stack.cards/ctse/electoral-rooster/FormatPreview/news-preview)                                                               | [localhost](https://localhost:4200/ctse/electoral-rooster/FormatPreview/news-preview)                                                               | all card formats delegated through one real preview card            |
|   2 | formats            | `view-transitions`            | [staging](https://realms-staging.stack.cards/ctse/ivory-foreshore/ViewTransitionsDemo/0aeb0691-fdc5-4270-8974-e21fa6a3fbbf)                                   | [localhost](https://localhost:4200/ctse/ivory-foreshore/ViewTransitionsDemo/0aeb0691-fdc5-4270-8974-e21fa6a3fbbf)                                   | view-transition groups, animation state, and authored CSS           |
|   3 | formats            | `filedef-design-board`        | [staging](https://realms-staging.stack.cards/ctse/filedef-format-research/design-board)                                                                       | [localhost](https://localhost:4200/ctse/filedef-format-research/design-board)                                                                       | FileDef rendering, embedded files, and a design-board composition   |
|   4 | formats            | `filedef-embedding-guide`     | [staging](https://realms-staging.stack.cards/ctse/filedef-format-research/file-embedding-field-guide)                                                         | [localhost](https://localhost:4200/ctse/filedef-format-research/file-embedding-field-guide)                                                         | nested file fields and embedded-file projection                     |
|   5 | media              | `filedef-audio`               | [staging](https://realms-staging.stack.cards/ctse/filedef-format-research/live/live-master-take-3)                                                            | [localhost](https://localhost:4200/ctse/filedef-format-research/live/live-master-take-3)                                                            | audio FileDef loading and media controls                            |
|   6 | rich content       | `rich-markdown`               | [staging](https://realms-staging.stack.cards/ctse/integral-wolverine/RichMarkdown/63218668-c5d3-4d0d-985e-8f8214e01cb9)                                       | [localhost](https://localhost:4200/ctse/integral-wolverine/RichMarkdown/63218668-c5d3-4d0d-985e-8f8214e01cb9)                                       | rich markdown, Mermaid, links, images, and edit projection          |
|   7 | rich content       | `rich-document`               | [staging](https://realms-staging.stack.cards/ctse/full-meerkat/RichDocument/showcase)                                                                         | [localhost](https://localhost:4200/ctse/full-meerkat/RichDocument/showcase)                                                                         | rich document layout, nested blocks, and code-backed content        |
|   8 | rich content       | `embedded-rich-markdown`      | [staging](https://realms-staging.stack.cards/ctse/striped-firefly/EmbeddedFieldRichMarkdown/082a18e7-5158-480f-a9b5-ba85a1db7c2a)                             | [localhost](https://localhost:4200/ctse/striped-firefly/EmbeddedFieldRichMarkdown/082a18e7-5158-480f-a9b5-ba85a1db7c2a)                             | embedded markdown across nested component and field boundaries      |
|   9 | clinical           | `clinical-study-site`         | [staging](https://realms-staging.stack.cards/ctse/middle-wolverine/Clinical/StudySite/stdy-301-site-001-onpace)                                               | [localhost](https://localhost:4200/ctse/middle-wolverine/Clinical/StudySite/stdy-301-site-001-onpace)                                               | clinical relationships, BXL/computeVia output, and themed status    |
|  10 | clinical           | `hospital-operations`         | [staging](https://realms-staging.stack.cards/ctse/working-loon/Hospital/HospitalOperations/st-aurelius-medical-center)                                        | [localhost](https://localhost:4200/ctse/working-loon/Hospital/HospitalOperations/st-aurelius-medical-center)                                        | hospital dashboard composition over patients and staff              |
|  11 | clinical           | `hospital-patient`            | [staging](https://realms-staging.stack.cards/ctse/working-loon/Hospital/HospitalPatient/sun-li-park)                                                          | [localhost](https://localhost:4200/ctse/working-loon/Hospital/HospitalPatient/sun-li-park)                                                          | nested clinical values, medication lists, and patient presentation  |
|  12 | clinical           | `hospital-staff`              | [staging](https://realms-staging.stack.cards/ctse/working-loon/Hospital/HospitalStaff/dr-amara-osei)                                                          | [localhost](https://localhost:4200/ctse/working-loon/Hospital/HospitalStaff/dr-amara-osei)                                                          | staff fields, enums, dates, and relationship projection             |
|  13 | clinical           | `clinical-study-stress`       | [staging](https://realms-staging.stack.cards/ctse/middle-wolverine/Clinical/StudySite/stdy-301-site-110-stress)                                               | [localhost](https://localhost:4200/ctse/middle-wolverine/Clinical/StudySite/stdy-301-site-110-stress)                                               | the clinical graph through a delayed/adverse-event branch           |
|  14 | Tribeca Prep       | `classroom-workflow`          | [staging](https://realms-staging.stack.cards/ctse/voluntary-llama/ClassroomWorkflowDashboard/classroom-2a)                                                    | [localhost](https://localhost:4200/ctse/voluntary-llama/ClassroomWorkflowDashboard/classroom-2a)                                                    | classroom workflow, lists, controls, and dense status UI            |
|  15 | Tribeca Prep       | `head-of-school-dashboard`    | [staging](https://realms-staging.stack.cards/ctse/early-swift/HeadOfSchoolDashboardMockup/main)                                                               | [localhost](https://localhost:4200/ctse/early-swift/HeadOfSchoolDashboardMockup/main)                                                               | school-wide dashboard composition and responsive layout             |
|  16 | Tribeca Prep       | `hero-classroom-dashboard`    | [staging](https://realms-staging.stack.cards/ctse/early-swift/HeroClassroomDashboardMockup/main)                                                              | [localhost](https://localhost:4200/ctse/early-swift/HeroClassroomDashboardMockup/main)                                                              | classroom hero dashboard, cards, controls, and images               |
|  17 | dashboards         | `daily-briefing-dashboard`    | [staging](https://realms-staging.stack.cards/ctse/proper-cuckoo/Dashboard/daily-briefing)                                                                     | [localhost](https://localhost:4200/ctse/proper-cuckoo/Dashboard/daily-briefing)                                                                     | production dashboard composed from boards and report data           |
|  18 | 3D                 | `tribeca-sign-maker`          | [staging](https://realms-staging.stack.cards/ctse/coherent-crocodile/tribeca-prep-sign)                                                                       | [localhost](https://localhost:4200/ctse/coherent-crocodile/tribeca-prep-sign)                                                                       | Three.js/3MF, canvas, browser APIs, and intrinsic height            |
|  19 | 3D                 | `tribeca-logo-cube`           | [staging](https://realms-staging.stack.cards/ctse/coherent-crocodile/logo-cube-maker)                                                                         | [localhost](https://localhost:4200/ctse/coherent-crocodile/logo-cube-maker)                                                                         | 3D source card with editable parameters and media output            |
|  20 | 3D                 | `gltf-chair`                  | [staging](https://realms-staging.stack.cards/ctse/nova-enclave/3-d-model-viewer-cb85e6c3-8e70-4b5e-8ceb-bc8b6cee20fd/3d-model-viewer/GltfViewer/modern-chair) | [localhost](https://localhost:4200/ctse/nova-enclave/3-d-model-viewer-cb85e6c3-8e70-4b5e-8ceb-bc8b6cee20fd/3d-model-viewer/GltfViewer/modern-chair) | nested imported GLTF viewer and allocated canvas rendering          |
|  21 | 3D                 | `gltf-viewer`                 | [staging](https://realms-staging.stack.cards/ctse/frostbay-haven/GltfViewer/9e6492ee-343b-492a-8745-a7ee4bddd677)                                             | [localhost](https://localhost:4200/ctse/frostbay-haven/GltfViewer/9e6492ee-343b-492a-8745-a7ee4bddd677)                                             | a second independent GLTF implementation and asset path             |
|  22 | music              | `live-music-coder`            | [staging](https://realms-staging.stack.cards/ctse/frostbay-haven/LiveMusicCoder/b294e0bc-c042-4dab-b477-37a3a4fb1557)                                         | [localhost](https://localhost:4200/ctse/frostbay-haven/LiveMusicCoder/b294e0bc-c042-4dab-b477-37a3a4fb1557)                                         | live audio graph, editor state, and playback interaction            |
|  23 | music              | `music-coder`                 | [staging](https://realms-staging.stack.cards/ctse/frostbay-haven/MusicCoder/e3e86660-a2be-4b5d-bcd0-b294e0bcc042)                                             | [localhost](https://localhost:4200/ctse/frostbay-haven/MusicCoder/e3e86660-a2be-4b5d-bcd0-b294e0bcc042)                                             | music composition state and browser audio APIs                      |
|  24 | music              | `kpop-musical`                | [staging](https://realms-staging.stack.cards/ctse/personal/KPopDemonHunterMusical/c797808d-15eb-4a8c-bd7a-0f61dbbac88c)                                       | [localhost](https://localhost:4200/ctse/personal/KPopDemonHunterMusical/c797808d-15eb-4a8c-bd7a-0f61dbbac88c)                                       | nested cast and musical-number composition                          |
|  25 | music              | `music-library`               | [staging](https://realms-staging.stack.cards/ctse/persistent-possum/MusicLibraryMockup/demo)                                                                  | [localhost](https://localhost:4200/ctse/persistent-possum/MusicLibraryMockup/demo)                                                                  | surface-based library, player layout, selection, and scrolling      |
|  26 | queries            | `assistant-recipe-gallery`    | [staging](https://realms-staging.stack.cards/ctse/assistant-realm-runner-poc/RecipeGallery/home)                                                              | [localhost](https://localhost:4200/ctse/assistant-realm-runner-poc/RecipeGallery/home)                                                              | query-backed gallery and linked recipe cards                        |
|  27 | async              | `assistant-run`               | [staging](https://realms-staging.stack.cards/ctse/assistant-realm-runner-poc/AssistantRun/5b0c9ccb-80a7-40ba-a869-7212e25345a9)                               | [localhost](https://localhost:4200/ctse/assistant-realm-runner-poc/AssistantRun/5b0c9ccb-80a7-40ba-a869-7212e25345a9)                               | Host tools, progress, and long-running assistant state              |
|  28 | interaction        | `surface-keyboard-navigation` | [staging](https://realms-staging.stack.cards/ctse/persistent-possum/KeyboardSurfaceNavigation/demo)                                                           | [localhost](https://localhost:4200/ctse/persistent-possum/KeyboardSurfaceNavigation/demo)                                                           | focus ladder, keyboard traversal, and selection                     |
|  29 | composition        | `surface-combinatorial`       | [staging](https://realms-staging.stack.cards/ctse/persistent-possum/CombinatorialWorkspace/demo)                                                              | [localhost](https://localhost:4200/ctse/persistent-possum/CombinatorialWorkspace/demo)                                                              | recursively nested Surface types and stable paths                   |
|  30 | interaction        | `tier-fast-food`              | [staging](https://realms-staging.stack.cards/ctse/tier-maker/TierList/national-fast-food-ranking)                                                             | [localhost](https://localhost:4200/ctse/tier-maker/TierList/national-fast-food-ranking)                                                             | drag/drop, twenty private images, and edit-return continuity        |
|  31 | queries            | `coffee-shop-dashboard`       | [staging](https://realms-staging.stack.cards/ctse/mythic-alcove/coffee-shop/CoffeeShopDashboard/main-dashboard)                                               | [localhost](https://localhost:4200/ctse/mythic-alcove/coffee-shop/CoffeeShopDashboard/main-dashboard)                                               | query/list results, orders, customers, menu items, and actions      |
|  32 | computed           | `airline-international`       | [staging](https://realms-staging.stack.cards/ctse/middle-wolverine/Airline/AirlineFlight/aa4500-ord-lhr)                                                      | [localhost](https://localhost:4200/ctse/middle-wolverine/Airline/AirlineFlight/aa4500-ord-lhr)                                                      | deep computeVia/BXL graph, currency, percentages, and theme         |
|  33 | forms              | `invoice-billing`             | [staging](https://realms-staging.stack.cards/ctse/software-periodic-workspace/InvoiceBillingForm/inv-2081)                                                    | [localhost](https://localhost:4200/ctse/software-periodic-workspace/InvoiceBillingForm/inv-2081)                                                    | nested Base fields, configuration, currency, validation, and writes |
|  34 | forms              | `deal-intake`                 | [staging](https://realms-staging.stack.cards/ctse/software-periodic-workspace/DealIntakeForm/daybreak-wholesale)                                              | [localhost](https://localhost:4200/ctse/software-periodic-workspace/DealIntakeForm/daybreak-wholesale)                                              | writable form, validation, enum, currency, and relationships        |
|  35 | Base fields        | `currency-field-demo`         | [staging](https://realms-staging.stack.cards/ctse/software-periodic-workspace/CurrencyDemo/041-currency)                                                      | [localhost](https://localhost:4200/ctse/software-periodic-workspace/CurrencyDemo/041-currency)                                                      | compound CurrencyField projection and formatting                    |
|  36 | Base fields        | `enum-field-demo`             | [staging](https://realms-staging.stack.cards/ctse/software-periodic-workspace/EnumDemo/049-enum)                                                              | [localhost](https://localhost:4200/ctse/software-periodic-workspace/EnumDemo/049-enum)                                                              | enum and FieldConfiguration semantics                               |
|  37 | surfaces           | `surface-canvas-board`        | [staging](https://realms-staging.stack.cards/ctse/persistent-possum/CanvasBoard/scratch)                                                                      | [localhost](https://localhost:4200/ctse/persistent-possum/CanvasBoard/scratch)                                                                      | pan/zoom, positioned nodes, edges, and pointer interaction          |
|  38 | surfaces           | `surface-basic-layout`        | [staging](https://realms-staging.stack.cards/ctse/persistent-possum/BasicLayout/airline)                                                                      | [localhost](https://localhost:4200/ctse/persistent-possum/BasicLayout/airline)                                                                      | deep Surface layout/grid/flow composition                           |
|  39 | surfaces           | `surface-spreadsheet`         | [staging](https://realms-staging.stack.cards/ctse/persistent-possum/SpreadsheetMockup/demo)                                                                   | [localhost](https://localhost:4200/ctse/persistent-possum/SpreadsheetMockup/demo)                                                                   | Surface grid cells, values, and keyboard navigation                 |
|  40 | surfaces           | `poster-board`                | [staging](https://realms-staging.stack.cards/ctse/loyal-chicken/PosterBoardDemo/demo)                                                                         | [localhost](https://localhost:4200/ctse/loyal-chicken/PosterBoardDemo/demo)                                                                         | poster frames, x/y/w/h layout, and pointer interaction              |
|  41 | spreadsheets       | `spreadsheet`                 | [staging](https://realms-staging.stack.cards/ctse/disturbing-cephalopod/Spreadsheet/sample-quarterly-sales)                                                   | [localhost](https://localhost:4200/ctse/disturbing-cephalopod/Spreadsheet/sample-quarterly-sales)                                                   | editing, formulas, grouping, keyboard input, and scrolling          |
|  42 | dashboards         | `northwind-dashboard`         | [staging](https://realms-staging.stack.cards/ctse/annual-cicada/NorthwindDashboard/main)                                                                      | [localhost](https://localhost:4200/ctse/annual-cicada/NorthwindDashboard/main)                                                                      | queries, charts, large business data, and responsive CSS            |
|  43 | dashboards         | `sales-dashboard`             | [staging](https://realms-staging.stack.cards/ctse/petal-promenade/SalesDashboard/my-dashboard)                                                                | [localhost](https://localhost:4200/ctse/petal-promenade/SalesDashboard/my-dashboard)                                                                | lead/contact relationships, metrics, and nested sections            |
|  44 | dashboards         | `analytics-dashboard`         | [staging](https://realms-staging.stack.cards/ctse/full-meerkat/SampleCard/AnalyticsDashboard/monthly-revenue)                                                 | [localhost](https://localhost:4200/ctse/full-meerkat/SampleCard/AnalyticsDashboard/monthly-revenue)                                                 | charts, metrics, responsive CSS, and inherited sample cards         |
|  45 | dense layout       | `integrated-layer-atlas`      | [staging](https://realms-staging.stack.cards/ctse/software-periodic-workspace/IntegratedLayerAtlas/home)                                                      | [localhost](https://localhost:4200/ctse/software-periodic-workspace/IntegratedLayerAtlas/home)                                                      | wide matrix, grouped rows, nested fields, and theme                 |
|  46 | dense layout       | `operations-grid`             | [staging](https://realms-staging.stack.cards/ctse/software-periodic-workspace/GridDemo/operations-grid)                                                       | [localhost](https://localhost:4200/ctse/software-periodic-workspace/GridDemo/operations-grid)                                                       | dense table/grid presentation and repeated cells                    |
|  47 | theme              | `joinery-brand-guide`         | [staging](https://realms-staging.stack.cards/ctse/north-branch-joinery/BrandGuide/north-branch-brand-guide)                                                   | [localhost](https://localhost:4200/ctse/north-branch-joinery/BrandGuide/north-branch-brand-guide)                                                   | trusted Base BrandGuide, cardInfo theme, and many images            |
|  48 | theme              | `joinery-home`                | [staging](https://realms-staging.stack.cards/ctse/north-branch-joinery/north-branch-home)                                                                     | [localhost](https://localhost:4200/ctse/north-branch-joinery/north-branch-home)                                                                     | workspace composition over an image and relationship graph          |
|  49 | trusted components | `card-frame-catalog`          | [staging](https://realms-staging.stack.cards/ctse/prepared-asp/CardFrameDesignSystem/catalog)                                                                 | [localhost](https://localhost:4200/ctse/prepared-asp/CardFrameDesignSystem/catalog)                                                                 | trusted CardFrame components and dense nested examples              |
|  50 | trusted components | `adorn-showcase`              | [staging](https://realms-staging.stack.cards/ctse/prepared-asp/AdornExamples/showcase)                                                                        | [localhost](https://localhost:4200/ctse/prepared-asp/AdornExamples/showcase)                                                                        | trusted layout/adornment modules and nested presentation            |

## What a smoke pass compares

The lane does not merely check for a card-shaped rectangle. For each URL pair
it records:

| Plane       | Evidence                                                                                                                     |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Semantic    | visible staging signature; query/relationship output; computed and formatted values                                          |
| Rendering   | non-empty authored content; formats; scoped Host chrome; images; controls                                                    |
| Execution   | selected Direct/Capsule/Sandbox tier; Sandbox handoff; no lifecycle error                                                    |
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
  await import('/Users/chris/Projects/boxel/packages/host/scripts/execution-runtime-browser-smoke.mjs');
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
  await import('/Users/chris/Projects/boxel/packages/host/scripts/execution-runtime-wild-corpus.mjs');
let result = await smoke.runExecutionRuntimeBrowserSmoke({
  browser,
  candidateOrigin: 'https://localhost:4200',
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
