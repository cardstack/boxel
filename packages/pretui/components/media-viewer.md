## What it is

One shell that picks a viewer for an asset. You hand it a `MediaAssetSpec` — a `src` plus whatever else you know — and it decides the kind, finds the adapter that claims it, and renders that. Four kinds are modelled: image, video, audio, model.

Use it whenever the kind is a property of the data rather than a decision you are making. When you already know it is a video, **VideoPlayer** is more direct. **AssetGrid** and **Gallery** compose this rather than routing themselves.

## The contract

```
@asset (required) — a MediaAssetSpec: src, plus optional kind, mimeType,
                    name, alt, width, height, meta
<:unsupported>    — replaces the built-in fallback for an unrouted asset
```

**Kind detection is data, in one place, and never a sniff.** An explicit `kind` wins; then the MIME type, including the one inside a `data:` URL; then the file extension through a table. No `HEAD` request — that would be a lie in a realm anyway, where every asset sits behind header auth — and no byte sniffing. The result is deterministic and works offline, which matters because half this kit's media examples are data URLs.

**The registry is open and last-write-wins.** `registerMediaAdapter` unshifts, so a consumer that registers an `image` adapter after this module loads overrides the built-in without patching or forking it. Adapters are matched by **predicate, not by kind**, so one can claim a subset — "images under 2 MP", "audio with a transcript" — rather than a whole category.

**Resolution fills the gaps before an adapter sees the asset.** `resolveAsset` derives the kind, a `label` (the caller's `name`, else the basename of the URL, else "Untitled asset" for a data URL), and an `aspectRatio` string when both dimensions are known. Adapters therefore take a `ResolvedMediaAsset` and never repeat that work.

**The fallback names the gap rather than rendering a blank box.** An unrouted asset gets an empty state saying what kind it is, what would handle it, and a link to open the file in a new tab with `rel='noopener noreferrer'`.

## Prior art

A kit addition, and the comparison is against how digital-asset managers actually do this: an if-chain inside the gallery component picking a viewer. That is why adding a kind means editing the gallery in every one of them.

Where Pretui is better: **the gallery knows nothing.** Routing lives in one registry, a new kind is a registration rather than an edit, and an adapter can be overridden from outside the module. The fallback being informative rather than blank is the other half — an unsupported asset is a normal condition in a real library, not an error case.

Where it is thinner, and one of these is a live inconsistency: **`ModelViewer` ships but is not routed here by default.** It registers through an explicit `installModelAdapter()` call, deliberately — the engine costs 292 KB gzipped and importing a component must not silently change how every other viewer in the process behaves — but the fallback message for a model asset still reads "not vendored yet", which is now stale copy rather than a true statement. A host that wants 3D has to call the installer and will not learn that from the message it sees.

Beyond that: there is no loading or error state at the shell level (each adapter owns its own), no size or fit contract shared across adapters, and no way to ask the shell which adapter *would* run without rendering it, other than the exported `adapterFor`.

## Accessibility

- **The shell itself is a plain `<div>` with no role and no name**, which is correct: it is a router, and the adapter it renders owns the semantics. An `ImageFrame` carries the alt text, a `MediaPlayer` carries the region and its label.
- **The fallback is the one part with its own semantics**, and it is text plus a real link rather than a grey box — so an unrouted asset is still reachable, still named, and still openable by keyboard.
- **The fallback link opens a new tab** with `rel='noopener noreferrer'`. It is announced as a link to the asset by its resolved label, so "Open quarterly-review.glb in a new tab" rather than "click here".
- **`<:unsupported>` replaces that fallback entirely**, which means a caller who overrides it inherits the responsibility for naming the asset and offering a way to reach it.
- **Nothing about kind is conveyed by colour** at this level; the `data-kind` and `data-adapter` attributes are for styling and tests, not for meaning.

## Theming

The shell has almost no surface of its own: `--text-ui-sm` and `--pretui-primary-ink` for the fallback link, and `--pretui-shadow-hairline` shared with the adapters in this module.

That is deliberate. Everything visible comes from the adapter that ran, so a season retunes **MediaPlayer**, **ImageFrame** and the rest, and the shell inherits whatever they became. A viewer that themed independently of its adapters would be a viewer that looks different depending on what you put in it.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
