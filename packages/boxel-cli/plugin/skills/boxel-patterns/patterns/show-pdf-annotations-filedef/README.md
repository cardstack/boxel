---
validated: source-proven
---

# show-pdf-annotations-filedef — annotate a linked PDF with PDF.js text-layer coordinates

**What this gives you:** A PDF viewer card that loads a realm-stored PDF through `linksTo(FileDef)`, renders it with PDF.js, and persists highlights as normalized coordinates in card JSON.

**When to use:** Study guides, contract review, source-document markup, research notes, transcript review, or any card that needs durable annotations on a PDF file. Use this instead of storing a PDF URL string when the document is uploaded/generated into the realm.

**The insight:** There are two separate durable things: the PDF file and the annotation model. The PDF is a `FileDef` relationship (`linksTo(FileDef)`); the annotations are small structured JSON with page number plus normalized bounds (`x`, `y`, `width`, `height` between 0 and 1). Normalized coordinates survive zoom, fit-width rendering, and device-pixel-ratio canvas scaling.

PDF.js needs three non-obvious pieces in Boxel:

- load the PDF.js script and viewer stylesheet from a CDN,
- set `pdfjsLib.GlobalWorkerOptions.workerSrc`,
- render a transparent text layer with `pdfjsLib.renderTextLayer()` so browser text selection can become highlight bounds.

**Gotchas:**

- Replace catalog-style `@field documentUrl = contains(UrlField)` with `@field pdfFile = linksTo(FileDef)` for realm-stored PDFs.
- Relationship links to PDFs should include `.pdf`: `./documents/source.pdf`.
- Do not persist `blob:` URLs from file inputs. Upload/write the PDF as a realm file first, then link it.
- Canvas pixels and CSS pixels differ on Retina displays; render with `devicePixelRatio`, but store annotation bounds relative to the text layer.
- Store annotations as data, not DOM. Re-render highlights whenever the page or zoom changes.

**Source:** `packages/catalog-realm/annotation/annotation.gts:426-694`, `:1320-1376`, `:3675-3690`, adapted to FileDef storage per the workspace no-inline-media rule.
