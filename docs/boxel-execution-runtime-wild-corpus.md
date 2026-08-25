# Boxel execution runtime: real-card URL smoke matrix

## What this matrix is

The URL-first compatibility lane for the execution runtime. It uses 50
persisted cards from ordinary CTSE workspaces — not synthetic GTS fixtures, and
not the purpose-built compatibility corpus. Each row compares the same card and
the same data through two Hosts:

- **Reference** — the deployed staging Host, which is the product's current
  behavior.
- **Candidate** — a local Host connected to the same staging realm server.

The executable source of truth is
[`execution-runtime-wild-corpus.mts`](../packages/host/scripts/execution-runtime-wild-corpus.mts).
The runner consumes that list directly and the table below is rendered from it,
so this document and the automated smoke input cannot become different lists.

**The corpus validates; it does not drive.** A red card opens a conformance
test against [the rendering protocol](./boxel-rendering-protocol.md) first, and
the fix lands against that test. A card-specific exception in an adapter is
never the fix — if a tier's adapter cannot express a behavior, that is a spec
change, not a special case.

This lane is breadth. The completion gate is the ten-scenario mirror cohort in
[`execution-runtime-mirror-cohort.mts`](../packages/host/scripts/execution-runtime-mirror-cohort.mts);
the staging execution-runtime suite realm and the sandbox-compatibility corpus
realm are exploratory oracles for individual mechanisms. None of the three
replaces the others.

## Selection rule

A row earns its place by satisfying all four of:

1. a current persisted JSON instance;
2. an `adoptsFrom` resolving to a current non-history GTS module, or to trusted
   Base;
3. a live reference URL returning HTTP 200; and
4. an execution-runtime behavior no other row already isolates.

"Current" means present in the workspace mirror. File mtimes are sync times
rather than authoring dates, so the matrix makes no claim about chronological
freshness. Where a realm holds versioned experiments, the stable named instance
is preferred; a UUID is kept only when it is that module's current persisted
example.

Excluded by construction: `.boxel-history`, the synthetic compatibility realm,
deleted realm mirrors, and stale UUIDs.

## The 50 cards

Reference origin: `https://realms-staging.stack.cards`. The candidate origin is
centralized in the manifest — a local Host on a different port is one edit
there, and the 50 card paths are unaffected.

<!-- wild-corpus:begin -->

|   # | Area               | Case                          | Card path                                                                                                          | What it exercises                                                                                 |
| --: | ------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
|   1 | formats            | `format-preview-news`         | `/ctse/electoral-rooster/FormatPreview/news-preview`                                                               | all card formats delegated through one real preview card                                          |
|   2 | formats            | `view-transitions`            | `/ctse/ivory-foreshore/ViewTransitionsDemo/0aeb0691-fdc5-4270-8974-e21fa6a3fbbf`                                   | view-transition groups, animation state, and authored CSS                                         |
|   3 | formats            | `filedef-design-board`        | `/ctse/filedef-format-research/design-board`                                                                       | FileDef rendering, embedded files, and a design-board composition                                 |
|   4 | formats            | `filedef-embedding-guide`     | `/ctse/filedef-format-research/file-embedding-field-guide`                                                         | nested file fields and embedded-file projection                                                   |
|   5 | media              | `filedef-audio`               | `/ctse/filedef-format-research/live/live-master-take-3`                                                            | audio FileDef loading and media controls                                                          |
|   6 | rich-content       | `rich-markdown`               | `/ctse/integral-wolverine/RichMarkdown/63218668-c5d3-4d0d-985e-8f8214e01cb9`                                       | rich markdown, Mermaid, links, images, and edit projection                                        |
|   7 | rich-content       | `rich-document`               | `/ctse/full-meerkat/RichDocument/showcase`                                                                         | rich document layout, nested blocks, and code-backed content                                      |
|   8 | rich-content       | `embedded-rich-markdown`      | `/ctse/striped-firefly/EmbeddedFieldRichMarkdown/082a18e7-5158-480f-a9b5-ba85a1db7c2a`                             | embedded markdown crossing nested component and field boundaries                                  |
|   9 | clinical           | `clinical-study-site`         | `/ctse/middle-wolverine/Clinical/StudySite/stdy-301-site-001-onpace`                                               | clinical relationships, BXL/computeVia output, and themed status                                  |
|  10 | clinical           | `hospital-operations`         | `/ctse/working-loon/Hospital/HospitalOperations/st-aurelius-medical-center`                                        | hospital dashboard composition over patients and staff                                            |
|  11 | clinical           | `hospital-patient`            | `/ctse/working-loon/Hospital/HospitalPatient/sun-li-park`                                                          | nested clinical values, medication lists, and patient presentation                                |
|  12 | clinical           | `hospital-staff`              | `/ctse/working-loon/Hospital/HospitalStaff/dr-amara-osei`                                                          | staff fields, enums, dates, and relationship projection                                           |
|  13 | rich-content       | `bpm-architecture-thesis`     | `/ctse/bpm-architecture/ArchitectureDoc/01-thesis`                                                                 | real-world rich architecture document with a table, typography, and authored Capsule presentation |
|  14 | tribeca-prep       | `classroom-workflow`          | `/ctse/voluntary-llama/ClassroomWorkflowDashboard/classroom-2a`                                                    | classroom workflow, lists, controls, and dense status UI                                          |
|  15 | tribeca-prep       | `head-of-school-dashboard`    | `/ctse/early-swift/HeadOfSchoolDashboardMockup/main`                                                               | school-wide dashboard composition and responsive layout                                           |
|  16 | tribeca-prep       | `hero-classroom-dashboard`    | `/ctse/early-swift/HeroClassroomDashboardMockup/main`                                                              | classroom hero dashboard, cards, controls, and images                                             |
|  17 | dashboards         | `daily-briefing-dashboard`    | `/ctse/proper-cuckoo/Dashboard/daily-briefing`                                                                     | production dashboard composed from boards and report data                                         |
|  18 | 3d                 | `tribeca-sign-maker`          | `/ctse/coherent-crocodile/tribeca-prep-sign`                                                                       | Three.js/3MF, canvas, browser APIs, and intrinsic height                                          |
|  19 | 3d                 | `tribeca-logo-cube`           | `/ctse/coherent-crocodile/logo-cube-maker`                                                                         | 3D source card with editable parameters and media output                                          |
|  20 | 3d                 | `gltf-chair`                  | `/ctse/nova-enclave/3-d-model-viewer-cb85e6c3-8e70-4b5e-8ceb-bc8b6cee20fd/3d-model-viewer/GltfViewer/modern-chair` | nested imported GLTF viewer and allocated canvas rendering                                        |
|  21 | 3d                 | `gltf-viewer`                 | `/ctse/frostbay-haven/GltfViewer/9e6492ee-343b-492a-8745-a7ee4bddd677`                                             | a second independent GLTF implementation and asset path                                           |
|  22 | music              | `live-music-coder`            | `/ctse/frostbay-haven/LiveMusicCoder/b294e0bc-c042-4dab-b477-37a3a4fb1557`                                         | live audio graph, editor state, and playback interaction                                          |
|  23 | music              | `music-coder`                 | `/ctse/frostbay-haven/MusicCoder/e3e86660-a2be-4b5d-bcd0-b294e0bcc042`                                             | music composition state and browser audio APIs                                                    |
|  24 | music              | `kpop-musical`                | `/ctse/personal/KPopDemonHunterMusical/c797808d-15eb-4a8c-bd7a-0f61dbbac88c`                                       | nested cast and musical-number composition                                                        |
|  25 | music              | `music-library`               | `/ctse/persistent-possum/MusicLibraryMockup/demo`                                                                  | surface-based library, player layout, selection, and scrolling                                    |
|  26 | queries            | `assistant-recipe-gallery`    | `/ctse/assistant-realm-runner-poc/RecipeGallery/home`                                                              | query-backed gallery and linked recipe cards                                                      |
|  27 | async              | `assistant-run`               | `/ctse/assistant-realm-runner-poc/AssistantRun/5b0c9ccb-80a7-40ba-a869-7212e25345a9`                               | Host-tool imports, progress, and long-running assistant state                                     |
|  28 | interaction        | `surface-keyboard-navigation` | `/ctse/persistent-possum/KeyboardSurfaceNavigation/demo`                                                           | focus ladder, keyboard traversal, and selection                                                   |
|  29 | composition        | `surface-combinatorial`       | `/ctse/persistent-possum/CombinatorialWorkspace/demo`                                                              | many recursively nested surface types and stable paths                                            |
|  30 | interaction        | `tier-fast-food`              | `/ctse/tier-maker/TierList/national-fast-food-ranking`                                                             | drag/drop ranking, twenty private images, and edit-return continuity                              |
|  31 | queries            | `coffee-shop-dashboard`       | `/ctse/mythic-alcove/coffee-shop/CoffeeShopDashboard/main-dashboard`                                               | query/list results, orders, customers, menu items, and actions                                    |
|  32 | computed           | `airline-international`       | `/ctse/middle-wolverine/Airline/AirlineFlight/aa4500-ord-lhr`                                                      | deep linked computeVia/BXL graph, currency, percentages, and theme                                |
|  33 | forms              | `invoice-billing`             | `/ctse/software-periodic-workspace/InvoiceBillingForm/inv-2081`                                                    | nested Base fields, configuration, currency, validation, and writes                               |
|  34 | forms              | `deal-intake`                 | `/ctse/software-periodic-workspace/DealIntakeForm/daybreak-wholesale`                                              | writable form, validation, enum, currency, and relationships                                      |
|  35 | base-fields        | `currency-field-demo`         | `/ctse/software-periodic-workspace/CurrencyDemo/041-currency`                                                      | compound Base CurrencyField projection and formatting                                             |
|  36 | base-fields        | `enum-field-demo`             | `/ctse/software-periodic-workspace/EnumDemo/049-enum`                                                              | Base enum and FieldConfiguration semantics                                                        |
|  37 | surfaces           | `surface-canvas-board`        | `/ctse/persistent-possum/CanvasBoard/scratch`                                                                      | pan/zoom, positioned nodes, edges, and pointer interaction                                        |
|  38 | surfaces           | `surface-basic-layout`        | `/ctse/persistent-possum/BasicLayout/airline`                                                                      | deep surface layout/grid/flow composition                                                         |
|  39 | surfaces           | `surface-spreadsheet`         | `/ctse/persistent-possum/SpreadsheetMockup/demo`                                                                   | surface grid cells, structured values, and keyboard navigation                                    |
|  40 | surfaces           | `poster-board`                | `/ctse/loyal-chicken/PosterBoardDemo/demo`                                                                         | poster board frames, x/y/w/h layout, and pointer interaction                                      |
|  41 | spreadsheets       | `spreadsheet`                 | `/ctse/disturbing-cephalopod/Spreadsheet/sample-quarterly-sales`                                                   | full spreadsheet model, editing, formulas, grouping, and scrolling                                |
|  42 | dashboards         | `northwind-dashboard`         | `/ctse/annual-cicada/NorthwindDashboard/main`                                                                      | large business dashboard, queries, charts, and responsive CSS                                     |
|  43 | dashboards         | `sales-dashboard`             | `/ctse/petal-promenade/SalesDashboard/my-dashboard`                                                                | lead/contact relationships, metrics, and nested dashboard sections                                |
|  44 | dashboards         | `analytics-dashboard`         | `/ctse/full-meerkat/SampleCard/AnalyticsDashboard/monthly-revenue`                                                 | charts, metrics, responsive CSS, and inherited sample cards                                       |
|  45 | dense-layout       | `integrated-layer-atlas`      | `/ctse/software-periodic-workspace/IntegratedLayerAtlas/home`                                                      | wide matrix, grouped rows, nested fields, and theme                                               |
|  46 | dense-layout       | `operations-grid`             | `/ctse/software-periodic-workspace/GridDemo/operations-grid`                                                       | dense table/grid presentation and repeated field cells                                            |
|  47 | theme              | `joinery-brand-guide`         | `/ctse/north-branch-joinery/BrandGuide/north-branch-brand-guide`                                                   | trusted Base BrandGuide, cardInfo theme, and image-rich presentation                              |
|  48 | theme              | `joinery-home`                | `/ctse/north-branch-joinery/north-branch-home`                                                                     | workspace-scale composition over an image and relationship graph                                  |
|  49 | trusted-components | `card-frame-catalog`          | `/ctse/prepared-asp/CardFrameDesignSystem/catalog`                                                                 | trusted CardFrame components and dense nested examples                                            |
|  50 | trusted-components | `adorn-showcase`              | `/ctse/prepared-asp/AdornExamples/showcase`                                                                        | trusted layout/adornment components and nested presentation                                       |

<!-- wild-corpus:end -->

The table is generated. Regenerate it after editing the manifest:

```sh
pnpm --dir packages/host run corpus:write-docs
```

## What a smoke pass compares

A row does not pass because a card-shaped rectangle appeared. Each row records
evidence on six planes:

| Plane       | Evidence                                                                                                                     |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Semantic    | visible reference signature; query/relationship output; computed and formatted values                                        |
| Rendering   | non-empty authored content; formats; scoped Host chrome; images; controls                                                    |
| Execution   | selected Direct/Capsule/Sandbox tier; Sandbox handoff; no lifecycle error                                                    |
| Interaction | text entry, scrolling, drag/drop, focus, media, or edit/return where the row calls for it                                    |
| Performance | application/auth readiness and execution readiness, recorded separately; Sandbox interactive handoff                         |
| Diagnosis   | reference drift, environment/auth gate, semantic projection gap, render adapter gap, capability gap, or lifecycle regression |

Every row declares `expectedExecution: 'discover'`. The matrix does not infer a
passing tier from source inspection; the first successful candidate run records
the tier that was actually selected.

## What makes the runner trustworthy over fifty cards

Fifty real cards behave nothing like a test suite, and three runner properties
follow from that. Each is enforced by
[the runner's tests](../packages/host/scripts/execution-runtime-smoke-runner-test.mts).

**Persist each case as it completes.** A single long in-memory batch can exceed
the browser control deadline and take already-collected evidence with it. The
runner hands every finished case to `onCaseComplete` before starting the next,
and a persistence failure is recorded against the run rather than discarding
the result.

**Bound cancellation per case.** One card that never settles must not consume
the budget for every card behind it. `caseTimeoutMs` cuts a case loose and the
batch continues. Cutting loose is not the same as cancelling: the abandoned
work still holds the shared tab and resumes at its next step, which in an
interaction is a click or a form fill. Each case therefore holds a revocable
lease on the tab, and revoking it makes every later operation from that case
throw, so it unwinds instead of driving the next card's page.

**Record application/auth readiness separately from execution readiness.** A
full navigation reboots Host and Matrix work, which dominates the total. A
single number therefore cannot say whether the execution runtime got slower.
The runner times the Host booting and authentication resolving as one part, and
substantive tier output as another.

**Keep the findings apart.** Pre-routing network failure, runtime failure,
semantic mismatch, capability gap, interaction failure, and slow-but-eventually
correct output lead to six different pieces of work, so each case carries a
status rather than a boolean. A card still showing "Loading card" never reached
routing at all — that is an environment finding, and calling it a semantic
mismatch sends the reader to the wrong place.

## Run it

```js
let smoke =
  await import('./packages/host/scripts/execution-runtime-browser-smoke.mts');
let wild =
  await import('./packages/host/scripts/execution-runtime-wild-corpus.mts');
let result = await smoke.runExecutionRuntimeBrowserSmoke({
  browser,
  candidateOrigin: 'https://localhost:4200',
  cases: wild.executionRuntimeWildCorpusCases,
  continueOnReferenceDrift: true,
  onCaseComplete: (caseResult) => appendToRunLog(caseResult),
});
let matrix = smoke.summarizeExecutionRuntimeSmokeRun(result);
```

`continueOnReferenceDrift` keeps the batch going when a reference card is
itself broken: that row is dropped from the candidate set and reported as
`reference-drift` rather than failing the run. Passing `onCaseComplete` is what
makes a partial run useful, so a batch this size should always pass one.

`performanceRepeats` adds warm samples per case. Each one leaves the card and
returns, so it measures a warm navigation rather than a re-read of the document
already on screen.

## Rotating rounds

The 50 cards are not meant to be run as one gate. The completion evidence is
three successive rotating ten-card rounds that add no unexplained failures — a
different ten each round, so a fix that satisfies one round is still under
pressure from cards it has not seen.
