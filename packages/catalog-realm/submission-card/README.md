# Submission Card Portal

## Overview

A `SubmissionCard` is an index card that records a single listing submission. It lives in the **same workspace realm where the user was working on that listing** — wherever that listing PR originated from.

The `SubmissionCardPortal` is an app-level card that aggregates all submission cards across the user's realms into a single view. It can live anywhere; it is currently placed in the catalog realm as a temporary home.

The portal hides all GitHub technical details. Users care about *"Did my submission pass?"*, not *"What is the PR number?"*.

---

## System Architecture

```
[ GitHub Repo ]
      ↓  (webhook)
[ PR Card ]  ──────────── Data Source Realm  (read-only, auto-generated, no user access)
      ↓  (referenced by)
[ Submission Card ] ───── Same realm the user submitted the listing PR from
      ↓  (aggregated by)
[ Submission Portal ] ─── Anywhere (currently: catalog realm, temporary)
```

### Data Source Realm — PR Card

| Property | Value |
|----------|-------|
| Location | Data Source Realm (backend) |
| Driven by | GitHub webhook events |
| User access | Read-only — cannot be edited, deleted, or mutated |
| Purpose | Reflects the raw GitHub PR state |

### User Realm — Submission Card

| Property | Value |
|----------|-------|
| Location | The realm the user submitted the listing PR from |
| User access | Create, delete, archive |
| Purpose | Index card recording the user's submission and its status |
| Note | Deleting a Submission Card does **not** delete the PR — it only removes the reference |

### Submission Portal

| Property | Value |
|----------|-------|
| Location | Anywhere — currently catalog realm (temporary) |
| Queries | Only the user's own submissions, across their realms |
| Realm scope | User-selectable — can toggle which of their realms to include |

---

## Code Location

Both card definitions live in the catalog realm:

```
submission-card/
├── README.md                         ← this file
├── submission-card-portal.gts        ← portal app card  (currently: catalog realm)
└── submission-card.gts               ← submission card  (instances: user's own realm)
```

---

## Submission Card — Permissions

| Action | Allowed | Notes |
|--------|---------|-------|
| Create | Yes | Auto-created when user triggers PR submission |
| Delete | Yes | Removes reference only — PR still exists on GitHub |
| Archive | Yes | |
| Edit user fields | Partial | Only user-facing fields; `branchName` and `githubURL` are computed |
| Edit PR Card | No | PR Card lives in read-only Data Source Realm |

---

## Submission Card — What to Show

Show only user-facing status. **Hide all GitHub technical details.**

| Field | Show | Notes |
|-------|------|-------|
| Listing name | Yes | `listing.name` — primary title |
| Submitted date | Yes | Card generation date (`_createdAt` from card metadata) |
| Branch name | Optional | Secondary, small label |
| GitHub PR link | Optional | Icon link only |
| Reviewer comments | No | Too technical |
| Commit history | No | Too technical |
| File contents | No | Too technical |

> Users say *"I submitted something"* — not *"I created a PR"*. The card reflects submission state, not GitHub internals.

---

## SubmissionCard Schema

### FileContentField

| Field | Type | Description |
|-------|------|-------------|
| `filename` | `StringField` | Name of the submitted file |
| `contents` | `StringField` | Raw file contents |

### SubmissionCard

| Field | Type | Description |
|-------|------|-------------|
| `cardTitle` | `StringField` (computed) | Derived from `listing.name` or `listing.cardTitle`, falls back to `'Untitled Submission'` |
| `roomId` | `StringField` | Matrix room ID used for bot status updates |
| `branchName` | `StringField` | GitHub branch name for the submitted PR |
| `githubURL` | `StringField` (computed) | Built from `branchName` using `GITHUB_BRANCH_URL_PREFIX` + URL-encoded segments |
| `listing` | `linksTo(Listing)` | The catalog listing being submitted |
| `allFileContents` | `containsMany(FileContentField)` | All files included in the PR submission |

### Computed Field Notes

- **`cardTitle`** — read-only, auto-derived from the linked listing.
- **`githubURL`** — read-only, auto-derived from `branchName`. Each `/`-separated segment is individually `encodeURIComponent`-encoded.

### Edge Cases

| Scenario | Behaviour |
|----------|-----------|
| No submissions yet | Portal shows empty state UI |
| `listing` deleted | `cardTitle` falls back to `'Untitled Submission'` |
| `branchName` empty | `githubURL` returns `undefined` — hide link in fitted card |
| `allFileContents` empty | Hide file count badge |
| Submission deleted | PR still exists on GitHub — only the reference is removed |

---

## Portal — Card Structure

### SubmissionCardPortal Fields

| Field | Type | Description |
|-------|------|-------------|
| `title` | `StringField` | Portal display name |
| `description` | `StringField` | Short description shown in the header |

> The portal queries `SubmissionCard` instances dynamically across the user's realms — it does **not** use `linksTo` or `containsMany`.

---

## Portal — Realm Scope

Because `SubmissionCard` instances can live in any of the user's workspaces, the portal must query across multiple realms. The intended design is:

- Default: query **all of the user's realms**
- UI: a realm toggle/filter so the user can narrow to a specific workspace

**Implementation:** The portal uses `commandData` + `GetAllRealmMetasCommand` to load all writable user realms. It queries all of them by default. When the user selects specific realms via the toggle pills, only those realms are queried. While realm data is loading, the portal falls back to its own realm URL (`this.args.model[realmURL]`).

---

## Portal — Isolated Template Layout

```
┌──────────────────────────────────────────────────────────┐
│  Header                                                  │
│  Title: "Submissions"                                    │
│                                                          │
│  [ Search by card title...  ]                [Grid][Strip] │
│  [■ Realm A] [□ Realm B] [□ Realm C]  ← shown when 2+   │
├──────────────────────────────────────────────────────────┤
│  Grid (default)                                          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                 │
│  │Submission│ │Submission│ │Submission│                 │
│  │  Card    │ │  Card    │ │  Card    │                 │
│  │ (fitted) │ │ (fitted) │ │ (fitted) │                 │
│  └──────────┘ └──────────┘ └──────────┘                 │
├──────────────────────────────────────────────────────────┤
│  Strip (alternate view)                                  │
│  ┌────────────────────────────────────────────────────┐  │
│  │ Submission Card (fitted — wide strip layout)       │  │
│  └────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────┐  │
│  │ Submission Card (fitted — wide strip layout)       │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

---

## Portal — Search Functionality

Filters by `cardTitle` (the computed title on `SubmissionCard`) using a text input in the portal header. Input is debounced 300ms.

```ts
get query() {
  const baseFilter = {
    type: {
      module: new URL('./submission-card', import.meta.url).href,
      name: 'SubmissionCard',
    },
  };

  if (!this.searchText) {
    return { filter: baseFilter };
  }

  return {
    filter: {
      every: [
        baseFilter,
        {
          any: [{ contains: { cardTitle: this.searchText } }],
        },
      ],
    },
  };
}
```

---

## Portal — View Switcher (Grid vs Strip)

| View | Layout | Fitted card size |
|------|--------|-----------------|
| `grid` | `repeat(auto-fill, 300px)` columns | `300×380px` tile |
| `strip` | Full-width single column (`1fr`) | `120px` tall strip |

---

## Portal — Grid Rendering Pattern

Uses the `CardList` base component which handles live querying, loading state, and grid/strip layout via `@viewOption`.

```hbs
<CardList
  @query={{this.query}}
  @realms={{this.realmHrefs}}
  @format='fitted'
  @viewOption={{this.selectedView}}
  @context={{@context}}
  @isLive={{true}}
/>
```

CSS overrides size the list items so fitted container queries resolve correctly:

```css
/* grid view */
.portal-content :deep(.grid-view) {
  --item-width: 300px;
  --item-height: 380px;
}

/* strip view */
.portal-content :deep(.strip-view) {
  --item-height: 120px;
  grid-template-columns: 1fr;
}
```

---

## SubmissionCard — Fitted Template Sizes

Fitted cards define multiple layouts using `@container fitted-card` queries.

### Size 1 — Tiny badge (`height <= 58px`)
```
┌──────────────────────┐
│ [icon] Title         │
└──────────────────────┘
```
Show: icon + `cardTitle` only.

### Size 2 — Square tile (default grid, `300×380px`)
```
┌──────────────┐
│ [icon]       │
│ Title        │
│ listing name │
│ [status pill]│
└──────────────┘
```
Show: icon, `cardTitle`, `listing.name`, status pill.

### Size 3 — Wide strip (`aspect-ratio > 2.0`, `height < 115px`)
```
┌────────────────────────────────────────────────────────┐
│ [icon]  Title     listing name    [status pill]   [→]  │
└────────────────────────────────────────────────────────┘
```
Show: icon, `cardTitle`, `listing.name`, status pill, GitHub link icon.

---

## Static Config

```ts
static displayName = 'Submission Card Portal';
static prefersWideFormat = true;
static headerColor = '#e5f0ff';
static icon = BotIcon; // from @cardstack/boxel-icons/bot
```
