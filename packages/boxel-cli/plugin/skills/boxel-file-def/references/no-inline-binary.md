# No Inline Binary Or Media Payloads

Media bytes do not belong in card JSON. Never persist generated images, uploaded files, MP3 bytes, `data:` URLs, `blob:` URLs, base64 strings, ArrayBuffer text, or large binary-ish payloads in `StringField`, `TextAreaField`, `outputText`, JSON attributes, notes, or `Base64ImageField`.

The failure mode is explicit:

```text
Card size (...) exceeds maximum allowed size (524288 bytes)
```

Even below the hard limit, inline media bloats indexing, search, AI context, sync, and every card fetch.

## Correct Pattern

1. Receive the bytes or data URL transiently.
2. Write the bytes as a real realm file with `WriteBinaryFileCommand`.
3. Store only a relationship on the domain card.
4. Render the linked FileDef URL.

Use one of:

```gts
@field image = linksTo(ImageDef);
@field png = linksTo(PngDef);
@field attachment = linksTo(FileDef);
```

For AI image APIs that return a `data:image/...;base64,...`, strip the `data:mime/type;base64,` prefix, write the base64 payload with:

```gts
import WriteBinaryFileCommand from '@cardstack/boxel-host/tools/write-binary-file';
import { ImageDef, linksTo } from 'https://cardstack.com/base/card-api';

@field generatedImage = linksTo(ImageDef);

let result = await new WriteBinaryFileCommand(commandContext).execute({
  path: 'GeneratedImages/result.png',
  realm: realmUrl,
  base64Content,
  contentType: 'image/png',
  useNonConflictingFilename: true,
});

card.generatedImage = new ImageDef({
  id: result.fileIdentifier,
  sourceUrl: result.fileIdentifier,
  url: result.fileIdentifier,
  name: 'result.png',
  contentType: 'image/png',
});
```

This is the same host-command family used by `packages/host/app/tools/screenshot-card.ts`: write a PNG file to the card's realm, then link the file. A data URL is acceptable only as a command input or temporary `@tracked` preview while the file write is in flight.

## A Million Dreams Example

`realms-staging.stack.cards/ctse/personal/a-million-dreams-karaoke.gts` handles MP3 and cover art correctly:

```gts
import { FileDef, ImageDef, linksTo } from 'https://cardstack.com/base/card-api';

@field mp3FileDef = linksTo(FileDef);
@field coverArt = linksTo(ImageDef);
```

The instance stores relationships to realm files, not bytes:

```json
{
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
}
```

The MP3 is a 4MB realm file. The card JSON remains small because it stores only the link.

## Bad Patterns

```gts
@field outputImageUrl = contains(StringField); // then storing data:image/base64
@field outputText = contains(StringField);     // then storing model content with data URI
@field image = contains(Base64ImageField);
```

If a model response contains a data URI inside text, strip it before saving:

```ts
text.replace(
  /data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g,
  '[image payload omitted]',
);
```
