# The default index card

Every workspace has a card at its root, `index.json`. Unless you replace it, it adopts `Workspace` from `@cardstack/base/workspace` (`workspace.gts`) — this is what a visitor lands on when they open the workspace with no card selected.

Terminology, because two of these words are easy to collide: **workspace** is the container (the same thing the server-side API calls a realm). The **default index card** is the card sitting at its root. `Workspace` is only the class name you write in `adoptsFrom`.

## What it gives you for free

- **Home** — greeting, a collapsible README hero, pinned tiles for `entryPoints`, browse chips grouped by card type and file type, and a live strip of workspace details (visibility, counts, published sites).
- **Library** — a filter rail (Everything / Entry points / Cards / Files, plus a row per card type and file type with live counts) over the full card-list experience. This is where the older `CardsGrid` view now lives, so nothing is lost by adopting the default.
- **Activity** — a reverse-chronological feed of what changed, grouped by day. Loads only when the tab is opened.
- **Frame** — Cmd+K typeahead search, scoped to this workspace.

Searches are deliberately workspace-scoped. Don't expect the Library or Cmd+K to reach across workspaces.

## Fields you would actually set

Set these on the index card in the workspace's Edit view, or in `index.json`:

| Field | Type | What it does |
| -- | -- | -- |
| `entryPoints` | `linksToMany(CardDef)` | The cards pinned as tiles on Home. **This is the supported way to put a card front-and-centre** — see below. |
| `readme` | `linksTo(MarkdownDef)` | Markdown shown as the Home hero. |
| `signage` | `contains(StringField)` | Short badge in the frame. |
| `purpose` | `contains(StringField)` | One line on what this workspace is for. |
| `showReadme` / `showBrowse` | `contains(BooleanField)` | Toggle the Home modules. |
| `defaultView` | `contains(StringField)` | `'grid'` or `'strip'` — how Library opens. |
| `pinnedSize` | `contains(StringField)` | `'regular'` or `'compact'` — pinned tile size. |
| `moduleOrder` | `contains(StringField)` | CSV ordering of the Home modules (`pinned`, `about`, `browse`). |
| `searchIncludesSystem` | `contains(BooleanField)` | Whether search surfaces system cards. |
| `workspace` | `linksTo(CardDef)` | The workspace's config card. |

## Pinning a card to the root

To make one card the thing a visitor sees first — an app-card home, a dashboard, a landing page — link it from `entryPoints`. It renders as a pinned tile on Home.

Do **not** try to get there by relying on list ordering. Which card appears first in a card list is not a promise, and a card added later can displace you.

If you want the workspace root to *be* that card rather than show a tile for it, replace the adoption in `index.json` instead:

```json
{
  "data": {
    "type": "card",
    "meta": {
      "adoptsFrom": { "module": "./my-home", "name": "MyHome" }
    }
  }
}
```

You then own everything the default index card was doing — there is no partial override.

## Two things that interact with it

- **`static icon`.** The Library rail draws one row per card type keyed off the CardDef's `static icon`. A type without one is the single indistinguishable row in the workspace's main navigation. → [`icons.md`](icons.md)
- **`includePrerenderedDefaultRealmIndex`.** Defaults off in `RealmConfig`: the index card's isolated HTML is skipped during indexing to save wall-clock. Turn it on only if you actually serve the default index card as a published site's `/`. Both `Workspace` and `CardsGrid` are recognized, so the flag behaves the same either way. → [`../../boxel-patterns/patterns/link-host-mode-paths/README.md`](../../boxel-patterns/patterns/link-host-mode-paths/README.md)

## Workspaces still on `CardsGrid`

Workspaces created before `Workspace` became the default adopt `CardsGrid` (or its historical alias `IndexCard`, which is a re-export of the same class). Some also carry a separate `cards-grid.json` instance at the root.

`CardsGrid` remains available and supported — an older workspace is not broken and does not need cleaning up. To move one across, change `index.json`'s `adoptsFrom` to `Workspace` / `@cardstack/base/workspace`; the Library view is the same card list you had.
