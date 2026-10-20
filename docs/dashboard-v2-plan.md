# Dashboard v2: additive upgrade to the workspace chooser

Design: https://claude.ai/artifact/4ASxkjED7hHERxqW8pfD8H (Rail A, returning, first visit, phone).

## Goal

Improve onboarding and daily use of the workspace chooser without waiting on platform features. Every existing behavior stays: Favorites, Your Workspaces, Catalogs, Archived, the tile `···` menus, the View All / Hosted Only filter, keyboard navigation, the unreachable-servers notice and the phone layout. Everything below is added on top, from data host already has.

## What ships

1. **Nav rail, summoned from the BOXEL wordmark.** Hovering (or clicking, or focusing) the top-left wordmark while the chooser is open slides in a 60px rail under it. Entries: Workspaces (the chooser itself, active), Boxel AI (flyout: recent sessions, New session), Catalog (flyout: the user's catalog realms). The rail ends above the existing bottom-left search button, which stays where it is. Leaving the rail and the wordmark dismisses it after a short grace period; Escape dismisses it and returns focus.
2. **Get started.** A checklist at the top of the chooser whose ticks come from real signals: has opened a card, has a Boxel AI session, has a published workspace, has copied the agent setup command. Dismissible. Collapses to one line once something is done.
3. **Favorite tiles as surfaces.** A favorite tile is its wallpaper with separate controls on it: the name pill (which keeps keyboard navigation and the existing test hooks), the star, the `···` menu and a LIVE chip. Clicking the pill or the wallpaper opens the workspace. Stats, visibility and the primary published host sit in a caption under the tile.
4. **Pinned cards on tiles.** The card menu pins a card to its workspace (up to four) and picks how it shows: fitted, embedded, isolated or edit. The tile collages its pins on a 900px design canvas zoomed to the tile, so each card lays itself out at a real size and the tile shows a miniature. Page formats get a second zoom to the width their templates expect. With pins, the wallpaper behind them is dimmed (not blurred) so the cards read as the content. Each pin opens its card.
5. **A greeting and section counts** above Favorites, Your Workspaces and Catalogs.

## Key decisions

- **The rail lives in `submode-layout.gts`, next to the wordmark it belongs to.** The wordmark is a disabled button while the chooser is open with no stacks, and disabled buttons don't fire mouse events reliably, so the hover listens on a wrapper. Clicking the wordmark in that state toggles the rail, which gives keyboard and touch users a way in.
- **Layering:** the rail sits above the chooser (z 200) and below the search sheet (300) and top bar (700), so the wordmark and search button keep their exact live positions (40px controls, `--operator-mode-spacing` inset).
- **Persistence uses Matrix account data**, the same pattern as workspace favorites: one key, `app.boxel.dashboard`, holding the onboarding flags and the pins (realm URL → card ID and format). Writes read the server copy and merge, and the account-data listener keeps other tabs in sync. The mock matrix client supports the key so tests can seed it.
- **No card code loads for the dashboard's card previews.** Pinned cards render from the index's prerendered HTML in their chosen format, the path search recents already use. `edit` is not prerendered, so edit pins hydrate the card.
- **Keyboard navigation is unchanged.** New sections don't join the tile `data-nav-index` sequence; they are ordinary tab stops.

## Tests

Acceptance tests in the style of `tests/acceptance/workspace-chooser-test.gts`: the rail opens from the wordmark and lists sessions and catalogs; Get started ticks from seeded state and stays dismissed; pinning from the card menu shows the pin on the tile. Existing chooser tests must pass unchanged.

## Out of scope

Invitations, activity attribution, nudges, live agent status, persona layouts, a Recent section (search already lists recent cards), a Since your last visit section.
