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
