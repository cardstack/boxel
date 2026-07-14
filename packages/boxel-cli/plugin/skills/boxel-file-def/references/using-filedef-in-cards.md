## Using FileDef in Cards

```gts
import { CardDef, field, linksTo } from 'https://cardstack.com/base/card-api';
import ImageDef from 'https://cardstack.com/base/image-file-def';
import PngDef from 'https://cardstack.com/base/png-image-def';
import FileDef from 'https://cardstack.com/base/file-api';
import MarkdownDef from 'https://cardstack.com/base/markdown-file-def';

export class ProductListing extends CardDef {
  @field photo = linksTo(PngDef); // Specifically PNG
  @field banner = linksTo(ImageDef); // Any image format
  @field attachment = linksTo(FileDef); // Any file type
  @field readme = linksTo(MarkdownDef); // Markdown document
}
```

## Binary File Example

The A Million Dreams karaoke card keeps a multi-megabyte MP3 out of card JSON by linking to the realm file:

```gts
import { FileDef, ImageDef, linksTo } from 'https://cardstack.com/base/card-api';

@field mp3FileDef = linksTo(FileDef);
@field coverArt = linksTo(ImageDef);
```

```json
"relationships": {
  "mp3FileDef": {
    "links": {
      "self": "./a-million-dreams-karaoke-assets/amd-192.mp3"
    }
  },
  "coverArt": {
    "links": {
      "self": "./a-million-dreams-karaoke-assets/a-million-dreams-cover.jpeg"
    }
  }
}
```

The card stores links only. The MP3/JPEG bytes live as separate realm files.

## Generated File From A Command

When generated media arrives as a `data:image/...;base64,...`, write it to the realm before saving the card:

```gts
import WriteBinaryFileCommand from '@cardstack/boxel-host/tools/write-binary-file';
import { ImageDef, linksTo } from 'https://cardstack.com/base/card-api';

@field outputImage = linksTo(ImageDef);

let writeResult = await new WriteBinaryFileCommand(commandContext).execute({
  path: 'GeneratedImages/result.png',
  realm: realmUrl,
  base64Content,
  contentType: 'image/png',
  useNonConflictingFilename: true,
});

card.outputImage = new ImageDef({
  id: writeResult.fileIdentifier,
  sourceUrl: writeResult.fileIdentifier,
  url: writeResult.fileIdentifier,
  name: 'result.png',
  contentType: 'image/png',
});
```

Reference implementation: `packages/host/app/tools/screenshot-card.ts` writes screenshot PNG bytes with `WriteBinaryFileCommand`, and `packages/host/tests/integration/commands/write-binary-file-test.gts` verifies the file is accessible and byte-identical afterward.

---

## File-typed relationships need the file extension

When a card relationship links to a FileDef subclass (`MarkdownDef`, `PngDef`, `CsvFileDef`, etc.), the relationship path is the **actual filename, including extension**:

```json
"sourceBrief": {
  "links": { "self": "../launch-evidence-brief.md" }
}
```

Card-instance links can omit `.json` because card IDs are extensionless. **File links cannot** — the realm indexes files by extension-backed filename, so `MarkdownDef` files are indexed as `guide.md`, `sample.md`, etc., not the bare slug.

Symptom of dropping the extension: the file exists in the realm and indexes correctly as `MarkdownDef`, but the **parent card** doesn't appear in type-filtered search because the FileDef relationship fails to resolve. The card itself looks fine on disk; the problem is invisible from the UI.

Platform evidence: `packages/realm-server/tests/card-endpoints-test.ts` includes a `linksTo(MarkdownDef)` fixture using `self: '../instructions.md'`. File-meta tests confirm markdown files are indexed by their extension-backed filename.

For the wider story on `links.self` shapes (`./Foo/bar` vs `../Foo/bar` vs bare-specifier traps), see `boxel/references/card-references.md`.

---
