# Icon imports — `@cardstack/boxel-icons`

Boxel ships ~6,400 icons from Lucide + Tabler bundled as Glimmer components. Every `CardDef` and `FieldDef` SHOULD set `static icon = SomeIcon` so the card type renders with a recognizable badge in the chooser, the cards-grid, and editor breadcrumbs.

## ⚠️ CDN verification is the only proof an icon exists

**Workspace source-file grep is NOT proof.** Source files can reference icons that were deployed and later removed, copied from other sources, or never shipped to the CDN. Examples caught the hard way: `file-signature` appears in many `.gts` files across the workspace but returns 403 from the CDN.

**Always probe before assigning:**

```sh
ICON="<icon-name>"
curl -s -o /dev/null -w "%{http_code}\n" \
  "https://boxel-icons.boxel.ai/@cardstack/boxel-icons/v1/icons/${ICON}.js"
# 200 → safe. 403/404 → DO NOT USE, pick another.
```

Batch-verify a candidate set before any icon push:

```sh
for icon in palette tree-pine hammer receipt home pen-tool layout-template; do
  code=$(curl -s -o /dev/null -w "%{http_code}" \
    "https://boxel-icons.boxel.ai/@cardstack/boxel-icons/v1/icons/${icon}.js")
  printf "  %-20s HTTP %s\n" "$icon" "$code"
done
```

A `.gts` with a phantom icon import compiles and lints clean. The host fails at render time with a `403 Access Denied` (XML body) from the CDN.

## Import shape

```ts
import FolderIcon from '@cardstack/boxel-icons/folder';   // default import only
```

Then:

```ts
export class Project extends CardDef {
  static icon = FolderIcon;
  // ...
}
```

## Naming convention (the most common source of 404s)

Icons use **Lucide / Tabler kebab-case**, **descriptor-first** when there's a container shape:

| ✅ Correct | ❌ Wrong (404) |
|---|---|
| `square-check` | `check-square` |
| `circle-check` | `check-circle` |
| `square-user` | `user-square` |
| `circle-plus` | `plus-circle` |
| `arrow-up-right` | `arrow-upper-right` |
| `chevron-down` | `arrow-chevron-down` |

The pattern is **`<container>-<inner>`** when an icon is built around a shape (square/circle/badge/box) — Lucide's convention, not the English word order. If you guess "check-square" because that's how it reads in English, you'll 404. Lucide names it `square-check`.

When in doubt, treat the import as untrusted and verify against the published list.

## How to verify before importing

**🔴 The CDN is the source of truth, not the monorepo.** The host loads icons at runtime from `https://boxel-icons.boxel.ai/@cardstack/boxel-icons/v1/icons/<name>.js`. The local monorepo source (`~/Projects/boxel/packages/boxel-icons/src/icons/`) may have icons that aren't published to the CDN yet — and `check-square` is a real example of this divergence: the source file exists, but the CDN returns 403/404. An agent that imports `check-square` because grep finds it locally will produce a card that 404s in the live app.

**Always verify against the CDN before importing:**

```bash
# Returns 200 if the icon exists, 403/404 if not
curl -sIo /dev/null -w "%{http_code}\n" \
  "https://boxel-icons.boxel.ai/@cardstack/boxel-icons/v1/icons/<name>.js"
```

One-line audit for every icon used in a card:

```bash
# From the card's directory:
grep -hE "@cardstack/boxel-icons/[a-z0-9-]+" *.gts \
  | sed -E "s|.*@cardstack/boxel-icons/([a-z0-9-]+).*|\1|" \
  | sort -u \
  | while read icon; do
      code=$(curl -sIo /dev/null -w "%{http_code}" \
        "https://boxel-icons.boxel.ai/@cardstack/boxel-icons/v1/icons/${icon}.js")
      echo "  $code  $icon"
    done
```

Anything not `200` means the host will 404 the icon at render time — replace it with a verified alternative before pushing.

The local monorepo source is useful for *browsing names* (`ls ~/Projects/boxel/packages/boxel-icons/src/icons/ | grep -i check`) to find candidates, but always confirm against the CDN before committing to one. The Lucide picker at https://lucide.dev/icons/ is also a useful browser — Lucide icon names map to boxel-icons names — but again, verify each pick against the CDN.

**Known CDN gaps (as of 2026-05):**

| Wrong | Right (verified on CDN) |
|---|---|
| `check-square` | `square-check` or `circle-check` |
| `check-circle` | `circle-check` |
| `square-user` (varies by build) | check first; `user-square` if `square-user` 403s |

If a once-working icon starts 404ing in production, the CDN deploy might have dropped it — file an issue and pick a still-published alternative.

## Common icons by card-type

A **starter kit** — not an index. The bundle has ~6,400 icons; this table can't enumerate them. If your domain isn't covered here, search the monorepo:

```sh
ls ~/Projects/boxel/packages/boxel-icons/src/icons/ | grep -i <keyword>
```

…and then CDN-verify your top 1-2 picks per the curl recipe above before committing. Don't paste every match into your card — pick deliberately.

When a category obviously belongs in this starter table but isn't here (a `<keyword>` an agent reasonably reaches for), edit this file and add a row. The starter table is for high-traffic categories that prevent the "I tried `music-note` and `trumpet` and `disco-ball` and gave up" failure mode. It is NOT a complete reference and should not grow to one — at 6,400 icons that's the bundle's job, not this file's. See `.claude/learnings/2026-05-22-boxel-icons-bug-report.md` for the upstream ask (a published manifest at `https://boxel-icons.boxel.ai/.../manifest.json` would replace the grep step).

All entries below verified to exist as of 2026-05.

| Use case | Icon |
|---|---|
| Project / folder / app | `folder`, `folder-open`, `layout-dashboard` |
| Task | `square-check`, `circle-check`, `list-todo`, `clipboard-list` |
| Person / user | `user`, `users`, `square-user`, `circle-user` |
| Email / contact | `mail`, `at-sign`, `phone` |
| Calendar / time | `calendar`, `calendar-check`, `clock`, `timer` |
| Notes / writing | `notebook`, `notebook-pen`, `sticky-note`, `pencil`, `file-text` |
| Tag / label | `tag`, `tags`, `bookmark` |
| Settings / config | `settings`, `sliders-horizontal`, `cog` |
| Status | `circle-check` (good), `circle-x` (bad), `circle-alert` (warn), `circle-dot` (active) |
| Movement / arrows | `arrow-right`, `chevron-right`, `chevrons-right` |
| Currency / finance | `dollar-sign`, `wallet`, `landmark`, `chart-line` |
| Travel | `map`, `map-pin`, `plane`, `car`, `train`, `compass` |
| Food / recipe | `chef-hat`, `cake`, `utensils`, `coffee` |
| Books / library | `book`, `book-open`, `library` |
| Media | `film`, `image`, `music`, `headphones` |
| Music / instruments | `mic`, `microphone`, `microphone-2`, `music`, `music-2`, `music-3`, `music-4`, `guitar`, `guitar-pick`, `drum`, `drumstick`, `keyboard-music`, `list-music`, `file-music`, `disc`, `disc-2` |
| Festival / events | `mic`, `music`, `calendar`, `calendar-event`, `sparkles`, `party-popper`, `confetti`, `ticket`, `map-pin` |
| Sparkles / AI | `sparkles`, `wand`, `bot`, `cpu` |
| Shopping | `shopping-basket`, `shopping-cart`, `receipt`, `package` |

## Decision flow when an icon import fails

```
404 on import?
│
├── Did you guess the name? → Try descriptor-first form (square-X, circle-X)
│
├── Did you spell it? → Confirm in src/icons/ directory listing
│
└── Sure it exists but still fails? → Check the version pinned in package.json
    (older host builds ship a subset; mainline has the full Lucide + Tabler set)
```

## Where icons live in templates

**Card / Field type icons:** `static icon = MyIcon;` on the class. Auto-rendered by the host in choosers, code-mode, the grid view.

**Inline icons in templates:** use `<SomeIcon />` directly (they're Glimmer components). Don't import as static class properties for inline use — that's a category mismatch.

```hbs
<template>
  <span class='task-status'>
    <CircleCheckIcon class='status-icon' />
    Done
  </span>
</template>
```

## Anti-patterns

- ❌ Hand-rolling SVGs in templates when a Lucide icon already exists (see Project example — the original used inline `<svg>` for calendar and user icons when `calendar` and `user` icons are available).
- ❌ Mixing icon libraries — Boxel includes Lucide + Tabler; reach outside only if absolutely necessary.
- ❌ Putting icon imports at the bottom of the import block (visual scanning is easier with all `@cardstack/boxel-icons/*` together).

**Source:** the boxel monorepo's `packages/boxel-icons/src/icons/*.gts` (one file per icon).

## Validate icon imports — lint isn't enough

Boxel icon imports can **pass `.gts` lint while failing at host runtime** if the icon module doesn't exist on the icon CDN. The TS imports look fine because they're just URL references; the failure surfaces only when the host tries to fetch the icon module and gets a 403 from the CDN.

Failure mode: `@cardstack/boxel-icons/person-circle` lints clean, the card saves, the host tries to render it, and the icon CDN returns `403 AccessDenied` (XML). The host surfaces `static icon of MyCard is undefined` and the card renders without its icon.

Validate before relying on a generated icon name:

```bash
curl -sSI https://boxel-icons.boxel.ai/@cardstack/boxel-icons/v1/icons/<name>.js
```

A healthy icon module returns `200` and exports a default component. A missing or private icon path returns `403` XML from S3/CloudFront.

**For agents**: either use a short allowlist of verified icon names (the most common Lucide/Tabler names: `user`, `check`, `circle-check`, `arrow-up`, `calendar`, `clock`, `file`, `folder`, `tag`, `star`, etc.) or probe the CDN URL for every generated icon import before saving. Don't assume every Lucide-style name in the CDN URL pattern actually exists.
