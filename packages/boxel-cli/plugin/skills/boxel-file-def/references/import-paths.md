## Import Paths

```gts
import FileDef from 'https://cardstack.com/base/file-api';

// Image types
import ImageDef from 'https://cardstack.com/base/image-file-def';
import PngDef from 'https://cardstack.com/base/png-image-def';
import JpgDef from 'https://cardstack.com/base/jpg-image-def';
import SvgDef from 'https://cardstack.com/base/svg-image-def';
import GifDef from 'https://cardstack.com/base/gif-image-def';
import WebpDef from 'https://cardstack.com/base/webp-image-def';
import AvifDef from 'https://cardstack.com/base/avif-image-def';

// Document / text types
import MarkdownDef from 'https://cardstack.com/base/markdown-file-def';
import TextFileDef from 'https://cardstack.com/base/text-file-def';
import TsFileDef from 'https://cardstack.com/base/ts-file-def';
import GtsFileDef from 'https://cardstack.com/base/gts-file-def';
import JsonFileDef from 'https://cardstack.com/base/json-file-def';
import CsvFileDef from 'https://cardstack.com/base/csv-file-def';
```

### Named vs default export

Most FileDef subtypes are **default-exported** (`import ImageDef from ...`). A few are **named-exported** — confirmed from the monorepo + live realm checks:

```ts
import { MarkdownDef } from 'https://cardstack.com/base/markdown-file-def';
import { SvgDef } from 'https://cardstack.com/base/svg-image-def';
import { PngDef } from 'https://cardstack.com/base/png-image-def';
import { CsvFileDef } from 'https://cardstack.com/base/csv-file-def';
import { TextFileDef } from 'https://cardstack.com/base/text-file-def';
```

If the import compiles but the linked field resolves to `undefined` at render time, swap default ↔ named — that's the usual fix.

### No generic PDF / DOC / DOCX FileDef in `packages/base`

There is **no base FileDef for PDF or Microsoft-Office document formats** in the current `packages/base` checkout. If a skill, learning, or older doc suggests one (`PdfDef`, `DocxDef`, etc.), verify against the monorepo before generating code. For PDFs, the working path is `linksTo(FileDef)` (the generic base) with the file uploaded under a clear filename like `whitepaper.pdf` — see `show-pdf-annotations-filedef` for the canonical viewer pattern.

When adding a new file-typed CardDef, **validate by saving a real linked file and rendering the field in browser QA**, not just by trusting that the import compiles.

---
