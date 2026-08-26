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

### Named vs default export

Most FileDef subtypes are **default-exported** (`import ImageDef from ...`). A few are **named-exported** — confirmed from the monorepo + live realm checks:

```ts
import { MarkdownDef } from '@cardstack/base/markdown-file-def';
import { SvgDef }      from '@cardstack/base/svg-image-def';
import { PngDef }      from '@cardstack/base/png-image-def';
import { CsvFileDef }  from '@cardstack/base/csv-file-def';
import { TextFileDef } from '@cardstack/base/text-file-def';
```

If the import compiles but the linked field resolves to `undefined` at render time, swap default ↔ named — that's the usual fix.

### No generic PDF / DOC / DOCX FileDef in `packages/base`

There is **no base FileDef for PDF or Microsoft-Office document formats** in the current `packages/base` checkout. If a skill, learning, or older doc suggests one (`PdfDef`, `DocxDef`, etc.), verify against the monorepo before generating code. For PDFs, the working path is `linksTo(FileDef)` (the generic base) with the file uploaded under a clear filename like `whitepaper.pdf` — see `show-pdf-annotations-filedef` for the canonical viewer pattern.

When adding a new file-typed CardDef, **validate by saving a real linked file and rendering the field in browser QA**, not just by trusting that the import compiles.

---
