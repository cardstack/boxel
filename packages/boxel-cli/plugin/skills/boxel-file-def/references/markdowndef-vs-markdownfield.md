## MarkdownDef vs MarkdownField

These are completely different and are **not interchangeable**:

|                          | `MarkdownDef`                                                                   | `MarkdownField`                                                             |
| ------------------------ | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| **Kind**                 | FileDef — a `.md` file in the realm                                             | FieldDef — inline text stored in the card's JSON                            |
| **Import**               | `https://cardstack.com/base/markdown-file-def`                                  | `https://cardstack.com/base/markdown`                                       |
| **Declaration**          | `@field notes = linksTo(MarkdownDef)`                                           | `@field notes = contains(MarkdownField)`                                    |
| **Stored as**            | Separate `.md` file referenced by URL                                           | String embedded in the card's `.json`                                       |
| **Has own URL?**         | ✅ Yes — shareable and reusable                                                 | ❌ No — owned by the containing card                                        |
| **Editable in card UI?** | ❌ No — replaced by uploading a new file                                        | ✅ Yes — inline markdown editor                                             |
| **Extra fields**         | `title`, `excerpt`, `content` auto-extracted                                    | Raw markdown string only                                                    |
| **Use when**             | Stand-alone documents, content shared across cards, files managed outside Boxel | Inline rich text that belongs to the card, like a description or body field |

---
