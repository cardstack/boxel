## FileDef vs Base64ImageField

**🚨 Do NOT use `Base64ImageField` or `StringField` data URIs for images.** Use an image FileDef type instead.

|                     | FileDef (`ImageDef`, `PngDef`, etc.) | `Base64ImageField`                       |
| ------------------- | ------------------------------------ | ---------------------------------------- |
| **Storage**         | Separate file in the realm           | Base64 data embedded in the card's JSON  |
| **AI context cost** | ✅ Minimal — just a URL reference    | ❌ Extremely large — can exhaust context |
| **Shareable**       | ✅ Yes — has its own URL             | ❌ No — embedded in one card             |
| **Performance**     | ✅ Standard HTTP caching             | ❌ Bloated JSON payloads                 |
| **Use**             | ✅ Always prefer this                | ⚠️ Avoid                                 |

This rule also applies to:

- `@field outputImageUrl = contains(StringField)` populated with `data:image/...;base64,...`
- `@field outputText = contains(StringField)` populated with model text that includes a data URI
- JSON attributes that hold MP3/image/file bytes
- Notes/summary fields that accidentally capture raw model image payloads

Generated media workflow: keep the data URI transient, write the bytes with `@cardstack/boxel-host/tools/write-binary-file`, then store `linksTo(PngDef/ImageDef/FileDef)`.
