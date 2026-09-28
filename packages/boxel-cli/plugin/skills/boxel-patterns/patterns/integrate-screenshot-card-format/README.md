---
validated: source-proven
---

# integrate-screenshot-card-format — Capture a settled PNG **or PDF** of any card at `isolated` or `embedded` format

**What this gives you:** A reliable way for one card to take a *picture* of another card — at the format you choose — and get back a durable served URL for the PNG, **or export the same settled render as a paged PDF** (a print-ready document). The realm-server drives Puppeteer through the prerender pool to capture a fully-settled render (after data loads, animations resolve, layout completes), so the snapshot reflects what a user would see, not a half-loaded skeleton.

**PNG vs PDF — pick by what you're producing:** a **PNG** (the default, and the only output `ScreenshotCardTool` itself returns) is a single raster of one viewport — the right output for thumbnails, og:images, tiles, and inline previews. A **PDF** (`type: 'pdf'` on the capture spec) paginates the same settled render onto paper — the right output when the deliverable is a *document*: a multi-page report, an invoice, anything the user will print, download, or archive. You reach PDF through the capture-spec surfaces — a durable `_screenshot/…?type=pdf` URL or a direct `POST /_screenshot-card` — not through the tool's input, which has no `type` field. The PDF path also unlocks **print media** (`media: 'print'`) so the card's `@page` size and `@media print` CSS decide the paper and pagination. Both are covered below; jump to [Export as PDF](#export-as-pdf-type-pdf) for the PDF specifics.

**Sibling patterns:** [`automate-declared-screenshots`](../automate-declared-screenshots/README.md) — declarative, **self-refreshing** capture slots on the card class itself (thumbnails, og images, poster frames that re-capture on every edit). Prefer that whenever the card should *always* carry a current picture of itself; use **this** pattern for a *point-in-time* capture you keep a URL to (documentation, audit/before-after trails). [`integrate-thumbnail-card-ai`](../integrate-thumbnail-card-ai/README.md) — for **AI-generated** stylised thumbnails (designed icons, brand-mark tiles, catalog hero images) when the user wants a *designed representation* rather than any actual rendering; the catalog's `listing-create.autoGenerateThumbnail` uses it.

**When to use:**
- **Documentation cards / changelogs / before-after diffs** — snapshot a card at a point in time, keep the served URL on the doc.
- **Social-share cards / Open Graph images** — render a designed `embedded` format, screenshot it, serve as `og:image`.
- **Marketing pages, design-system snapshots, portfolio captures** — programmatically render card galleries.
- **Audit / approval trails** — capture the visible state when a workflow card transitions.
- **Test fixtures** — anywhere a `.png` of a real render beats a hand-curated mock.
- **Printable documents (PDF)** — invoices, reports, statements, contracts, certificates: anything the user prints, downloads, or archives as a paged file. Use `type: 'pdf'` (see [Export as PDF](#export-as-pdf-type-pdf)), with `media: 'print'` when the card carries `@page`/`@media print` CSS.
- **Always-current embedded documents (durable PDF URL)** — a `_screenshot/…?type=pdf` URL rendered into a card re-captures itself whenever the source card is edited, so an embedded "download PDF" link never goes stale. Render it through the host's `SignedCaptureLink` / `SignedCapture` components — a bare anchor or `<object>` pointing at a private realm's capture URL is refused. See [Durable PDF URLs](#durable-pdf-urls-embed-instead-of-base64).

**The insight:** `ScreenshotCardTool` (from `@cardstack/boxel-host/tools/screenshot-card`) is a Boxel host tool that orchestrates the realm-server screenshot job end-to-end. You pass two inputs — the target card (as a `linksTo` reference) and a format string — and you get back a `captures` list whose first entry's `url` you can render straight into an `<img>`. The realm-server enqueues the job, the worker drives a Puppeteer browser through the prerender pool, and the PNG is persisted to the **media cache** under the capture's canonical identity (card URL × format × capture spec — geometry, `type`, `media` — × the card's index generation). Nothing is written into any realm; cards never see the bytes, you get a clean served URL.

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

Two more axes exist on the **capture spec** — the shared grammar behind the durable `_screenshot/` URL and the raw `POST /_screenshot-card` body, *not* on the tool's input:

| Capture-spec axis | Values | Notes |
|---|---|---|
| `type` | `'png'` (default) `\| 'pdf'` | Output encoding. `pdf` paginates the settled render (see [Export as PDF](#export-as-pdf-type-pdf)). Incompatible with `fullPage`/`clip`/`target`/`viewport`. |
| `media` | `'screen'` (default) `\| 'print'` | CSS media the render settles under. `print` engages the card's `@page`/`@media print` CSS — the paper-layout choice, matters most for `type: 'pdf'`. |

`token` is **not** a spec axis. The serving path strips a `?token=` (a [signed capture URL](#render-it-through-the-signed-capture-components)) before the spec parse, so a signed URL and its durable form resolve to the same ledger identity — a token can never mint a distinct capture.

## How the realm-server does the work

1. `ScreenshotCardTool.run()` checks the current user can **read** the target card's realm, then POSTs `{ realmURL, cardId, format }` to `/_screenshot-card` on the realm-server with that realm's session token.
2. The handler (`packages/realm-server/handlers/handle-screenshot-card.ts`) answers straight from the media-cache ledger if this exact capture already exists; otherwise it enqueues a `screenshot-card` job via the queue system.
3. The worker task (`runtime-common/tasks/screenshot-card.ts`) drives Puppeteer through the prerender pool to render the card at the requested format.
4. Puppeteer waits for the page to settle (data loads, animations, font swap, prerender hooks) before capturing.
5. The worker persists the PNG to the **media cache** under the capture's canonical identity and the handler responds with `captures[].url`, the durable served URL. No realm file is created and nothing is indexed.
6. If the render outlasts the HTTP wait the handler replies `503` with `Retry-After`; the job still finishes and persists, so a retry is a pure ledger hit.

You don't see any of this from the consumer side — `await new ScreenshotCardTool(ctx).execute({ card, format })` returns when the capture is servable.

## Export as PDF (`type: 'pdf'`)

The same capture pipeline can emit a **paged PDF** instead of a raster. Add `type: 'pdf'` to the capture spec (the default is `type: 'png'`). Everything about settling the render is identical — nav, data loads, animations, font swap, image paint — but instead of one viewport screenshot you get a multi-page document of the whole settled card.

`ScreenshotCardTool`'s input does not expose `type` or `media` — the tool always captures a PNG. PDF lives on the two capture-spec surfaces:

- **Durable GET URL** (the usual path from a card): compose `{realm}_screenshot/{path}?type=pdf[&media=print]` and embed it — see [Durable PDF URLs](#durable-pdf-urls-embed-instead-of-base64).
- **`POST /_screenshot-card`** (programmatic, realm read + session token): the same body the tool sends, plus a nested spec —

  ```jsonc
  {
    "data": {
      "type": "screenshot-card",
      "attributes": {
        "realmURL": "https://my.realm/",
        "cardId": "https://my.realm/Invoice/2026-0042",
        "format": "isolated",
        "captureSpec": { "type": "pdf", "media": "print" }
      }
    }
  }
  ```

  The response's capture entry carries the durable `?type=pdf` URL.

**When to reach for it:** the deliverable is a *document*, not a picture — an invoice, statement, report, contract, or certificate the user prints, downloads, or archives. If you only need a single-viewport image (thumbnail, og:image, tile), stay on the default PNG; a PDF of a one-screen card is just a one-page PDF with extra overhead.

### `media: 'screen'` vs `media: 'print'`

`media` chooses the CSS media the render settles under — it is independent of `type`, though it matters most for PDF:

- **`screen`** (default) — the render every screenshot has always captured: what the card looks like on screen. A `screen` PDF paginates that on-screen layout onto default paper.
- **`print`** — settles the render under **print media**, so the card's own print CSS decides the document: `@page { size: … }` sets the paper (A4, Letter, landscape), `@media print { … }` swaps in print-only styling, and `break-before`/`break-after`/`break-inside` control where pages split. Reach for this whenever the card author wrote print CSS — it's the difference between a PDF that *looks like the screen* and one that *is laid out for paper*.

A card controls its own pagination with standard print CSS in its template, e.g.:

```css
@page { size: A4; margin: 18mm; }
.invoice-section { break-inside: avoid; }
.page-break { break-after: page; }
```

With no `@page { size }` rule, the PDF falls back to Chrome's default paper (US **Letter**). Author an explicit `@page { size: A4 }` (or `Letter`, `Legal`, `… landscape`) when the paper matters.

### Bounds and over-bounds errors

A PDF capture is bounded **post-render** (the page count and byte size only exist once Chrome has paginated):

- **20 pages** maximum.
- **10 MB** maximum output.

Over either bound is a **capture error that names the cap** — never a silent truncation to 20 pages or a clipped file. If you hit it, the fix is upstream in the card's content or print CSS (fewer pages, lighter embedded images, tighter `@page` margins), not a retry. Treat an over-bounds error as "this card is too big to be one PDF," and surface it to the user rather than swallowing it.

`type: 'pdf'` is **singular-only** and refuses the raster crop modes — `fullPage`, `clip`, and `target` are contradictions for a paged document and are rejected at the spec parse. A non-default `viewport` is refused too: pagination lays the document out at the *paper's* content width, so a viewport would be inert. A PDF is always the whole settled render.

## Durable PDF URLs (embed instead of base64)

For the common case — a card that should carry an **always-current** "download / view PDF" link — don't capture base64 and store bytes. Compose a **durable serving URL** against the source card and embed *that*:

```
{realmURL}_screenshot/{card-path}?type=pdf
{realmURL}_screenshot/{card-path}?type=pdf&media=print          // print-CSS paper
```

For example, a PDF of the card `https://my.realm/Invoice/2026-0042` is:

```
https://my.realm/_screenshot/Invoice/2026-0042?type=pdf&media=print
```

This URL is served straight from the realm's MediaCache: a **ledger hit** on repeat requests (no re-render), a fresh capture on the first miss. Because the cache identity pins the source card's *generation*, **editing the card re-captures the PDF on the next fetch** — the embedded link is never stale. The response carries `Content-Disposition: inline` with a filename derived from the source card, so the browser's PDF viewer shows a sensible name.

### Render it through the signed-capture components

A capture URL is served behind **realm read**. Inside the app that read is asserted by an `Authorization` header the host's auth service worker injects — but the two surfaces a PDF link actually lands on never pass through that worker: **`<object>`/`<embed>` loads** (they bypass service workers by spec) and **top-level navigations** to the realm origin (a "Download PDF" anchor with `target="_blank"`, a copied link). On a private realm a bare `<a href={{durableUrl}}>` or `<object data={{durableUrl}}>` therefore draws the realm's `text/plain` 401 — and a browser asked to save "a PDF" offers that error text as a `.txt` file. (`<img>` loads are fine either way: the service worker covers them.)

The host provides two components, importable from `@cardstack/boxel-host/lib/signed-capture`, that hide the fix. Each mints a **signed capture URL** at the moment of use — the durable URL plus a short-lived `?token=` that authorizes exactly that one `_screenshot/` GET without a header — and the card template contains no signing JavaScript:

- **`SignedCaptureLink`** — an anchor (rendered through the shared `Button`; default `@kind='link-primary'`, `@kind`/`@size` pass through) whose `href` stays the **durable** URL, so right-click → copy link shares the stable reference. On click it opens a new tab synchronously (keeping the user activation, so popup blockers stay quiet), mints, then navigates that tab to the signed URL. A failed mint closes the tab and renders the error beside the link.
- **`SignedCapture`** — a renderless provider: `<SignedCapture @url={{…}} as |signedUrl error|>` yields `undefined` while minting, then the URL to load — the tokened variant, or the durable URL itself on a publicly readable realm. Use it for render-time attributes: an `<object>` PDF pane, an `<embed>`, an `<img>` you want to prove loads without the worker.

```gts
import { Component } from '@cardstack/base/card-api';
import { realmURL } from '@cardstack/runtime-common';
import {
  SignedCapture,
  SignedCaptureLink,
} from '@cardstack/boxel-host/lib/signed-capture';

class Isolated extends Component<typeof InvoiceViewer> {
  // The DURABLE url — a plain sync getter. Getters cannot mint (minting is
  // async); the components below sign this value at the moment of use.
  get pdfUrl() {
    let card = (this.args.model as any)?.card;   // the linked CardDef instance
    let id: string | undefined = card?.id;        // its durable card URL
    let realm: string | undefined = card?.[realmURL]?.href; // its realm root
    if (!id || !realm) return undefined;
    let path = id.slice(realm.length);            // instance path within the realm
    return `${realm}_screenshot/${path}?type=pdf&media=print`;
  }

  <template>
    {{! click-time: opens the PDF in a new tab with a fresh token }}
    <SignedCaptureLink @url={{this.pdfUrl}}>Download PDF</SignedCaptureLink>

    {{! render-time: an inline viewer pane }}
    <SignedCapture @url={{this.pdfUrl}} as |signedUrl error|>
      {{#if signedUrl}}
        <object data={{signedUrl}} type='application/pdf' aria-label='Invoice PDF'></object>
      {{else if error}}
        <p role='alert'>{{error}}</p>
      {{else}}
        <p>Preparing PDF…</p>
      {{/if}}
    </SignedCapture>
  </template>
}
```

(`realmURL` is the symbol re-exported from `@cardstack/runtime-common`; reading it off the linked card gives that card's own realm root, which is where the capture persists and serves from.)

**Signed URLs are ephemeral view-layer values.** The token lives **15 minutes** and is bound to one realm, one capture URL (query-param-order-insensitive), and the user it was minted for; it is minted only for callers who already hold realm read, so it grants nothing new — it just makes that grant portable to browser-native fetches. Never write a signed URL into card data, an index doc, or prerendered HTML: the durable URL is the only storable reference. During a server-side prerender `SignedCapture` yields nothing and no mint happens, so prerendered markup stays durable-only. Browser PDF viewers save the bytes they already buffered, so a token that expires after the document loaded does not break "Save".

Both components share the host's `capture-url-signer` service, which memoizes each durable URL until its token nears expiry and coalesces every request issued in one render pass into a single mint call per realm. Programmatic callers (scripts, `boxel-cli`) can use the same route directly: `QUERY {realm}_sign-capture-urls` (spelled `POST` + `X-HTTP-Method-Override: QUERY` from clients that cannot send `QUERY`, which is how the host itself calls it) with a JSON body `{ "urls": [ … ] }` (1–100 of *this* realm's `_screenshot/` URLs, header-authed like any realm request) returns `{ "signed": [{ "url", "signedUrl", "expiresAt" }] }`. An anonymous caller on a public realm gets each URL echoed back unsigned with `expiresAt: null` — there is no user to bind, and none is needed where anonymous read already serves.

Prefer this durable-URL form over a one-off base64 capture whenever the PDF is *of the card itself* and should track the card's content. Reach for a direct `POST /_screenshot-card` with `captureSpec.type: 'pdf'` and `includeBase64` only when you need the bytes in hand at a point in time — a PDF snapshot archived as a separate file, detached from future edits.

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
- **The same capture is served, not re-rendered.** Identity is card URL × format × capture spec × index generation, so repeating a capture on an unchanged card is a ledger hit; editing the card produces a new capture.
- **Long renders block the request.** The realm-server waits on the job (Puppeteer needs to settle the page) and returns `503` + `Retry-After` if it runs long; the tool surfaces that as an error to retry. On a slow card or under load, expect a few seconds. Wrap in `@tracked isRunning` / show a spinner; don't `await` inside `getMenuItems` without surfacing progress.
- **toolContext must exist.** Only available in host interact mode — the prerenderer / SSR context doesn't have a live host. Feature-detect with `this.args.context?.toolContext` before calling.
- **`listing-create` does not use this command.** The catalog's listing-creation flow uses `GenerateThumbnailCommand` (AI-generated stylized icon, not a real screenshot). Use `ScreenshotCardTool` when you want the actual rendered card, not an interpretation.
- **The tool can't emit a PDF.** `ScreenshotCardTool`'s input has no `type`/`media` fields — it always returns a PNG. PDF is reached through the capture-spec surfaces: the durable `_screenshot/…?type=pdf` URL or a direct `POST /_screenshot-card` with `captureSpec.type: 'pdf'`.
- **PDF is bounded, and over-bounds is an error, not a truncation.** 20 pages / 10 MB. A card that paginates past either cap fails the capture with a message naming the cap — fix the card (fewer pages, lighter images, tighter `@page` margins), don't retry. See [Export as PDF](#export-as-pdf-type-pdf).
- **PDF refuses the raster axes.** `type: 'pdf'` with `fullPage`, `clip`, `target`, or a non-default `viewport` is rejected at the spec parse — a paged document is always the whole settled render laid out at the paper's width, so a crop or viewport is a contradiction.
- **`media: 'print'` only changes anything if the card has print CSS.** Under `print`, `@page`/`@media print`/`break-*` rules take effect; a card with none renders the same as `screen`, just on Chrome's default paper. Author `@page { size: … }` when the paper size matters, or the PDF is Letter.
- **Prefer a durable `?type=pdf` URL over stored bytes for an *of-the-card* PDF.** A one-off PDF capture is a point-in-time file that won't track later edits. For an embedded "always current" PDF link, compose the [durable URL](#durable-pdf-urls-embed-instead-of-base64) instead — it re-captures when the card changes.
- **A bare `<a href>` or `<object data>` to a capture URL 401s on a private realm.** `<object>`/`<embed>` loads bypass the service worker and new-tab navigations never reach it, so no `Authorization` header arrives; the browser may offer the realm's 401 text as a `.txt` download. Render through `SignedCaptureLink` / `SignedCapture` from `@cardstack/boxel-host/lib/signed-capture` — see [the signed-capture components](#render-it-through-the-signed-capture-components). `<img>` loads are covered by the worker and need nothing.
- **Never persist a signed URL.** The `?token=` variant is a 15-minute, single-URL credential minted at the moment of use. Store and compose the **durable** URL only — a getter returns the durable URL, the component signs it. Signing happens client-side and asynchronously, so a card getter (sync) cannot mint; prerendered output never carries a token.

## Source

- Host command: `@cardstack/boxel-host/tools/screenshot-card` — `packages/host/app/tools/screenshot-card.ts` in the boxel monorepo.
- Realm-server endpoint: `POST /_screenshot-card` → `packages/realm-server/handlers/handle-screenshot-card.ts`.
- Durable serving URL: `GET {realm}_screenshot/{path}?type=pdf` → the MediaCache serving path (`packages/runtime-common/media-cache-serving.ts`); persisted by the worker task's PDF leg.
- Capture-spec axes (`type`, `media`) and the PDF bounds (`SCREENSHOT_PDF_MAX_PAGES`, `SCREENSHOT_PDF_MAX_BYTES`): `packages/runtime-common/capture-spec.ts`.
- Signed-capture components: `@cardstack/boxel-host/lib/signed-capture` — `packages/host/app/lib/signed-capture.gts` (`SignedCapture`, `SignedCaptureLink`), backed by the memoizing `packages/host/app/services/capture-url-signer.ts`.
- Capture-URL token (15-minute TTL, `read-capture` scope, URL binding) and the `QUERY {realm}_sign-capture-urls` mint route: `packages/runtime-common/capture-url-token.ts`; `signCaptureURLs` / `verifyCaptureURLToken` in `packages/runtime-common/realm.ts`.
- Interactive harness for the signed surfaces (bare vs signed new-tab, `<object>` PDF embed): `packages/experiments-realm/signed-capture-url-tester.gts`.
- Worker task: `packages/runtime-common/tasks/screenshot-card.ts`.
- Input/output types: `ScreenshotCardInput` / `ScreenshotCardOutput` in `packages/base/command.gts`.
- Proven example: `packages/experiments-realm/screenshot-card-demo.gts` — copied verbatim into this pattern's `example.gts`.

## See also

- [`integrate-thumbnail-card-ai`](../integrate-thumbnail-card-ai/README.md) — **paired sibling**: AI-generated thumbnails (`GenerateThumbnailCommand`) instead of real rendered captures. Same composition surface (file in realm + optional `cardInfo.cardThumbnail` patch).
- [`link-command-menu-item`](../link-command-menu-item/README.md) — wire screenshot capture as a card menu action.
- [`integrate-filedef-generated-image`](../integrate-filedef-generated-image/README.md) — the storage half of any generated-media workflow; explains how `WriteBinaryFileCommand` + `ImageDef` / `PngDef` compose with binary outputs.
- [`integrate-openrouter-image-generation`](../integrate-openrouter-image-generation/README.md) — lower-level OpenRouter image primitive that `GenerateThumbnailCommand` is built on top of.
- [`boxel/references/command-invocation-modes.md`](../../../boxel/references/command-invocation-modes.md) — the wider taxonomy of how to expose a Command.
