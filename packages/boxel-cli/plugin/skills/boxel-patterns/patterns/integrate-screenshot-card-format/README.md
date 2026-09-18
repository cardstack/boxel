---
validated: source-proven
---

# integrate-screenshot-card-format — Capture a settled PNG of any card at `isolated` or `embedded` format

**What this gives you:** A reliable way for one card to take a *picture* of another card — at the format you choose — and get back a durable served URL for the PNG. The realm-server drives Puppeteer through the prerender pool to capture a fully-settled render (after data loads, animations resolve, layout completes), so the snapshot reflects what a user would see, not a half-loaded skeleton.

**Sibling patterns:** [`automate-declared-screenshots`](../automate-declared-screenshots/README.md) — declarative, **self-refreshing** capture slots on the card class itself (thumbnails, og images, poster frames that re-capture on every edit). Prefer that whenever the card should *always* carry a current picture of itself; use **this** pattern for a *point-in-time* capture you keep a URL to (documentation, audit/before-after trails). [`integrate-thumbnail-card-ai`](../integrate-thumbnail-card-ai/README.md) — for **AI-generated** stylised thumbnails (designed icons, brand-mark tiles, catalog hero images) when the user wants a *designed representation* rather than any actual rendering; the catalog's `listing-create.autoGenerateThumbnail` uses it.

**When to use:**
- **Documentation cards / changelogs / before-after diffs** — snapshot a card at a point in time, keep the served URL on the doc.
- **Social-share cards / Open Graph images** — render a designed `embedded` format, screenshot it, serve as `og:image`.
- **Marketing pages, design-system snapshots, portfolio captures** — programmatically render card galleries.
- **Audit / approval trails** — capture the visible state when a workflow card transitions.
- **Test fixtures** — anywhere a `.png` of a real render beats a hand-curated mock.

**The insight:** `ScreenshotCardTool` (from `@cardstack/boxel-host/tools/screenshot-card`) is a Boxel host tool that orchestrates the realm-server screenshot job end-to-end. You pass two inputs — the target card (as a `linksTo` reference) and a format string — and you get back a `captures` list whose first entry's `url` you can render straight into an `<img>`. The realm-server enqueues the job, the worker drives a Puppeteer browser through the prerender pool, and the PNG is persisted to the **media cache** under the capture's canonical identity (card URL × format × geometry × the card's index generation). Nothing is written into any realm; cards never see the bytes, you get a clean served URL.

## Recipe shape

```ts
import ScreenshotCardTool from '@cardstack/boxel-host/tools/screenshot-card';

// Inside an @action method:
let result = await new ScreenshotCardTool(toolContext).execute({
  card,                  // the linked CardDef instance to screenshot
  format: 'isolated',    // 'isolated' or 'embedded' — nothing else
});

this.screenshotUrl = result.captures?.[0]?.url ?? null;
// Render directly:
//   <img src={{this.screenshotUrl}} />
// The URL is a served media-cache URL, not a realm file — there is no
// ImageDef / PngDef instance behind it to link to.
```

The full demo card (`example.gts`) wraps this in a CardDef that:
- Holds the target via `@field card = linksTo(CardDef)`.
- Holds the format via `@field format = contains(enumField(StringField, { options: ['isolated', 'embedded'] }))`.
- Owns `@tracked isRunning`, `@tracked errorMessage`, `@tracked screenshotUrl` for UI state.
- Disables the action button until `toolContext` is available and a card is linked.

## API surface

| Input field | Type | Required | Notes |
|---|---|---|---|
| `card` | `linksTo(CardDef)` | yes | Must already be saved — the command needs a card id. |
| `format` | `'isolated' \| 'embedded'` | yes | **No other values accepted.** Fitted / atom / edit / markdown will throw. |

| Output field | Type | Notes |
|---|---|---|
| `captures` | `{ url, … }[]` | One entry per capture; `captures[0].url` is the durable served media-cache URL of the PNG. Render with `<img src={{...}} />`. Also carries `name`, `width`, `height`. |

## How the realm-server does the work

1. `ScreenshotCardTool.run()` checks the current user can **read** the target card's realm, then POSTs `{ realmURL, cardId, format }` to `/_screenshot-card` on the realm-server with that realm's session token.
2. The handler (`packages/realm-server/handlers/handle-screenshot-card.ts`) answers straight from the media-cache ledger if this exact capture already exists; otherwise it enqueues a `screenshot-card` job via the queue system.
3. The worker task (`runtime-common/tasks/screenshot-card.ts`) drives Puppeteer through the prerender pool to render the card at the requested format.
4. Puppeteer waits for the page to settle (data loads, animations, font swap, prerender hooks) before capturing.
5. The worker persists the PNG to the **media cache** under the capture's canonical identity and the handler responds with `captures[].url`, the durable served URL. No realm file is created and nothing is indexed.
6. If the render outlasts the HTTP wait the handler replies `503` with `Retry-After`; the job still finishes and persists, so a retry is a pure ledger hit.

You don't see any of this from the consumer side — `await new ScreenshotCardTool(ctx).execute({ card, format })` returns when the capture is servable.

## Wire as a card menu item

To make "Screenshot this card" a right-click affordance on every CardDef, compose with the [`link-command-menu-item`](../link-command-menu-item/README.md) pattern. The action body calls `ScreenshotCardTool` with `this` as the card and a fixed format (or branches on a sub-menu):

```ts
import { getMenuItems } from '@cardstack/runtime-common';
import { type GetMenuItemParams } from '@cardstack/base/card-api';
import { type MenuItemOptions } from '@cardstack/boxel-ui/helpers';
import ScreenshotCardTool from '@cardstack/boxel-host/tools/screenshot-card';
import CameraIcon from '@cardstack/boxel-icons/camera';

class MyCard extends CardDef {
  [getMenuItems](params: GetMenuItemParams): MenuItemOptions[] {
    return [
      {
        label: 'Screenshot isolated',
        icon: CameraIcon,
        action: async () => {
          let result = await new ScreenshotCardTool(params.toolContext)
            .execute({ card: this as any, format: 'isolated' });
          // Optionally show toast with result.captures[0].url
        },
      },
      {
        label: 'Screenshot embedded',
        icon: CameraIcon,
        action: async () => {
          await new ScreenshotCardTool(params.toolContext)
            .execute({ card: this as any, format: 'embedded' });
        },
      },
      ...super[getMenuItems](params),
    ];
  }
}
```

This gives every instance of `MyCard` two menu items that capture a settled PNG of itself into the media cache — without needing a dedicated demo card.

## Gotchas

- **Format is restricted to `isolated` or `embedded`.** `fitted`, `atom`, `edit`, `markdown` will throw. The reason: only those two formats have stable browser-viewport semantics; fitted is container-driven and needs an explicit size envelope that the command doesn't expose.
- **Target card must be saved.** The command needs a card id. If you're in a draft / pre-save flow, save first.
- **Read access is what's checked.** Nothing is written into a realm, so the tool only requires that the current user can read the target card's realm. It fails fast with a clear error otherwise.
- **Output is a media-cache URL, not a realm file.** Don't try to load it as an `ImageDef` / `PngDef` instance or look for it in the realm's file tree. Store the URL string if you need to keep it.
- **The same capture is served, not re-rendered.** Identity is card URL × format × geometry × index generation, so repeating a capture on an unchanged card is a ledger hit; editing the card produces a new capture.
- **Long renders block the request.** The realm-server waits on the job (Puppeteer needs to settle the page) and returns `503` + `Retry-After` if it runs long; the tool surfaces that as an error to retry. On a slow card or under load, expect a few seconds. Wrap in `@tracked isRunning` / show a spinner; don't `await` inside `getMenuItems` without surfacing progress.
- **toolContext must exist.** Only available in host interact mode — the prerenderer / SSR context doesn't have a live host. Feature-detect with `this.args.context?.toolContext` before calling.
- **`listing-create` does not use this command.** The catalog's listing-creation flow uses `GenerateThumbnailCommand` (AI-generated stylized icon, not a real screenshot). Use `ScreenshotCardTool` when you want the actual rendered card, not an interpretation.

## Source

- Host command: `@cardstack/boxel-host/tools/screenshot-card` — `packages/host/app/tools/screenshot-card.ts` in the boxel monorepo.
- Realm-server endpoint: `POST /_screenshot-card` → `packages/realm-server/handlers/handle-screenshot-card.ts`.
- Worker task: `packages/runtime-common/tasks/screenshot-card.ts`.
- Input/output types: `ScreenshotCardInput` / `ScreenshotCardOutput` in `packages/base/command.gts`.
- Proven example: `packages/experiments-realm/screenshot-card-demo.gts` — copied verbatim into this pattern's `example.gts`.

## See also

- [`integrate-thumbnail-card-ai`](../integrate-thumbnail-card-ai/README.md) — **paired sibling**: AI-generated thumbnails (`GenerateThumbnailCommand`) instead of real rendered captures. Same composition surface (file in realm + optional `cardInfo.cardThumbnail` patch).
- [`link-command-menu-item`](../link-command-menu-item/README.md) — wire screenshot capture as a card menu action.
- [`integrate-filedef-generated-image`](../integrate-filedef-generated-image/README.md) — the storage half of any generated-media workflow; explains how `WriteBinaryFileCommand` + `ImageDef` / `PngDef` compose with binary outputs.
- [`integrate-openrouter-image-generation`](../integrate-openrouter-image-generation/README.md) — lower-level OpenRouter image primitive that `GenerateThumbnailCommand` is built on top of.
- [`boxel/references/command-invocation-modes.md`](../../../boxel/references/command-invocation-modes.md) — the wider taxonomy of how to expose a Command.
