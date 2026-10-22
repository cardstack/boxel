# Dashboard v2: design

The workspace chooser becomes a dashboard: one scrolling page in three sections (Workspaces, Catalogs, Agents), a rail that jumps between them, and favorites that show the cards the user pinned. It is an upgrade of the existing chooser, built only from data the host already has; nothing waits on a platform feature.

- Design review canvas (as built, critique, revised): https://claude.ai/artifact/2xdSSTT5rMZVaLNcfJJgQK
- Original exploration (rail options, first visit, phone): https://claude.ai/artifact/4ASxkjED7hHERxqW8pfD8H
- Source of the onboarding and catalog patterns: the Boxel Home preview card, a design prototype in a staging realm.

## Goals

- **First visit:** show a new user something worth opening (the catalog) and two ways to build (Boxel AI, or their own agent app through the Boxel plugin).
- **Every day:** the workspaces a user works in, with the cards they care about, one click away.
- **Additive:** every existing chooser behavior stays — favorites, the `···` menus, archive, the unreachable-servers notice, keyboard navigation and the phone layout.

## The page

Top to bottom, inside `workspace-chooser/index.gts`:

1. **Page head.** A greeting ("Good morning, <first name>") and the scope filter, quiet **All / Hosted** chips, the first of the filters the page can grow. Hosted keeps workspaces published to the web, in every section. It replaces the View All / Hosted Only dropdown, which sat in the top bar.
2. **Get started** (`get-started.gts`). A checklist whose ticks come from real signals: a card opened, a Boxel AI session, a published workspace, an agent command copied. Dismissible; collapses once a step is done.
3. **Start from the catalog** — only for a user with fewer than three workspaces of their own (`CATALOG_LEADS_BELOW`). The catalog shelf moves here, ahead of Workspaces.
4. **Workspaces.**
   - **Favorites** are desk tiles: the wallpaper with separate controls on it (the name pill, star, `···`, a LIVE chip). The pill or the bare wallpaper opens the workspace. A caption underneath carries visibility, card counts, pins and the primary published host.
   - **Pinned cards.** Up to four per favorite, collaged on the tile (below). A favorite with none says how to pin.
   - **Your Workspaces** leads with the most recently updated workspaces as full wallpaper tiles, enough to fill three rows beside New Workspace (about a dozen). The rest continue straight on, with no break, as compact rows: realm mark, name, visibility, last update; the wallpaper shows on hover. After ten rows a scrim fades the last one under a **Show N more** button; **Show fewer** collapses the list again. Only rendered rows are in the DOM.
   - **Archived**, collapsed, as before.
5. **Catalogs.** The catalog shelf (when it didn't lead the page), then the catalog workspaces as medium wallpaper tiles.
6. **Agents.** A pitch ("Build with the agent you already pay for"), a five-step setup for Claude Code or Codex, and Boxel AI beside it for anyone without an agent.

Every section is the same dark panel family (`--boxel-700` with a hairline edge, radius 1.25rem) and one type scale: greeting 2rem, section heading 1.375rem, anything inside a section smaller than its heading.

## The rail

`workspace-chooser/nav-rail.gts`, mounted by `submode-layout.gts` next to the wordmark it belongs to.

- **Entries** are the page's sections in page order: Workspaces, Catalogs, Agents (Catalogs first when the catalog leads). Clicking one scrolls to its section; the first section scrolls to the top.
- **Scroll-spy** marks the section being read with an outline ring. The filled wordmark already says which screen this is; the rail is that screen's outline, so it never shows a second fill.
- **Flyouts** open on hover or focus: favorite workspaces, catalogs, Boxel AI sessions with New session.
- **Menu-aim.** While the pointer heads into the open flyout (the move narrows the angle to both of the flyout's near corners), crossing other entries doesn't switch it; the switch waits and happens only if the pointer stops short. Leaving an entry closes its flyout after a grace period. Escape closes the flyout, then the rail.
- **Two modes, one breakpoint (80rem):**
  - Below it, the rail is summoned — by hovering, focusing or clicking the wordmark, or by nearing the left edge (a hot-zone strip) — and dismisses after a grace period once the pointer leaves the wordmark, edge and rail.
  - At and above it, the rail stays as a labeled sidebar with counts, and the page content starts past it.
- **Layering:** above the chooser (z 200), below the search sheet (300) and top bar (700), so the wordmark and search button keep their live positions.

## Pinned cards

- **Pinning** comes from a card's menu in the stack: _Pin to Dashboard_, _Unpin from Dashboard_, and _Show on Dashboard as Fitted / Embedded / Isolated / Edit_. A workspace holds at most four (`MAX_DASHBOARD_PINS_PER_WORKSPACE`); a full one shows the menu item disabled with the reason.
- **Pins live on favorites.** Pinning a card also favorites its workspace, since the pin would otherwise be stored and shown nowhere. Unstarring keeps the pins for when the workspace returns.
- **The collage** (`pinned-cards.gts`) lays pins out on a 900px design canvas and zooms the whole canvas to the tile, so each card renders at a real size and the tile shows a miniature. Fitted cards fill their cell; page formats (embedded 480, isolated 900, edit 640) render at their template width and zoom again to the cell. Two, three and four pins each get an arrangement with a lead card.
- **No card code loads to draw a tile:** pins render from the index's prerendered HTML in their chosen format. `edit` isn't prerendered, so edit pins hydrate.
- **Layering:** with pins, the wallpaper behind them is dimmed, not blurred, so the cards read as the content; hovering brings some of it back.

## The catalog shelf

`catalog-showcase.gts`, the catalog told as stories, the way an app store's Today tab tells its own (after the Home preview's `CatalogStory` cards). The store is the one place the page leaves its dark panels, for tinted paper story cards, the way the catalog's own pages look.

- **Stories:** one row of four equal story cards, so the store stays a shelf beside the workspaces rather than outweighing them. Each wears its own paper in turn (warm, ink, mint, lilac) and shows an eyebrow, a headline, art, a few lines of copy and two calls to action.
- **Calls to action:** **Try it** opens the live example card; the main action (**Remix** for cards, fields and apps, **Use** for themes and skills) opens the listing, where that flow runs, since Use and Remix are catalog-owned commands that need the loaded listing and a target workspace. The whole story also opens its listing, which reads as the article.
- **Featured** listings come from the catalog's own index card (`featured` links), so the catalog curates what leads; its other listings follow.
- **Eyebrows** come from the kind: the lead is "<Kind> of the week"; the rest read Try it, New app, New theme, New skill or Build with it.
- **Every story's art is the listing in use:** each story loads its listing's first example card and renders it from prerendered isolated HTML as a 1000px page zoomed into the frame (the pin collage's `fitPage`). The listing thumbnail stands in until it arrives, and for a listing without one.
- **Index data only:** the search asks for `item.name`, `item.summary` and `item.cardThumbnailURL` as a sparse fieldset, so no card code loads.
- **The kind** (Card, App, Field…) comes from the listing's folder (`…/CardListing/<id>`), since search reports the base `Listing` type.
- **Copy:** names drop "Card Definition". The copy is the listing's summary, unless it describes the code ("The X component…"); then a line for its kind stands in. Real short descriptions need an editorial field in boxel-catalog.

## Agents

`agents.gts`, extracted from the Home preview's Make region.

- **A screencast** leads the section (`agent-screencast.gts`): a generic desktop agent app, the kind Claude and Codex are, takes a request in its chat, edits a card and pushes it, while Boxel in the app's side panel picks the change up. Drawn in the page, not a video; chapters (Ask, edits, lands in Boxel) and play/pause; it runs only on screen and holds the finished frame for reduced motion.
- **Five steps, typed into the agent's chat, not a terminal:** add the Boxel marketplace, install the plugin (Claude or Codex form), open a workspace (the user picks which of their own), ask for a change, see it in Boxel. The plugin's skills do the signing in and syncing. Only the open step shows its text, with Copy.
- **Progress counts copies,** stored as `agentSetupDone`, and says so ("2 of 5 copied"): the dashboard can't see the agent's chat. Ticking the last step for real needs the realm to report a push from the agent.
- **Boxel AI** sits beside the steps for anyone without an agent: Describe it (a new session) and recent sessions.

## State

One Matrix account-data key, `app.boxel.dashboard` (`AppBoxelDashboardContent` in `runtime-common/matrix-constants.ts`): `onboardingDismissed`, `agentCommandCopied`, `agentSetupDone`, and `pinnedCards` (realm URL → card id and format, in pin order). Writes read the server copy and merge so another tab's write isn't lost; the account-data listener keeps open tabs in sync. Favorites stay in their existing key. The mock matrix client supports the new key so tests can seed it.

## Accessibility and keyboard

- **The selection is the keyboard's cursor.** On open it rests, focused, on the workspace the dashboard opened over (else the first favorite or workspace), so Enter goes straight back, but nothing looks picked. The first arrow key or Tab shows the ring where it rests; a pointer press hides it again. The ring is the one mark: on the outer edge of a desk, tile or row, never an outline on the pill or button carrying focus. Controls inside a tile show on hover, with the ring, or when one of them has Tab focus.
- Workspace names show on one line; hovering one shows it whole over its realm URL, so long names read in full and same-named workspaces can be told apart.
- Arrow keys walk the tiles in the order shown: favorites, New Workspace, recent tiles, visible rows, catalog rows.
- A compact row's name is its one button, stretched over the row; the star, menu and live link sit above it as their own controls. A favorite's name pill carries the same role.
- The rail's entries are buttons with `aria-current='location'` on the section being read; the scope filter's options use `aria-pressed`.
- Motion respects `prefers-reduced-motion`.

## Files

| Area                               | Files                                                                                |
| ---------------------------------- | ------------------------------------------------------------------------------------ |
| Page, sections, filter, lists      | `workspace-chooser/index.gts`                                                        |
| Tiles, desk surfaces, compact rows | `workspace-chooser/workspace.gts`, `item-container.gts`, `add-workspace.gts`         |
| Rail                               | `workspace-chooser/nav-rail.gts`, `submode-layout.gts`                               |
| Pins                               | `workspace-chooser/pinned-cards.gts`, `stack-item.gts`, `services/matrix-service.ts` |
| Catalog shelf                      | `workspace-chooser/catalog-showcase.gts`                                             |
| Onboarding                         | `workspace-chooser/get-started.gts`, `workspace-chooser/agents.gts`                  |
| State                              | `runtime-common/matrix-constants.ts`, `tests/helpers/mock-matrix*`                   |

## Still to do before this ships

- **Test coverage gaps:** the acceptance tests (`Acceptance | workspace-chooser > dashboard`) cover the page head, catalog-first order, the rail's order, current section, flyouts and Escape, pins, pin-to-favorite and agent setup. The fixture has two workspaces, so the recent-tile / compact-row split, Show N more and keyboard navigation across the rows are untested; so is the catalog shelf, which needs the catalog realm.
- A notice when pinning also favorites a workspace.
- Get started's agent step should link to the Agents section and tick when setup does.
- Linear tickets for what this defers: the catalog editorial field (a boxel-catalog change), push detection for the last setup step.

## Out of scope

Invitations, activity attribution, nudges, live agent status, persona layouts, a Recent section (search already lists recent cards), a Since your last visit section.
