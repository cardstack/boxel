## FileDef — First-Class File Support

`FileDef` is a **third kind of "def"** in Boxel, alongside `CardDef` and `FieldDef`. A FileDef instance represents a file that lives in the realm — an image, document, or other asset — with metadata automatically extracted during indexing.

### Key Rules

- **FileDef instances have their own identity** (like cards), so you reference them with `linksTo`, never `contains`
- **Render them using the same display formats** — FileDefs have `isolated`, `embedded`, `fitted`, and `atom` templates
- **Files are not editable via the card edit interface** — users replace them by uploading a new file

---
