# Submission Card Portal

## Overview

The `SubmissionCardPortal` is an app-level card that displays a prerendered grid of `SubmissionCard` instances. It lives in the **User Realm** (`/submissions/`) and serves as the user's personal submission tracker — showing the status of all their submitted catalog listings.

The portal hides all GitHub technical details. Users care about *"Did my submission pass?"*, not *"What is the PR number?"*.

---

## System Architecture

```
[ GitHub Repo ]
      ↓  (webhook)
[ PR Card ]  ──────────── Data Source Realm  (read-only, auto-generated, no user access)
      ↓  (referenced by)
[ Submission Card ] ───── User Realm /submissions/  (user can create, delete, archive)
      ↓
[ Submission Portal ] ─── User Realm /submissions/  (lists all submission cards)
```

### Data Source Realm — PR Card

| Property | Value |
|----------|-------|
| Location | Data Source Realm (backend) |
| Driven by | GitHub webhook events |
| User access | Read-only — cannot be edited, deleted, or mutated |
| Purpose | Reflects the raw GitHub PR state |

### User Realm — Submission Card + Portal

| Property | Value |
|----------|-------|
| Location | `/submissions/` realm |
| User access | Create, delete, archive |
| Purpose | User-facing status view of their submission |
| Note | Deleting a Submission Card does **not** delete the PR — it only removes the reference |

---

## Realm Location

Both files belong in the `/submissions/` realm, not the catalog realm:

```
submission-card/
├── README.md                         ← this file
├── submission-card-portal.gts        ← portal app card  →  /submissions/
└── submission-card.gts               ← submission card  →  /submissions/
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
| Status pill | Yes | `pending` / `open` / `merged` / `closed` / `changes_requested` |
| Submitted date | Yes | `createdAt` timestamp |
| Pass / Reject indicator | Yes | Derived from `status` |
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
| `status` | `StringField` | `pending` \| `open` \| `merged` \| `closed` \| `changes_requested` — updated by webhook |
| `createdAt` | `DatetimeField` | When the submission was created |

### Computed Field Notes

- **`cardTitle`** — read-only, auto-derived from the linked listing.
- **`githubURL`** — read-only, auto-derived from `branchName`. Each `/`-separated segment is individually `encodeURIComponent`-encoded.
- **`status`** — written by the webhook/bot, not by the user directly.

### Edge Cases

| Scenario | Behaviour |
|----------|-----------|
| No submissions yet | Portal shows empty state UI |
| `listing` deleted | `cardTitle` falls back to `'Untitled Submission'` |
| `branchName` empty | `githubURL` returns `undefined` — hide link in fitted card |
| `allFileContents` empty | Hide file count badge |
| Submission deleted | PR still exists on GitHub — only the reference is removed |
| `status` is `merged` | Show green "Approved" pill |
| `status` is `closed` / `changes_requested` | Show red "Rejected" pill |

---

## Portal — Card Structure

### SubmissionCardPortal Fields

| Field | Type | Description |
|-------|------|-------------|
| `title` | `StringField` | Portal display name |
| `description` | `StringField` | Short description shown in the header |

> The portal queries all `SubmissionCard` instances dynamically — it does **not** use `linksTo` or `containsMany`.

---

## Portal — Isolated Template Layout

```
┌──────────────────────────────────────────────────────────┐
│  Header                                                  │
│  Title: "Submissions"                                    │
│                                                          │
│  [ Search by listing name or title...  ]  [Grid][Strip]  │
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

Filters by `listing.name` or `listing.cardTitle` using a text input in the portal header.

```ts
get query() {
  const baseFilter = {
    type: { module: `${this.realmHref}submission-card`, name: 'SubmissionCard' },
  };

  if (!this.searchText) {
    return { filter: baseFilter };
  }

  return {
    filter: {
      every: [
        baseFilter,
        {
          any: [
            { contains: { 'listing.name': this.searchText } },
            { contains: { 'listing.cardTitle': this.searchText } },
          ],
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
| `grid` | `repeat(auto-fill, ~164px)` columns | Small square tile |
| `strip` | Full-width single column | Wide horizontal strip |

---

## Portal — Grid Rendering Pattern

```hbs
<@context.prerenderedCardSearchComponent
  @query={{this.query}}
  @format='fitted'
  @realms={{this.realmHrefs}}
  @isLive={{true}}
>
  <:loading>Loading submissions...</:loading>
  <:response as |cards|>
    {{#if (eq this.selectedView 'strip')}}
      <CardsGrid @cards={{cards}} @context={{@context}} class='strip-view' />
    {{else}}
      <CardsGrid @cards={{cards}} @context={{@context}} />
    {{/if}}
  </:response>
</@context.prerenderedCardSearchComponent>
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

### Size 2 — Square tile (default grid, ~164×224px)
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
static icon = SubmissionIcon;
```
