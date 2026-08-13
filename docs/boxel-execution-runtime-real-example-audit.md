# Boxel execution runtime real-example audit

## Purpose and scope

This audit checks the crafted
[twelve-use-case composition suite](boxel-execution-runtime-composition-suite.md)
against fifty examples we developed, debugged, or used as architecture probes
together outside the sandbox compatibility corpus. It includes the Boxel Labs
Surface workbench and component demos as well as realm cards that exposed
boundary regressions.

In this document, **Boxel means Box Element**, not the product as a whole.
Some Boxel Labs entries are reference programs rather than persisted CardDef
instances. They still belong in this audit because they exercise the visual,
interactive, and composition mechanisms that a CardDef/FieldDef/FileDef must
be able to use through the execution runtime.

Coverage labels describe the **planned twelve-case suite**, not tests that
already pass:

- **Strong** — the suite names the mechanism, assigns it to a concrete fixture,
  and specifies semantic, visual, interaction, boundary, and lifecycle checks.
- **Partial** — the suite has the underlying capability but not the full
  behavior demonstrated by the example.
- **Gap** — the suite does not yet have a deterministic owner for the
  mechanism.

## Boxel Labs foundation Surface vocabulary

The Boxel Labs foundation exports all of these Surface kinds, and the suite
must mount every one at least once in a real nested graph:

`Environment`, `Layout`, `Canvas`, `Scene`, `Grid`, `Row`, `Scroll`, `Flow`,
`Frame`, `Pane`, `Plane`, `Outline`, `Cell`, `Run`, and `Unit`.

Merely importing them is insufficient. The conformance fixture must verify
identity/path propagation, parent context, coordinate space, mode, focus,
selection, inspection, edit routing, accessibility semantics, and teardown.

## Fifty real examples

### Boxel Labs and Surface reference programs

|   # | Example                         | Mechanisms it contributes                                                                                | Suite coverage before this audit                                                            |
| --: | ------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
|   1 | Basic Layout                    | all fifteen foundation Surface kinds, nesting, ambient parent context, representative fixtures           | Partial — case 8 had a board but not an all-foundation conformance tree                     |
|   2 | Surface Accessories             | cue label/description/status, accessory aliases, ARIA description wiring, non-product chrome             | Partial — case 8 named presentation but not accessory semantics                             |
|   3 | Airline Dashboard               | deep mixed Layout/Grid/Flow/Scene/Outline composition, dashboard geometry, dense domain presentation     | Strong — cases 8 and 12 cover the graph and visual geometry                                 |
|   4 | Airline Surface Language        | semantic Surface vocabulary used as ordinary product markup, dynamic context, compact/full presentations | Partial — composition is covered; vocabulary/default selection was implicit                 |
|   5 | Keyboard Surface Navigation     | focus ladder, arrow traversal, one selected leaf, ancestor context, keyboard mode                        | Gap — focus existed, but the complete navigation state machine did not                      |
|   6 | Surface Modes                   | use/change/inspect, hover-versus-focus separation, subtree mode propagation                              | Gap — execution formats were covered, Surface modes were not                                |
|   7 | Combinatorial Workspace         | many Surface types in one workspace, stable paths, nested combinations, teardown                         | Strong — case 12 is the graph analogue, once all foundation types are added                 |
|   8 | In-place versus Lift Editing    | inline edit, lifted edit, edit-route choice, commit/cancel/focus return, portal/layer                    | Gap — case 7 covered edit but not inline-versus-lift routing                                |
|   9 | Notion Document                 | outline/row/run/unit hierarchy, rich document editing, coordinate debug, lifted controls                 | Partial — case 6 covers rich content; Surface outline/edit routing was absent               |
|  10 | V2 Notion                       | runtime policy, target resolution, node snapshots, edit-route policy                                     | Partial — runtime selection is covered, generic Surface policy conformance was not          |
|  11 | V2 Spreadsheet Structured Value | grid coordinates, structured values, directional movement, policy-selected target                        | Partial — ordinary fields covered; spreadsheet navigation and structured-cell moves did not |
|  12 | V3 Drag Network                 | cross-container drag, surface posture, typed target network, move semantics                              | Gap — case 8 had drag/resize but not a typed placement network                              |
|  13 | V3 Rule Templates               | CSS-like Surface rule matching, specificity, component selection, contextual templates                   | Gap — no deterministic rule-resolution fixture existed                                      |
|  14 | V3 Outline/Scroll Directives    | descendant/subtree directives, outline plus scroll, posture propagation                                  | Gap — no directive scope/inheritance assertions existed                                     |
|  15 | Grid Spreadsheet Example        | virtual rows, cell focus, range selection, keyboard movement, resize/pin behavior                        | Gap — no high-density Grid conformance fixture existed                                      |
|  16 | Grid Widgets Showcase           | checkbox, date, currency, rating, status, priority, text and widget editing in cells                     | Partial — field controls are covered individually, not inside a virtual Grid                |
|  17 | Grid Cell Popover               | top-layer/lifted cell editor, focus containment, commit/cancel, anchor geometry                          | Gap — same missing Lift/Plane contract as example 8                                         |
|  18 | Grid Fill Handle                | drag selection, range overlay, fill operation, drop indicator, autoscroll edge cases                     | Gap — poster dragging does not prove spreadsheet fill semantics                             |
|  19 | Canvas Demo                     | nodes, edges, handles, pan/zoom, reconnect, resize, minimap, viewport portal                             | Partial — cases 8/12 cover pan/zoom and positioned cards, not graph editing                 |
|  20 | Scene Demo                      | camera drag, wheel momentum, node motion, halo/FX, WebGL effects, scene coordinates                      | Partial — case 9 covers WebGL/3D lifecycle, not Scene camera semantics                      |
|  21 | Surface Matrix                  | side-by-side Surface comparison, selected detail, lift host, semantic matrix                             | Partial — visual matrix exists conceptually, but no suite case checks Surface parity rows   |
|  22 | Surface Primer                  | foundation explanations rendered as accessible working examples                                          | Partial — semantics are distributed across cases rather than one primer fixture             |
|  23 | Surface Mini Demo               | compact composition, constrained geometry, minimal nested state                                          | Strong — fitted/embedded and nested geometry are explicit                                   |
|  24 | Widget Lab Table Pane           | table/container rendering, row/cell selection, pane sizing, data-density behavior                        | Partial — case 10 gains a Grid fixture from this audit                                      |
|  25 | Canvas Frame Mockup             | canvas inside frame, allocated coordinate region, clipping and presentation shell                        | Strong — cases 8/9 cover allocated layout, viewport, and presentation                       |
|  26 | Cell Multileaf Mockup           | one cell with multiple leaves/slots, focus target choice, compact composition                            | Partial — nested slots are covered, multi-leaf focus arbitration was not                    |
|  27 | Empty/Loading/Error Mockup      | stable geometry and explicit empty/loading/error states in the same Surface                              | Strong — cases 5, 7, 9, and 11 cover all three plus last-known-good                         |
|  28 | Lift Panel Mockup               | lifted panel, anchor/portal geometry, modal/popover plane, dismiss and focus return                      | Gap — top-layer/lift lifecycle lacked a test owner                                          |

### Realm cards and application probes

|   # | Example                               | Mechanisms it contributes                                                                                                                            | Suite coverage before this audit                                                                     |
| --: | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
|  29 | Tier Maker / TierList                 | cross-list drag/drop, reorder, images, dynamic styles, focus, clipboard, haptics, view transitions, edit/return state                                | Partial — images/edit/styles covered; full placement, clipboard, haptics, and transitions were not   |
|  30 | Scrabble Stream / Replay              | BXL mutation, streamed/collaborative state, scheduling, replay ordering, authenticated AI operation                                                  | Partial — command/HMR covered; BXL and deterministic multi-client scheduling were not                |
|  31 | DMN Workflow Catalog                  | RichMarkdown, complex tables, Mermaid, nested business-decision data, large content                                                                  | Strong — case 6 expressly covers RichMarkdown/Mermaid/table/nested embeds                            |
|  32 | Software Periodic Table               | large fitted gallery, `prefersWideFormat`, many child cards, format-specific CSS, selection                                                          | Strong — cases 1, 5, and 12 cover wide format, fitted children, styles, and identity                 |
|  33 | Integrated Software Layer Matrix      | wide matrix, nested fields, computed/grouped rows, themes, fitted-versus-isolated parity                                                             | Strong — cases 2, 3, 8, and 10 cover these mechanisms                                                |
|  34 | Invoice Billing Form                  | nested Base FieldDefs, field configuration, currency, dynamic color, writable edit, validation                                                       | Strong — cases 2 and 7 were designed from these failures                                             |
|  35 | Coffee Shop Menu                      | query/relationship composition, images, commands/BXL update, nested product cards, themes                                                            | Strong — cases 3, 5, 7, 10, and 11 cover it                                                          |
|  36 | Coffee Bean Product                   | image URL/ImageDef pair, currency/number formatting, computed inventory, country options, nested writes                                              | Strong — cases 2, 3, and 7 explicitly guard the observed regressions                                 |
|  37 | Gym Shift Board                       | repeated cards, scheduling/workflow state, themes, actions, compact rows                                                                             | Partial — list/actions/theme covered; schedule semantics needed a stronger owner                     |
|  38 | Signet Proposal                       | enum factory, Markdown, canvas/signature input, commands, theme                                                                                      | Strong — cases 3, 6, 7, 8, and 11 cover it                                                           |
|  39 | Assistant Realm Runner / AssistantRun | Host tools, typed commands, Realm operations, toolbar slot, progress, restricted authority                                                           | Partial — command/slot covered conceptually; Host-tool and data grants need exact negative tests     |
|  40 | Tribeca Sign Maker                    | Three.js/3MF, browser/document dependency, iframe height, poster fallback, editable source                                                           | Strong — case 9 directly models this split-module path                                               |
|  41 | NYC Fire Guard Practice Exam          | randomized questions, forms, derived score, progress, repeated interaction                                                                           | Partial — fields/actions/compute covered; deterministic seeded workflow progression was not explicit |
|  42 | Cardstack AI-Native Landing Page      | very large scoped CSS, theme variables, responsive layout, navigation, Monaco HMR                                                                    | Strong — cases 3 and 11 cover style confinement and volatile source updates                          |
|  43 | Attendance Staff Member               | nested linked profiles/assignments, computed labels, actions, image/avatar, live data                                                                | Strong — cases 3, 5, and 7 cover it                                                                  |
|  44 | Color Tree Playground                 | custom components, `prefersWideFormat`, color fields, safe modifier behavior, several formats                                                        | Strong — cases 1, 2, 3, and 8 cover it                                                               |
|  45 | Airline Flight / AA4500               | deep linked BXL/computeVia graph, pre-indexed computed values, currency/percent, themes                                                              | Strong — cases 2, 5, and 10 cover deep compute/relationship projection                               |
|  46 | Recipe Card / Fire-Roasted Beans      | ordinary Card API, nested ingredients/content, image, default and authored formats                                                                   | Strong — cases 1–3 provide the ordinary-card baseline                                                |
|  47 | Commonplace Proposal                  | RichMarkdown/editor, publication navigation, theme, responsive long-form layout                                                                      | Strong — cases 3 and 6 cover it                                                                      |
|  48 | Realm Collaboration / Collab Scene    | cross-Realm links, scene state, user authorization, collaborative updates                                                                            | Partial — grants/Scene exist separately; multi-client collaboration was not combined                 |
|  49 | Iterative Image Generation Pipeline   | Realm Script planning, voice→prompt→image→persist stages, 25+ Job runs, optimistic progress, binary files, ImageDef links, partial failure and retry | Partial — command/progress existed, but case 11 did not yet own the full asynchronous pipeline       |
|  50 | Greasy Gecko Boxel AI Website         | large themed site layout, animation, custom components, inherited content and responsive CSS                                                         | Partial — theme/CSS/HMR covered; animation scheduling and view-transition lifecycle were weak        |

## Coverage verdict

The original twelve-case suite covered most **Boxel semantic data paths** but
not most **advanced Surface interaction paths**.

My assessment before applying the improvements below:

| Mechanism family                                     | Assessment | Why                                                                                                                                                                              |
| ---------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Primitive/compound fields, enum, field configuration | Strong     | Cases 1–3 enumerate the Base catalog, configuration callbacks, cache invalidation, and nested getters.                                                                           |
| contains/containsMany/linksTo/linksToMany            | Strong     | Cases 2, 5, 7, and 10 cover identity, loading, broken slots, mutation, and grants.                                                                                               |
| computeVia/getters/BXL-derived values                | Partial    | Getter/compute graphs are strong; BXL mutation/evaluation/acknowledgement needs an exact fixture.                                                                                |
| Queries and query fields                             | Strong     | Case 10 covers filters, sorts, refs, consumers, refresh, and PATCH omission.                                                                                                     |
| Images/files/media                                   | Strong     | Image pairs, polymorphism, files, audio/video, 3MF, failures, and cleanup are assigned.                                                                                          |
| Formats/delegated rendering                          | Strong     | Open-ended formats, atom/embedded/fitted/isolated/edit/head/markdown, nested dispatch, and split modules are assigned.                                                           |
| RichMarkdown/Mermaid/CodeMirror                      | Strong     | Case 6 is an exact recursive portal/editor fixture.                                                                                                                              |
| Themes/scoped CSS/presentation                       | Strong     | Cases 3, 8, 9, and 12 assert computed variables, confinement, header/background, and parity.                                                                                     |
| Writes/read-write parity                             | Strong     | Case 7 covers canonical Store mutation, reauthorization, optimistic state, errors, and acknowledgements.                                                                         |
| HMR/source navigation                                | Strong     | Case 11 covers local and out-of-band changes, generations, last-known-good, and no-remount behavior.                                                                             |
| 3D/iframe/height/prerender                           | Strong     | Case 9 directly owns this path.                                                                                                                                                  |
| Cross-Realm authorization                            | Strong     | Cases 5 and 10 cover explicit selection, narrow grants, revocation, and negative access.                                                                                         |
| Surface identity/path/context                        | Partial    | The suite used surfaces but did not mount every foundation kind or assert context/path rules.                                                                                    |
| Surface modes/focus/accessories                      | Gap        | use/change/inspect, focus ladder, selected leaf, hover, cue/accessory semantics lacked an owner.                                                                                 |
| Inline/lifted editing and portals                    | Gap        | Ordinary edit was covered; lift/plane/top-layer/focus-return was not.                                                                                                            |
| Drag/drop/placement                                  | Gap        | Poster dragging was much narrower than typed cross-container placement, keyboard/paste parity, ghost, denial, and FLIP.                                                          |
| Grid/spreadsheet mechanics                           | Gap        | No virtualization, pinning, range/fill, cell popover, or directional navigation fixture.                                                                                         |
| Canvas graph mechanics                               | Partial    | Pan/zoom and positioned cards existed; edges, handles, reconnect, minimap, and graph editing did not.                                                                            |
| Scene/camera/effects                                 | Partial    | WebGL lifecycle existed; camera momentum, node motion, and scene-coordinate semantics did not.                                                                                   |
| Scheduling/collaboration                             | Gap        | Playback coordination existed; seeded timers, ordered replay, two-client convergence, and reconnect did not.                                                                     |
| Clipboard/haptics/view transitions                   | Gap        | Listed as proposed `surface*` APIs but not exercised end-to-end.                                                                                                                 |
| Host tools/AI/command authority                      | Partial    | Positive command flow existed; exact import denial and narrowly granted Host-tool tests were missing.                                                                            |
| Realm Script and asynchronous AI production          | Partial    | Realm Script limits, optimistic progress, provider IO, binary persistence, partial success, cancellation, retry, and out-of-order acknowledgement lacked one cumulative fixture. |

So the honest answer is: **yes for most Card/Field/File and rendering
mechanisms; no for enough of the Surface interaction system that the suite was
not yet a sufficient replacement for the examples.** Counting by the
twenty-three families above, 11 were strong, 6 partial, and 6 gaps. More
importantly, the gaps cluster in the mechanisms most likely to fail at a
sandbox boundary.

## Changes integrated into the twelve-case suite

There is only one acceptance suite. The following mechanisms are integrated
directly into their owning cumulative cases rather than maintained as a second
suite or a layer of add-on tests.

### Case 6: document projection

Add an Outline projection of the same LinerNotes document:

- Outline → Row → Run → Unit nested Surface path;
- RichMarkdown headings map to outline rows without copying content;
- use/change/inspect affect the outline and editor consistently;
- keyboard traversal and focus return survive an embedded Track finishing load;
- cue label/description/status accessories remain non-product chrome.

This absorbs the Notion Document, Markdown Projection, Outline, and Surface
Accessories mechanisms.

### Case 8: Surface and placement conformance

CampaignBoard gains two deterministic subfixtures.

**Foundation tree:** mount all fifteen foundation Surface kinds in one honest
product graph and assert:

- stable identity and inherited Surface path;
- parent/dynamic context;
- coordinate schema/source;
- use/change/inspect mode propagation;
- one focus leaf, one selected leaf, ancestor context, separate inspect hover;
- inline versus lifted edit route, commit/cancel, anchor geometry, focus return;
- cue/accessory semantics and teardown.

**Placement lane:** move a Track, Release, and image between two ordered
containers and one PositionedCard target using the same typed acceptance and
commit path. Assert:

- pointer activation threshold;
- compatible target highlighting and structured denial;
- live ghost at the target-requested format;
- insertion wedge and exact ordered index;
- cross-container move versus reference semantics;
- FLIP/settle animation and stable Card identity;
- keyboard pickup/navigation/commit/cancel;
- clipboard paste through the same placement command;
- pointer capture/autoscroll cleanup;
- transition names scoped by Surface/render-slot identity.

This absorbs Tier Maker and the Boxel Labs drag/lift/rule examples. Haptics are
an optional result of successful placement; absence or denial never changes
the command semantics.

### Case 9: Canvas and Scene

Before mounting the 3D artifact, the safe module renders a small editable
Canvas graph with two nodes and one edge. The Sandbox Scene consumes the same
canonical node data. Assert:

- node drag/resize, handle connection/reconnection, edge label, minimap, and
  viewport portal;
- pan/zoom conversion and allocated geometry;
- camera drag/wheel momentum and one deterministic node transition;
- trusted/shared Canvas primitives do not grant ambient DOM authority to the
  authored Capsule;
- WebGL/Scene effects remain Sandbox-local and release every resource.

This covers the Canvas and Scene reference programs while retaining the
split-module rule.

### Case 10: query Grid

Render one ReleaseCollection query through a virtualized Grid in addition to
the existing search-results and card formats. Assert:

- row/cell identity under virtualization;
- pinned column and resized column geometry;
- keyboard cell navigation and focus preservation;
- range selection and deterministic fill over an editable rating field;
- trusted cell widgets for number, date, currency, enum/status, checkbox, and
  rating;
- lifted cell editor and context menu focus/commit/cancel;
- query refresh does not discard selection or remount unrelated cells.

This gives Grid/spreadsheet behavior a real data/query owner.

### Case 11: BXL, Realm Script, asynchronous AI, authority, and collaboration

ProductionConsole gains a deterministic two-client replay harness:

- a BXL patch changes a Track field and returns the canonical affected paths;
- local generation renders immediately;
- server/index acknowledgement cannot restore the old value;
- seeded `surfaceSchedule` emits ordered ticks and supports pause/resume;
- two clients converge on one ordered Scrabble-like event log after reconnect;
- duplicate/out-of-order acknowledgements are idempotent;
- unauthorized imports of Host tools fail during classification/evaluation;
- a separately granted command handle performs one narrowly scoped Host
  operation, with progress and revocation.
- a capability-scoped Realm Script produces a schema-validated plan for four
  campaign image variants but never receives provider credentials;
- Host commands execute a deterministic four-job provider harness in CI,
  persist successful binaries, and link ImageDefs as results arrive;
- controlled out-of-order completion, one partial failure, cancellation,
  retry, timeout, and stale-generation acknowledgement cannot reorder or erase
  already durable outputs.

This absorbs Scrabble Stream, Gym Shift Board, the Iterative Image Generation
Pipeline, collaboration, and Assistant Runner mechanisms without granting
general Host services.

### Case 12: final graph

The timeline must combine the new mechanisms rather than merely render them:

- drag the case-4 MusicPlayer from the query Grid into a timeline lane;
- use the same typed placement path for pointer, keyboard, and paste;
- open its metadata in a lifted editor while playback remains mounted;
- synchronize the audio player, video, Canvas viewport, and Sandbox Scene;
- switch use/change/inspect modes across the composed subtree;
- run one scoped view transition without leaking a global transition name;
- revoke a Partner grant and prove unrelated focus, playback, Grid selection,
  and iframe state survive.
- show completed CampaignAssets in the poster/timeline as each result becomes
  durable and retry a failed image while playback and editing continue.

Only this final combination proves that the added tests compose instead of
passing as isolated mechanisms.

## Remaining deliberate exclusions

These are not silently ignored. They need separate product/security decisions
before becoming required runtime capabilities:

- unrestricted clipboard read;
- arbitrary navigator APIs;
- generic vibration/haptics beyond a bounded success signal;
- arbitrary DOM/CSS mutation from Capsule code;
- unbounded timers/background work;
- unrestricted AI/Host tool import;
- cross-Realm search without an explicit Store grant; and
- arbitrary third-party browser packages outside an origin Sandbox.

The suite should test their denial. It should not invent a broad capability
merely to make one historical example remain Capsule-eligible.
