---
validated: source-proven
---

# integrate-screenshot-card-format — Capture a settled PNG of any card at `isolated` or `embedded` format

**What this gives you:** A reliable way for one card to take a *picture* of another card — at the format you choose — and get back a served URL for the capture. The realm-server drives Puppeteer through the prerender pool to capture a fully-settled render (after data loads, animations resolve, layout completes), so the snapshot reflects what a user would see, not a half-loaded skeleton.

**Sibling pattern:** [`integrate-thumbnail-card-ai`](../integrate-thumbnail-card-ai/README.md) — for **AI-generated** stylised thumbnails (designed icons, brand-mark tiles, catalog hero images). Use that when the user wants a *designed representation* of a card; use **this** pattern when the user wants the *actual rendering*. The catalog's `listing-create.autoGenerateThumbnail` uses the AI sibling; doc/audit/Open-Graph flows want this one.

**When to use:**
- **Documentation cards / changelogs / before-after diffs** — snapshot a card at a point in time.
- **Social-share cards / Open Graph images** — render a designed `embedded` format, screenshot it, serve as `og:image`.
- **Marketing pages, design-system snapshots, portfolio captures** — programmatically render card galleries.
- **Audit / approval trails** — capture the visible state when a workflow card transitions.
- **AI assistant** — let the model take a screenshot of a card and fetch the served URL to inspect (and improve) the render.

**The insight:** `ScreenshotCardCommand` (from `@cardstack/boxel-host/tools/screenshot-card`) is a Boxel host command that orchestrates the realm-server screenshot job end-to-end. You pass the target card (as a `linksTo` reference), a format string, and optionally a few capture-tuning primitives; you get back a `captures` array. Each capture has a served `url` you can render straight into an `<img>` or hand to another card. The realm-server enqueues the job, the worker drives a Puppeteer browser through the prerender pool, and the capture is persisted to the media cache — the tool no longer writes a PNG file into a realm. When the tool runs inside the AI assistant, the served URL is posted into the room, where it renders inline and the model can fetch it.

## Recipe shape

```ts
import ScreenshotCardCommand from '@cardstack/boxel-host/tools/screenshot-card';

// Inside an @action method:
let result = await new ScreenshotCardCommand(commandContext).execute({
  card,                  // the linked CardDef instance to screenshot
  format: 'isolated',    // 'isolated' or 'embedded' — nothing else
});

this.imageUrl = result.captures?.[0]?.url ?? null;
// Now render directly:
//   <img src={{this.imageUrl}} />
```

The full demo card (`example.gts`) wraps this in a CardDef that:
- Holds the target via `@field card = linksTo(CardDef)`.
- Holds the format via `@field format = contains(enumField(StringField, { options: ['isolated', 'embedded'] }))`.
- Owns `@tracked isRunning`, `@tracked errorMessage`, `@tracked imageUrl` for UI state.
- Disables the action button until `commandContext` is available and a card is linked.

## API surface

| Input field | Type | Required | Notes |
|---|---|---|---|
| `card` | `linksTo(CardDef)` | yes | Must already be saved — the command needs a card id. |
| `format` | `'isolated' \| 'embedded'` | yes | **No other values accepted.** Fitted / atom / edit / markdown will throw. |
| `viewportWidth` / `viewportHeight` | `number` | no | Viewport size in CSS px. Provide **both** or neither. |
| `deviceScaleFactor` | `number` | no | Retina/hi-dpi multiplier (≤ 3). |
| `fullPage` | `boolean` | no | Capture the whole scrollable document. Mutually exclusive with `clip`. |
| `clipX` / `clipY` / `clipWidth` / `clipHeight` | `number` | no | Crop to a region. Provide **all four** or none. |

Every capture field is a JSON primitive, deliberately: the headless `run-command` input path builds the input via `new InputType(rawJson)`, which resolves `linksTo` ids to card instances but cannot construct a nested `contains(SomeFieldDef)` from a plain JSON object — so the nested `captureSpec` the endpoint accepts is flattened into primitive fields the tool reassembles. The geometry fields are all part of the capture's canonical identity, so a capture carrying any of them still persists and serves under its own durable URL.

| Output field | Type | Notes |
|---|---|---|
| `captures` | `ScreenshotCapture[]` | One entry per capture. |
| `captures[].url` | `string` | The durable served media-cache URL — the only reference the tool returns. A re-capture rotates its bytes, never the URL. The geometry (if any) rides in the query string. |
| `captures[].width` / `.height` | `number` | Reported pixel dimensions. |

## How the realm-server does the work

1. `ScreenshotCardCommand.run()` POSTs `{ realmURL, cardId, format, includeBase64: false, captureSpec? }` to `/_screenshot-card` on the realm-server, authenticated with the card realm's JWT.
2. The handler (`packages/realm-server/handlers/handle-screenshot-card.ts`) answers from the media-cache ledger when the capture already exists, else enqueues a `screenshot-card` job.
3. The worker task (`runtime-common/tasks/screenshot-card.ts`) drives Puppeteer through the prerender pool to render the card at the requested format and geometry.
4. Puppeteer waits for the page to settle (data loads, animations, font swap, prerender hooks) before capturing.
5. The capture — format-only or with geometry — is persisted to the media cache under its full capture identity (format + `viewport` / `deviceScaleFactor` / `fullPage` / `clip`), and the response carries its served `url`.

You don't see any of this from the consumer side — `await new ScreenshotCardCommand(ctx).execute({ card, format })` returns when the capture is ready.

## Wire as a card menu item

To make "Screenshot this card" a right-click affordance on every CardDef, compose with the [`link-command-menu-item`](../link-command-menu-item/README.md) pattern. The action body calls `ScreenshotCardCommand` with `this` as the card and a fixed format (or branches on a sub-menu):

```ts
import { getCardMenuItems, type GetCardMenuItemParams, type MenuItemOptions } from '@cardstack/runtime-common';
import ScreenshotCardCommand from '@cardstack/boxel-host/tools/screenshot-card';
import CameraIcon from '@cardstack/boxel-icons/camera';

class MyCard extends CardDef {
  [getCardMenuItems](params: GetCardMenuItemParams): MenuItemOptions[] {
    return [
      {
        label: 'Screenshot isolated',
        icon: CameraIcon,
        action: async () => {
          let result = await new ScreenshotCardCommand(params.commandContext)
            .execute({ card: this as any, format: 'isolated' });
          // Optionally show toast with result.captures[0]?.url
        },
      },
      {
        label: 'Screenshot embedded',
        icon: CameraIcon,
        action: async () => {
          await new ScreenshotCardCommand(params.commandContext)
            .execute({ card: this as any, format: 'embedded' });
        },
      },
      ...super[getCardMenuItems](params),
    ];
  }
}
```

This gives every instance of `MyCard` two menu items that capture a settled PNG of itself — without needing a dedicated demo card.

## Gotchas

- **Format is restricted to `isolated` or `embedded`.** `fitted`, `atom`, `edit`, `markdown` will throw. The reason: only those two formats have stable browser-viewport semantics; fitted is container-driven and needs an explicit size envelope that the command doesn't expose.
- **Target card must be saved.** The command needs a card id. If you're in a draft / pre-save flow, save first.
- **Read access, not write.** The command reads the target card and captures it; it no longer writes a file back. If the current user can't read the target's realm, it fails fast.
- **Geometry captures are URL-served too.** Supplying `viewport*` / `deviceScaleFactor` / `fullPage` / `clip*` is part of the capture's canonical identity, so the capture persists and comes back with its own `captures[].url` (the geometry encoded in the query string) — no base64, no special-casing versus a format-only capture.
- **Paired fields are all-or-nothing.** Provide both `viewportWidth` and `viewportHeight`, or all four `clip*` edges — a half-specified viewport or region throws with a clear message.
- **Long renders can time out to a retry.** The realm-server waits for the job within a bounded budget; a slow render answers `503` with a `Retry-After`, which the command surfaces as a "still rendering; retry" error. A canonical capture resumes cheaply on retry (ledger hit); a custom spec re-renders.
- **commandContext must exist.** Only available in host interact mode — the prerenderer / SSR context doesn't have a live host. Feature-detect with `this.args.context?.commandContext` before calling.
- **`listing-create` does not use this command.** The catalog's listing-creation flow uses `GenerateThumbnailCommand` (AI-generated stylized icon, not a real screenshot). Use `ScreenshotCardCommand` when you want the actual rendered card, not an interpretation.

## Source

- Host command: `@cardstack/boxel-host/tools/screenshot-card` — `packages/host/app/tools/screenshot-card.ts` in the boxel monorepo.
- Realm-server endpoint: `POST /_screenshot-card` → `packages/realm-server/handlers/handle-screenshot-card.ts`.
- Worker task: `packages/runtime-common/tasks/screenshot-card.ts`.
- Capture spec (bounds + strict parse): `packages/runtime-common/capture-spec.ts`.
- Input/output types: `ScreenshotCardInput` / `ScreenshotCardOutput` in `packages/base/command.gts`.
- Proven example: `packages/experiments-realm/screenshot-card-demo.gts` — copied verbatim into this pattern's `example.gts`.

## See also

- [`integrate-thumbnail-card-ai`](../integrate-thumbnail-card-ai/README.md) — **paired sibling**: AI-generated thumbnails (`GenerateThumbnailCommand`) instead of real rendered captures.
- [`link-command-menu-item`](../link-command-menu-item/README.md) — wire screenshot capture as a card menu action.
- [`integrate-filedef-generated-image`](../integrate-filedef-generated-image/README.md) — the storage half of any generated-media workflow; explains how `WriteBinaryFileCommand` + `ImageDef` / `PngDef` compose with binary outputs.
- [`integrate-openrouter-image-generation`](../integrate-openrouter-image-generation/README.md) — lower-level OpenRouter image primitive that `GenerateThumbnailCommand` is built on top of.
- [`boxel/references/command-invocation-modes.md`](../../../boxel/references/command-invocation-modes.md) — the wider taxonomy of how to expose a Command.
