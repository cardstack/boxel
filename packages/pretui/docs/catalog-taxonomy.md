# Pretui Catalog Taxonomy

This document defines how components are classified and described in the
Pretui catalog. It is the public reference for catalog authors, reviewers, and
tools that generate or filter component metadata.

## Principle

A component's **category** and **composition tier** answer different
questions and must not be collapsed into one hierarchy.

- **Category** answers: _What kind of component is this, and where would a
  product author look for it?_
- **Tier** answers: _How compositionally complex is it?_
- **Tags** describe cross-cutting capabilities that do not determine the
  component's primary home.

The catalog assigns one primary category and one tier to every component.
A component may have any number of tags.

## Categories

The primary category vocabulary is:

| Category         | Scope                                                                                                                   |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Foundations      | Visual and semantic primitives: typography, labels, tokens, badges, accessibility utilities, and decorative treatments. |
| Actions          | Buttons and explicit action affordances.                                                                                |
| Inputs           | Controls that collect or select one value.                                                                              |
| Forms            | Field composition, validation presentation, record editing, and multi-field workflows.                                  |
| Layout           | Components whose primary job is arranging, sizing, scrolling, or fitting other content.                                 |
| Navigation       | Components that move a user between locations, views, pages, or hierarchy levels.                                       |
| Containers       | Surfaces that enclose, disclose, or group content without determining the larger page layout.                           |
| Data Display     | Tables, lists, charts, trees, timelines, values, formatters, and collection views.                                      |
| Feedback         | Status, progress, loading, empty, result, alert, and notification states.                                               |
| Overlays         | Content rendered above or outside the normal document flow.                                                             |
| Media            | Image, audio, video, model, asset, and time-based media interfaces.                                                     |
| Agentic          | Conversation, reasoning, approval, work, recommendation, and result surfaces for agents.                                |
| Motion & Effects | Reusable transition, presence, pointer, text-motion, and visual-effect behaviors.                                       |
| Authoring Tools  | Inspector, layer, design-value, and component-documentation machinery.                                                  |

Category names are user-facing and should use familiar product-language terms.
Implementation packages, source libraries, rendering formats, and ownership
boundaries are metadata, not categories.

## Layout is a first-class category

`Layout` is a primary category, not a synonym for every surface and not a
composition tier. A component belongs in Layout when its main contract
controls the placement, dimensions, overflow, responsiveness, or fitting of
its children.

The initial Layout set is:

- Affix
- AppShell
- AspectRatio
- Carousel
- CopyFit
- DashboardGrid
- DashboardItem
- GraphLayout
- Grid
- HeroSplit
- InfiniteScroll
- Masonry
- PageScaffold
- Resizable
- ScrollArea
- Scroller
- SplitPanes
- Stack
- StackingCards
- ZoomableFrame

Important boundaries:

- Card, Panel, and PanelSection are **Containers**.
- Sidebar, BottomNav, Dock, Breadcrumb, Pagination, NavigationMenu, SkipLink,
  and TableOfContents are **Navigation**.
- Board, NodeCanvas, Tree, Timeline, Chart, BarList, and Sparkline are
  **Data Display**.
- Empty, EmptyState, and Skeleton are **Feedback**.
- MorphingDialog, MorphingPopover, and Tooltip are **Overlays**.
- FormLayout remains **Forms** and carries the `layout` tag because its
  primary purpose is form composition.
- StepsWithMedia remains a composed block and carries both `layout` and
  `media` tags.

### CopyFit naming

The component previously called `FittedCard` is named **CopyFit**.

`fitted` is a Boxel rendering format. CopyFit is the layout mechanism used to
make copy and optional media adapt across the fitted format's available
quantums. Naming the component after the mechanism keeps the format and the
component distinct.

CopyFit metadata:

- Category: `Layout`
- Suggested tier: `Compound`
- Tags: `fitted`, `responsive`, `container-query`, `copy-fitting`

Pret UI has no `FittedCard` alias; examples and documentation use `CopyFit`.
`FittedCard` elsewhere refers to the boxel-ui component of that name.

## Composition tiers

The tier vocabulary contains only compositional levels:

| Tier      | Meaning                                                                                 |
| --------- | --------------------------------------------------------------------------------------- |
| Primitive | A visual, semantic, or behavioral atom that is not normally a complete product control. |
| Element   | A complete component with one focused job.                                              |
| Compound  | A component assembled from multiple elements or primitives.                             |
| Surface   | A bounded region that hosts or organizes product content.                               |
| Block     | A reusable product-level composition or scene.                                          |
| Runtime   | Authoring, catalog, or execution machinery rather than ordinary product UI.             |

Forms, Media, Motion, Layout, and Agentic are categories, not tiers. Host
ownership is also separate from tier.

## Tags

Tags capture meaningful overlap without forcing a component into several
primary categories. Prefer a small controlled vocabulary. Useful tags include:

- `accessible-utility`
- `async`
- `collection`
- `container-query`
- `copy-fitting`
- `drag-drop`
- `fitted`
- `form-associated`
- `keyboard-navigation`
- `layout`
- `media`
- `responsive`
- `selection`
- `time-based`
- `virtualized`

Tags describe capabilities, not implementation trivia. Package names and
source libraries belong in provenance metadata.

## Metadata model

Every catalog component should expose these concepts:

| Field                  | Purpose                                                           |
| ---------------------- | ----------------------------------------------------------------- |
| `category`             | One primary user-facing category.                                 |
| `tier`                 | One explicit composition tier. Never infer it from category.      |
| `tags`                 | Controlled cross-cutting capability terms.                        |
| `ownership`            | `pretui`, `boxel-ui`, or `host`.                                  |
| `implementationStatus` | `planned`, `designed`, or `implemented`.                          |
| `adoptionStatus`       | `experimental`, `demo-ready`, `in-use`, or `deprecated`.          |
| `introducedVersion`    | The release in which the component entered the catalog.           |
| `version`              | The component's current contract version.                         |
| `brief`                | A concise statement of purpose and differentiation.               |
| `dependencies`         | Structured component dependencies rather than a delimited string. |
| `provenance`           | Structured sources, prior art, and implementation lineage.        |
| `demandEvidence`       | The systems or research sources supporting demand.                |

`PretUISpec` does not have the last three yet. Today dependencies are the
`buildsOn` string, provenance is `source`, `lineage` and `refs`, and demand is
a 1–5 `demand` score without its evidence. Host chrome is `ownership: host`,
not a category.

### Lifecycle fields

`host` is ownership, not an implementation status. Likewise, `live` is too
ambiguous to describe both implementation and adoption. A component can be
implemented without having examples, or demo-ready without being used in a
product. Those states must remain independently queryable.

The “new” badge is computed: a component is new when its `introducedVersion`
is the current kit release (`CURRENT_RELEASE` in `pretui-component.gts`), so
the badge clears itself when that release is bumped.

### Relationships and provenance

Component dependencies should identify individual catalog components. External
references should retain the source system, referenced component, and URL when
available. Avoid packing several references into a display string; structured
metadata supports filtering, validation, and future relationship views.

## Catalog presentation

The catalog should expose the two primary axes independently:

1. Filter by **Category** in the navigation rail.
2. Optionally group results by **Tier**.

Search should include category, tier, tags, brief, dependencies, and
provenance. Adoption filters remain independent of taxonomy.

This preserves the periodic-table presentation while making discovery follow
product intent: an author can ask for “layout,” then see which results are
elements, compounds, surfaces, or blocks.

## Migration

1. Add category, tier, tags, ownership, implementation status, adoption
   status, and introduction metadata while retaining the existing fields.
2. Establish Layout and split the current Structure catch-all across Layout,
   Navigation, Containers, Data Display, Feedback, Media, and Overlays.
3. Split broad Controls entries across Actions, Inputs, Forms, Feedback, and
   Authoring Tools.
4. Populate explicit tiers; remove category-to-tier inference and exceptional
   overrides.
5. Update the catalog rail to filter by category and keep grouping by tier as
   an independent option.
6. Rename FittedCard to CopyFit.
7. Remove the legacy territory, overloaded stage, persistent isNew, and
   liveInUse fields; “in use” is `adoptionStatus: in-use`.
