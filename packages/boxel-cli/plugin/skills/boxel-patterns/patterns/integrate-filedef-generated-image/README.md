---
validated: source-proven
---

# integrate-filedef-generated-image - Persist generated media as realm files

**What this gives you:** The storage half of any generated-image workflow: take a base64 image payload, write it to the realm with `WriteBinaryFileCommand`, then link the resulting file through `ImageDef` / `PngDef`.

**When to use:** Any command receives `data:image/...;base64,...`, remote image bytes, or another generated binary payload that would otherwise be saved into a string field.

**The insight:** Card JSON has a small size budget and is indexed as structured data. Generated media belongs in a realm file; the card stores only a FileDef link.

**Gotchas:**

- Never persist the original data URL, base64 text, blob URL, or ArrayBuffer text on a card.
- `WriteBinaryFileCommand` expects raw base64 content without the `data:image/...;base64,` prefix.
- Set `id`, `url`, and `sourceUrl` on the `ImageDef` to the returned `fileIdentifier`.

**Source:** `packages/host/app/tools/screenshot-card.ts`, `realms-staging.stack.cards/ctse/selective-mouse/stencil-image-studio.gts`.
