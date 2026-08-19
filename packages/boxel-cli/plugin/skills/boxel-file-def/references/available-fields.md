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
