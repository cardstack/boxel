---
validated: source-proven
---

# automate-declared-screenshots — Self-refreshing screenshot slots declared on the card class

**What this gives you:** Durable, automatically-captured images of a card's own rendering — declared once as `static screenshots` on the CardDef (or FileDef), captured server-side every time the card indexes, re-captured when the data changes, and consumable from any template via `@model.screenshotURLs.<name>`. The flagship use is a real rendered thumbnail for grid tiles with **zero template edits**: flag one slot `useAsThumbnail: true` and the default fitted tile picks it up through `cardThumbnailURL`.

**Sibling patterns — pick the right one:**

- **This pattern** — the card should *always* have a current picture of itself (grid thumbnails, social/og images, poster frames). Declarative, self-healing, re-captures on every edit.
- [`integrate-screenshot-card-format`](../integrate-screenshot-card-format/README.md) — a user action should capture a *point-in-time* PNG of some card and keep its served URL (documentation snapshots, audit trails, before/after diffs). Imperative, via `ScreenshotCardTool`.
- [`integrate-thumbnail-card-ai`](../integrate-thumbnail-card-ai/README.md) — an AI-*designed* representation rather than the actual rendering.

**When to use:**
- **Grid-tile thumbnails from the real rendering** — one `useAsThumbnail` slot and every fitted tile shows the card's actual content.
- **Social-share / Open Graph images** — declare a wide slot rendered by a dedicated component; the URL is durable and always reflects the latest data.
- **Poster frames for file cards** — a FileDef subclass whose preview readies asynchronously (video frame, PDF page, 3D scene) declares a poster slot keyed by file content.
- **Any card that embeds a picture of another card's live state** — link the card, render its `screenshotURLs.<name>`.

**The insight:** the platform already re-renders every card server-side whenever it indexes. Declared screenshots ride that render: the prerender pass captures each declared slot after the card settles (fonts, images, data loads), stores the bytes content-addressed in the media cache, and publishes the slot into the instance's `meta.screenshots`. You never trigger anything, never store bytes in card JSON, and never go stale — an edit re-indexes the card, which re-captures the slots.

## Declaring slots

```ts
import {
  CardDef,
  Component,
  type ScreenshotSpec,
} from '@cardstack/base/card-api';

// Capture-only component — see example.gts for the full version.
class SocialCard extends Component<typeof Recipe> {
  <template>…</template>
}

export class Recipe extends CardDef {
  // ⚠️ The `Record<string, ScreenshotSpec>` annotation is REQUIRED.
  // Without it TypeScript widens 'embedded' to string and the class
  // fails to type-check against the base declaration (TS2417).
  static screenshots: Record<string, ScreenshotSpec> = {
    tile: { format: 'embedded', width: 170, height: 250, useAsThumbnail: true },
    social: { render: SocialCard, width: 1200, height: 630, type: 'jpeg' },
  };
}
```

Each entry is one named slot. Names must match `^[A-Za-z0-9][A-Za-z0-9_-]*$` (max 64 chars). Exactly one of:

- `format: 'isolated' | 'embedded' | 'fitted' | 'atom'` — capture one of the card's existing display formats, **or**
- `render: SomeComponent` — a *capture-only* component: it gets the full author surface (`@model`, `@fields`, `@context`, linked data) but is only ever rendered by the capture engine — it never appears in the app and is not part of the format API.

Both are required: `width` and `height` — the CSS px of the capture box (the fitted envelope for `format: 'fitted'`).

Remaining knobs (all optional):

| Field | Default | Notes |
| --- | --- | --- |
| `deviceScaleFactor` | `2` | Output px = size × dsf. Max 3; each edge × dsf must stay ≤ 16384 |
| `background` | `'white'` | Any CSS color, or `'transparent'` (requires `type` `'png'`/`'webp'` — jpeg has no alpha) |
| `type` | `'png'` | `'png' \| 'jpeg' \| 'webp'` |
| `useAsThumbnail` | — | Feed this capture to `cardThumbnailURL` (at most one slot per card, across inherited declarations) |
| `keyBy` | `'generation'` | What invalidates the capture. `'file-content'` (FileDef chains only) skips re-capture on metadata-only edits |

Validation is strict: an unknown field or bad value throws loudly at read time rather than silently capturing the wrong thing.

**Inheritance:** declarations merge up the class chain by name, base-most first, with **per-name wholesale override** — re-declaring `tile` in a subclass replaces the ancestor's entire `tile` entry, not individual fields. Moving `useAsThumbnail` to a different slot in a subclass means re-declaring the inherited slot *without* the flag as well.

## Consuming captures

**In any template — `@model.screenshotURLs.<name>`** (a reserved getter on every CardDef/FileDef; you cannot declare an `@field` named `screenshotURLs`):

```gts
{{#if @model.screenshotURLs.social}}
  <img src={{@model.screenshotURLs.social}} alt='share preview' />
{{/if}}
```

Always guard the `<img>`: the value is `undefined` until a capture exists (new instance, capture in flight, or capture failed). Glimmer omits the `src` attribute for `undefined`, so nothing crashes — but the src-less `<img>` still renders, leaving alt text and a layout hole on every pre-capture render. `undefined` is the deliberate absence signal — build fallback chains on it.

**As the grid-tile thumbnail — declare and you're done.** A `useAsThumbnail` slot feeds the `cardThumbnailURL` fallback chain (author-set URL → authored `cardInfo.cardThumbnail` link → this capture), and the default fitted template renders `cardThumbnailURL`. Recommended box: **170×250 at the default dsf 2** — the standard grid-tile size, so the capture crops predictably under consumers' `object-fit`.

**By URL** (for `og:image` meta, external embeds): each capture's durable URL is `{realmURL}_screenshot/{instance-path}?name={slot}`. It also appears in the instance's `meta.screenshots.<name>.url` alongside `contentType`, `width`, `height`, and `deviceScaleFactor`.

**Preview a candidate box before codifying it:** `GET {realmURL}_screenshot/{instance-path}?format=fitted&envelope=170x250` on a dev realm renders the capture on demand — tune the box, then write the numbers into the declaration.

## Async readiness (capture-only render components)

Content that readies after render — a video frame seeked onto a canvas, a PDF page paint, a WebGL first frame — is invisible to the engine's settle heuristics. Signal through the DOM: render a `data-screenshot-pending` attribute on any element while unready, remove it when painted. The engine waits (bounded) until no such element remains; a component that never resolves it fails that slot's capture rather than persisting an unready frame. Components with no async work just omit the attribute.

## Gotchas

- **The type annotation is mandatory** (see the ⚠️ above). A bare `static screenshots = { … }` fails with TS2417.
- **The Droste footgun:** a `format: 'fitted'` slot flagged `useAsThumbnail` on a card using the *default* fitted template captures the tile chrome — including the tile's own thumbnail slot, which shows the previous capture, recursively nested. Point thumbnail captures at content: a `render` component, `isolated`/`embedded`, or a custom fitted template that doesn't render `cardThumbnailURL`. Nothing prevents this mechanically.
- **Circularity:** a `format`-based slot referenced from that same format's own markup is circular — use a dedicated `render` component there. (Referencing a *different* slot from a display format is fine: the first-pass HTML embeds a URL that 404s briefly, then self-heals once the capture lands.)
- **Render deterministically.** Captures are stored under a hash of their bytes, so unchanged data should produce identical pixels. Keep `Date.now()` / "3 minutes ago" timestamps, `Math.random`, mid-flight CSS animations, autoplaying carousels, and per-call-varying fetches out of captured markup; seek media to exact timestamps and position cameras explicitly. Nondeterminism doesn't break anything visibly — it just re-captures "new" bytes on every reindex, churning storage and defeating image caching.
- **A failed capture never breaks the card.** The card still indexes and renders; the slot reads `undefined` (and its URL 404s) until a bounded background retry or the next edit succeeds. If capture URLs 404 *persistently* across edits, the environment likely has no media-cache storage configured — that's an operator concern, not a declaration bug.
- **`useAsThumbnail` is at-most-one** across the merged (inherited) declarations; a second flag throws at declaration-read time.
- **Budget:** at most 12 slots per card. Every slot costs a real Chrome capture on each re-index — declare what you consume, not what might be nice someday.

## Recipe shape

See `example.gts` — a card with an embedded-format thumbnail slot, a render-component social image, and the guarded consumption idiom.

**Source:** platform API in `packages/base/card-api.gts` (`ScreenshotSpec`, `getScreenshots`, `screenshotURLs`); capture/serving exercised end-to-end in `packages/realm-server/tests/declared-screenshots-indexing-test.ts`; the base realm's file cards (image thumbnails, media poster frames) are the platform's own declarations.

## See also

- `integrate-screenshot-card-format` — imperative point-in-time snapshots of *other* cards, saved as separate files.
- `integrate-thumbnail-card-ai` — AI-generated designed thumbnails.
- `cardinfo-override-title` — the same "make the default tile good" step for the card's text identity.
- `boxel/references/base-field-catalog.md` — the ImageDef/URL pair for *author-uploaded* imagery.
