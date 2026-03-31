## FileDef — First-Class File Support

`FileDef` is a **third kind of "def"** in Boxel, alongside `CardDef` and `FieldDef`. A FileDef instance represents a file that lives in the realm — an image, document, or other asset — with metadata automatically extracted during indexing.

### Key Rules

- **FileDef instances have their own identity** (like cards), so you reference them with `linksTo`, never `contains`
- **Render them using the same display formats** — FileDefs have `isolated`, `embedded`, `fitted`, and `atom` templates
- **Files are not editable via the card edit interface** — users replace them by uploading a new file

---

## Type Hierarchy

```
FileDef                          → any file
  ├── ImageDef                   → any image (adds width, height)
  │     ├── PngDef               → .png files
  │     ├── JpgDef               → .jpg / .jpeg files
  │     ├── SvgDef               → .svg files
  │     ├── GifDef               → .gif files
  │     ├── WebpDef              → .webp files
  │     └── AvifDef              → .avif files
  ├── MarkdownDef                → .md / .markdown (adds title, excerpt, content)
  ├── TextFileDef                → .txt (adds title, excerpt, content)
  ├── TsFileDef                  → .ts (adds title, excerpt, content)
  ├── GtsFileDef                 → .gts (extends TsFileDef)
  ├── JsonFileDef                → .json (adds title, excerpt, content)
  └── CsvFileDef                 → .csv (adds title, excerpt, content, columns, columnCount, rowCount)
```

**Use the most specific type that fits.** Prefer `PngDef` over `ImageDef` when you specifically need PNG; prefer `ImageDef` over `FileDef` when any image format is acceptable.
**This set is not extensible by Boxel users (currently).** The Boxel project provides these types and only new releases of boxel can add new ones. This may change in the future.

---

## Import Paths

```gts
import FileDef from '@cardstack/base/file-api';

// Image types
import ImageDef from '@cardstack/base/image-file-def';
import PngDef from '@cardstack/base/png-image-def';
import JpgDef from '@cardstack/base/jpg-image-def';
import SvgDef from '@cardstack/base/svg-image-def';
import GifDef from '@cardstack/base/gif-image-def';
import WebpDef from '@cardstack/base/webp-image-def';
import AvifDef from '@cardstack/base/avif-image-def';

// Document / text types
import MarkdownDef from '@cardstack/base/markdown-file-def';
import TextFileDef from '@cardstack/base/text-file-def';
import TsFileDef from '@cardstack/base/ts-file-def';
import GtsFileDef from '@cardstack/base/gts-file-def';
import JsonFileDef from '@cardstack/base/json-file-def';
import CsvFileDef from '@cardstack/base/csv-file-def';
```

---

## Available Fields

Every FileDef instance exposes these base fields:

| Field         | Type   | Description                  |
| ------------- | ------ | ---------------------------- |
| `id`          | string | URL identifier of the file   |
| `url`         | string | Current URL of the file      |
| `sourceUrl`   | string | Original source URL          |
| `name`        | string | Filename (e.g. `photo.png`)  |
| `contentType` | string | MIME type (e.g. `image/png`) |
| `contentHash` | string | MD5 hash of file content     |
| `contentSize` | number | File size in bytes           |

Additional fields added by subtype:

| Type                                                                   | Extra Fields                                                                |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `ImageDef` + all image subtypes                                        | `width` (px), `height` (px)                                                 |
| `MarkdownDef`, `TextFileDef`, `TsFileDef`, `GtsFileDef`, `JsonFileDef` | `title`, `excerpt`, `content` (full text)                                   |
| `CsvFileDef`                                                           | `title`, `excerpt`, `content`, `columns` (array), `columnCount`, `rowCount` |

---

## Using FileDef in Cards

```gts
import { CardDef, field, linksTo } from '@cardstack/base/card-api';
import ImageDef from '@cardstack/base/image-file-def';
import PngDef from '@cardstack/base/png-image-def';
import FileDef from '@cardstack/base/file-api';
import MarkdownDef from '@cardstack/base/markdown-file-def';

export class ProductListing extends CardDef {
  @field photo = linksTo(PngDef); // Specifically PNG
  @field banner = linksTo(ImageDef); // Any image format
  @field attachment = linksTo(FileDef); // Any file type
  @field readme = linksTo(MarkdownDef); // Markdown document
}
```

---

## Rendering File Fields in Templates

Use `<@fields.fieldName />` exactly as with any other field. The built-in display components handle rendering automatically.

```gts
static isolated = class Isolated extends Component<typeof ProductListing> {
  <template>
    <div class='product'>
      {{! Full image with filename and dimensions shown }}
      <@fields.photo @format="isolated" />

      {{! Responsive inline image filling its container }}
      <@fields.banner @format="embedded" />

      {{! Thumbnail + filename (good for lists/atom use) }}
      <@fields.photo @format="atom" />

      {{! Access raw metadata directly when needed }}
      <p>{{@model.photo.name}} ({{@model.photo.width}}×{{@model.photo.height}}px)</p>
      <p>Size: {{@model.attachment.contentSize}} bytes</p>
    </div>
  </template>
};
```

**Image built-in formats:**

- `isolated` → full-size image + filename + dimensions footer
- `embedded` → responsive `<img>` that fills its container width
- `fitted` → `background-image: cover` for fixed-size grid cells
- `atom` → 20 px thumbnail + filename inline

---

## MarkdownDef vs MarkdownField

These are completely different and are **not interchangeable**:

|                          | `MarkdownDef`                                                                   | `MarkdownField`                                                             |
| ------------------------ | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| **Kind**                 | FileDef — a `.md` file in the realm                                             | FieldDef — inline text stored in the card's JSON                            |
| **Import**               | `@cardstack/base/markdown-file-def`                                             | `@cardstack/base/markdown`                                                  |
| **Declaration**          | `@field notes = linksTo(MarkdownDef)`                                           | `@field notes = contains(MarkdownField)`                                    |
| **Stored as**            | Separate `.md` file referenced by URL                                           | String embedded in the card's `.json`                                       |
| **Has own URL?**         | ✅ Yes — shareable and reusable                                                 | ❌ No — owned by the containing card                                        |
| **Editable in card UI?** | ❌ No — replaced by uploading a new file                                        | ✅ Yes — inline markdown editor                                             |
| **Extra fields**         | `title`, `excerpt`, `content` auto-extracted                                    | Raw markdown string only                                                    |
| **Use when**             | Stand-alone documents, content shared across cards, files managed outside Boxel | Inline rich text that belongs to the card, like a description or body field |

---

## FileDef vs Base64ImageField

**🚨 Do NOT use `Base64ImageField` for images.** Use an image FileDef type instead.

|                     | FileDef (`ImageDef`, `PngDef`, etc.) | `Base64ImageField`                       |
| ------------------- | ------------------------------------ | ---------------------------------------- |
| **Storage**         | Separate file in the realm           | Base64 data embedded in the card's JSON  |
| **AI context cost** | ✅ Minimal — just a URL reference    | ❌ Extremely large — can exhaust context |
| **Shareable**       | ✅ Yes — has its own URL             | ❌ No — embedded in one card             |
| **Performance**     | ✅ Standard HTTP caching             | ❌ Bloated JSON payloads                 |
| **Use**             | ✅ Always prefer this                | ⚠️ Avoid                                 |
