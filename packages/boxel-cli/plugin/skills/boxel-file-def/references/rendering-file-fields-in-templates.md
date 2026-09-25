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

### Rendering a file's content only (no file chrome)

By default a FileDef field renders **wrapped**: the isolated view is a file inspector (file bar with Download / Copy link, plus metadata groups). That wrapped view is the intended default for browsing a file.

To make a file's **content** read as content — a markdown document as prose, an image on its own, audio as just a player — with none of that chrome, embed the exported content-only preview component instead of the field:

```gts
import { MarkdownPreview } from '@cardstack/base/file-formats/index';
// also exported: ImagePreview, AudioPreview

// @model is the linked FileDef instance. @displayContainer={{false}} lets your
// own layout own the geometry. @format defaults to 'embedded' (complete
// content); 'isolated' is also complete content; 'fitted' is a small budgeted
// snippet for a collection cell.
{{#if @model.readme}}
  <MarkdownPreview @model={{@model.readme}} @format='isolated' @displayContainer={{false}} />
{{/if}}
```

The exported content-only components are `MarkdownPreview`, `ImagePreview`, and `AudioPreview`. When you embed them directly, loading and error states are yours to handle (the wrapped field render handles them for you).

**Do not** simulate a content-only render by rendering the field and hiding the chrome with CSS:

```gts
{{! ANTI-PATTERN — brittle; the targeted classes are renderer-internal and break silently }}
<@fields.readme @format='embedded' @displayContainer={{false}} />
<style scoped>
  :deep(.markdown-embedded__title) { display: none; }
  :deep(.markdown-embedded__content) { max-height: none; }
</style>
```

Reach for the content-only component instead. A plain `<@fields.x @format='embedded' />` with no chrome-fighting is correct when you *do* want the wrapped view.

---
