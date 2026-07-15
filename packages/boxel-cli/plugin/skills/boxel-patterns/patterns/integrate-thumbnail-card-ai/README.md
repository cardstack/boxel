---
validated: source-proven
---

# integrate-thumbnail-card-ai — Generate an AI thumbnail (and optionally patch `cardInfo.cardThumbnail`) via `GenerateThumbnailCommand`

**What this gives you:** A one-call path for "generate an image to represent this card and store it as a realm file." `GenerateThumbnailCommand` (from `@cardstack/boxel-host/tools/generate-thumbnail`) calls OpenRouter image generation, parses the returned data URL, writes the bytes to the chosen realm via `WriteBinaryFileCommand`, and — if you pass `targetCardId` — automatically patches that card's `cardInfo.cardThumbnail` to link the new `ImageDef`. No manual stitching of the LLM call, the data-URL parser, the binary write, and the relationship patch.

**Sibling pattern:** [`integrate-screenshot-card-format`](../integrate-screenshot-card-format/README.md) — for *actual screenshots* of rendered cards (Puppeteer-driven settled PNG capture). Use that when the user wants a real picture of how the card looks; use **this** pattern when the user wants an AI-designed icon or stylised representation. Most catalog-style "card hero image" flows want this one; doc/audit/Open-Graph flows want the screenshot one.

**When to use:**
- **Catalog listing thumbnails** — the canonical case. `listing-create.ts` calls this command with a prompt like *"Create a square thumbnail for X. Top 70%: large flat icon. Bottom 30%: name in bold uppercase sans-serif."*
- **Theme / brand cards** — auto-generated palette swatches, mood-board tiles, brand-mark thumbnails.
- **Persona / character cards** — auto-generated avatars from a description.
- **Recipe / product cards** — stylised hero images when a real photograph isn't available.
- **Empty-state placeholders** — auto-fill `cardInfo.cardThumbnail` so lists and grids never render naked.

**The insight:** `GenerateThumbnailCommand` composes three primitives into one call:

1. **OpenRouter image generation** via `SendRequestViaProxyCommand` (the realm proxy handles credentials).
2. **Data-URL → realm file** via `WriteBinaryFileCommand` — parses MIME + base64, writes to `<targetRealm>/<targetPath>/<slug>-<uuid>.<ext>`, returns a `fileIdentifier`.
3. **Optional `cardInfo.cardThumbnail` patch** via `PatchCardInstanceCommand` when `targetCardId` is set — wires the new ImageDef into the target card's CardInfo relationship in one step.

You can stop after step 1 (just need the image) or stop after step 2 (write the file but don't auto-patch). Step 3 is the production shape used by `listing-create.autoGenerateThumbnail`.

## Recipe shape

```ts
import GenerateThumbnailCommand from '@cardstack/boxel-host/tools/generate-thumbnail';

// Inside an @action method:
let result = await new GenerateThumbnailCommand(commandContext).execute({
  prompt: `Create a square thumbnail for "${targetCard.title}". Top 70%: large centered flat icon. Bottom 30%: title in bold uppercase. Style: flat vector, solid vivid background, 2–3 colors max.`,
  targetRealmIdentifier: targetCard[realmURL].href,
  targetPath: 'Thumbnails',     // optional — subdirectory inside the realm
  targetCardId: targetCard.id,  // optional — auto-patches cardInfo.cardThumbnail
  cardName: targetCard.title,   // optional — used for filename slug
  // sourceImageUrl: 'https://...',  // optional — reference image for style
  // llmModel: 'google/gemini-2.5-flash-image',  // optional — defaults to Gemini Flash Image
});

// result.imageDefIdentifier is the file URL — render directly:
//   <img src={{result.imageDefIdentifier}} />
// Or, if you didn't pass targetCardId, link it explicitly:
//   target.cardInfo.cardThumbnail = new ImageDef({
//     id: result.imageDefIdentifier,
//     url: result.imageDefIdentifier,
//     sourceUrl: result.imageDefIdentifier,
//   });
```

## API surface

| Input field | Type | Required | Notes |
|---|---|---|---|
| `prompt` | `string` | yes | Text prompt for the AI. The catalog's listing thumbnail prompt is a strong starting template (see "Prompt template" below). |
| `sourceImageUrl` | `string` | no | URL or `data:image/...` reference image to riff on. The command fetches non-data URLs and converts to base64 for the OpenRouter request. |
| `targetRealmIdentifier` | `string` | yes | Realm to write the file to. Usually `targetCard[realmURL].href`. |
| `targetPath` | `string` | no | Subdirectory inside the realm (e.g. `'Thumbnails'`, `'ListingThumbnails'`). Trailing slash trimmed. Omit for realm-root. |
| `targetCardId` | `string` | no | If set, the command patches `cardInfo.cardThumbnail` on this card with `links.self = <new ImageDef URL>`. The single most useful argument — turns a 30-line workflow into one call. |
| `cardName` | `string` | no | Used for filename slug (first two words, lowercased, non-alphanumeric stripped). Falls back to `thumbnail-<uuid>`. |
| `llmModel` | `string` | no | OpenRouter model id. Defaults to `DEFAULT_IMAGE_GENERATION_LLM` (Gemini 2.5 Flash Image at time of writing). Use `'openai/gpt-5-image-mini'` or `'openai/gpt-5.4-image-2'` for ChatGPT-style output. |

| Output field | Type | Notes |
|---|---|---|
| `imageDefIdentifier` | `string` | The file identifier returned by `WriteBinaryFileCommand`. Render directly with `<img src={{...}} />`, or use as the `sourceUrl` for an explicit `ImageDef` assignment if you didn't pass `targetCardId`. |

## How the command works inside

End-to-end flow (from `packages/host/app/tools/generate-thumbnail.ts`):

1. Validates `prompt` (required, non-empty).
2. If `sourceImageUrl` is set and isn't already a data URL, `fetch`es it and converts the response body to a base64 data URL.
3. Builds an OpenRouter chat-completion request: `{ role: 'user', content: [{ type: 'text', text: prompt }, ...optional image_url] }`.
4. Calls OpenRouter via `SendRequestViaProxyCommand`.
5. Extracts the generated data URL from `responseData.choices[0].message.images[].image_url.url` (finds the first `data:image/...` URL).
6. Parses MIME type + base64 from the data URL.
7. Computes filename: `${cardName-slug}-${uuid8}.${ext}` (extension derived from MIME).
8. Writes via `WriteBinaryFileCommand` with `useNonConflictingFilename: true`.
9. If `targetCardId` is set, calls `PatchCardInstanceCommand` to write `cardInfo.cardThumbnail` → `{ links: { self: imageDefIdentifier } }`.
10. Returns `{ imageDefIdentifier }`.

## Reference call pattern

Adapted from the host's former `autoGenerateThumbnail` caller (in the
since-retired `listing-create` command — CS-11372 moved listing commands to
the catalog realm), preserved here as an illustrative caller:

```ts
private async autoGenerateThumbnail(
  listing: CardDef,
  codeRef: ResolvedCodeRef,
  targetRealm: string,
) {
  if (!listing.id) return;
  const prompt = `Create a square thumbnail for "${codeRef.name}". Top 70%: large centered flat icon (simple, bold, minimal, slightly angled/layered if needed). Bottom 30%: "${codeRef.name}" in big, bold, uppercase sans-serif text. Style: flat vector, solid vivid background, 2–3 colors max. Icon should be white or light-colored, clean geometric shapes, highly recognizable. No gradients, no shadows, no borders, no clutter. Must be clear at small sizes.`;

  await new GenerateThumbnailCommand(this.commandContext).execute({
    prompt,
    targetRealmIdentifier: targetRealm,
    targetPath: 'ListingThumbnails',
    targetCardId: listing.id,
    cardName: codeRef.name,
  });
}
```

Notable choices the catalog made:
- **Fire-and-forget.** Wrapped in `.catch(e => console.warn(...))` outside the modal so the user isn't blocked. Worth copying for any "nice-to-have" thumbnail; await it when the thumbnail is part of the critical path.
- **`targetPath: 'ListingThumbnails'`.** All catalog thumbnails wrapped in one folder to keep the realm tidy. Pick a stable folder name per use case.
- **Prompt is highly structured.** "Top 70% / Bottom 30%" composition language, explicit "no gradients / no shadows / no borders" — model output quality on Gemini Flash Image is very sensitive to negative constraints.

## Prompt template (catalog-tested)

Starting template that produces consistent square thumbnails:

```
Create a square thumbnail for "<name>". Top 70%: large centered flat icon
(simple, bold, minimal, slightly angled/layered if needed). Bottom 30%:
"<name>" in big, bold, uppercase sans-serif text. Style: flat vector, solid
vivid background, 2–3 colors max. Icon should be white or light-colored, clean
geometric shapes, highly recognizable. No gradients, no shadows, no borders,
no clutter. Must be clear at small sizes.
```

Vary by:
- **Composition split** — `Top 70% / Bottom 30%` for label-under-icon; full-bleed for hero images; centered for badges.
- **Color directive** — name the realm's brand colors or pull from the theme card.
- **Icon hint** — derive from the card's domain (`luggage tag` for travel, `microscope` for science, etc.).

## Wire as a card menu item

Pair with [`link-command-menu-item`](../link-command-menu-item/README.md) to make "Regenerate thumbnail" a right-click on any card:

```ts
import { getCardMenuItems, type GetCardMenuItemParams, type MenuItemOptions } from '@cardstack/runtime-common';
import GenerateThumbnailCommand from '@cardstack/boxel-host/tools/generate-thumbnail';
import { realmURL } from 'https://cardstack.com/base/card-api';
import WandIcon from '@cardstack/boxel-icons/wand';

class MyCard extends CardDef {
  [getCardMenuItems](params: GetCardMenuItemParams): MenuItemOptions[] {
    return [
      {
        label: 'Generate AI thumbnail',
        icon: WandIcon,
        action: async () => {
          let prompt = /* derive from this.title, theme, or a fixed template */;
          await new GenerateThumbnailCommand(params.commandContext).execute({
            prompt,
            targetRealmIdentifier: this[realmURL]!.href,
            targetPath: 'Thumbnails',
            targetCardId: this.id,
            cardName: this.title,
          });
          // The command auto-patches cardInfo.cardThumbnail, so the card's
          // chrome updates next render — no manual saveCard needed here.
        },
      },
      ...super[getCardMenuItems](params),
    ];
  }
}
```

## Gotchas

- **OpenRouter sometimes returns no image.** The model can produce text-only responses if the prompt is ambiguous or unsafe. The command throws with the model's text fallback in the error message — surface that to the user (it's usually actionable feedback like "I can't generate images of real people"). Don't swallow it.
- **`targetCardId` patches BEFORE returning.** If the patch fails (realm permission, indexing race) you still get the file written but the `cardInfo.cardThumbnail` link doesn't land. The command throws, but the orphaned file stays in the realm. Worth a "list orphaned thumbnails" cleanup pattern if this matters at scale.
- **`cardInfo.cardThumbnail` requires the target's CardDef to use the default cardInfo passthrough.** A CardDef that overrides `cardInfo` to a non-default shape may not have a `cardThumbnail` field — the patch will fail. Check the base [`CardInfoField`](https://cardstack.com/base/card-api) if unsure.
- **MIME → extension mapping is fixed.** PNG/JPG/WebP/GIF/SVG/AVIF only. Unrecognised MIME defaults to `png`. The OpenRouter image models almost always return PNG, so this rarely matters.
- **`sourceImageUrl` `fetch` runs in the host, not the realm proxy.** If your source image is on a CORS-locked domain, you may need to route it through `SendRequestViaProxyCommand` first and convert to a data URL, then pass the data URL.
- **Costs add up.** Each call is an OpenRouter image-gen request. Don't wire it to a `@tracked` getter or anything that recomputes on render — only call from explicit user actions or one-shot install flows.
- **Fire-and-forget the listing-create way when blocking is wrong.** A modal that waits 8 seconds for an image when the listing is already saved feels broken. `.catch(e => console.warn(...))` and let it land asynchronously — the indexer will surface the thumbnail next refresh.
- **commandContext only in host interact mode.** Same caveat as every host-command-using pattern. Feature-detect with `this.args.context?.commandContext`.

## Source

- Host command: `@cardstack/boxel-host/tools/generate-thumbnail` — `packages/host/app/tools/generate-thumbnail.ts` in the boxel monorepo.
- Former production caller: `autoGenerateThumbnail` in the host's `listing-create` command, retired in CS-11372 (listing commands now live in the catalog realm).
- Catalog-realm re-export: `packages/catalog-realm/commands/generate-thumbnail-command.gts` (one-line `export { default as GenerateThumbnailCommand } from '...'`).
- Default LLM constant: `@cardstack/runtime-common/matrix-constants` → `DEFAULT_IMAGE_GENERATION_LLM`.
- Composes: `SendRequestViaProxyCommand`, `WriteBinaryFileCommand`, `PatchCardInstanceCommand`.

The `example.gts` is a synthesized minimal CardDef built to match the production call shape — there's no public realm-card demo of the host command yet (the older `theme-thumbnail-creator.gts` in `ctse/personal/` re-implements image gen locally with Cloudflare upload, which is the legacy deprecated path).

## See also

- [`integrate-screenshot-card-format`](../integrate-screenshot-card-format/README.md) — for capturing actual rendered cards (Puppeteer-driven, not AI). Use that for documentation snapshots, Open Graph images, audit trails. Use this pattern for stylised thumbnails / icons / generated hero imagery.
- [`integrate-openrouter-image-generation`](../integrate-openrouter-image-generation/README.md) — the lower-level pattern that `GenerateThumbnailCommand` is built on top of. Reach for it when you need a non-card image (e.g. a generated background, an attachment, a card-independent asset).
- [`integrate-filedef-generated-image`](../integrate-filedef-generated-image/README.md) — storage half: write generated bytes to a realm and link via `ImageDef` / `PngDef`.
- [`link-command-menu-item`](../link-command-menu-item/README.md) — wire thumbnail regeneration as a card menu action.
- [`boxel/references/command-invocation-modes.md`](../../../boxel/references/command-invocation-modes.md) — the wider taxonomy of how to expose a Command.
