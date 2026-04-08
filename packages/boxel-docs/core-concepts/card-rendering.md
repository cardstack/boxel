# Card Rendering & Formats

Cards render in multiple formats depending on context. A single card definition can appear as a full page, a compact embed, an adaptive thumbnail, an editor form, or a minimal chip — all from the same class.

## The Five Formats

### 1. `isolated` — Full Page View

The primary, full-sized rendering of a card. Used when a card is the main content.

```typescript
static isolated = class Isolated extends Component<typeof BlogPost> {
  <template>
    <article class="blog-post">
      <h1><@fields.title /></h1>
      <div class="meta">
        <@fields.author /> · <@fields.publishDate />
      </div>
      <div class="body"><@fields.body /></div>
    </article>
  </template>
};
```

### 2. `embedded` — Compact Preview

A smaller representation used when a card appears inside another card or in search results.

```typescript
static embedded = class Embedded extends Component<typeof BlogPost> {
  <template>
    <div class="blog-preview">
      <strong><@fields.title /></strong>
      <span><@fields.author /></span>
    </div>
  </template>
};
```

### 3. `fitted` — Adaptive Layout

A responsive format that adapts to its container using CSS container queries. Ideal for grid layouts where cards can be any size.

```typescript
static fitted = class Fitted extends Component<typeof Contact> {
  <template>
    <div class="contact-fitted">
      <div class="avatar"><@fields.avatar /></div>
      <div class="info">
        <strong><@fields.fullName /></strong>
        <span class="title"><@fields.jobTitle /></span>
      </div>
    </div>
    <style scoped>
      .contact-fitted {
        display: flex;
        gap: var(--boxel-sp-sm);
        padding: var(--boxel-sp-xs);
        height: 100%;
      }

      /* Adapt based on container size */
      @container fitted-card (max-height: 100px) {
        .avatar { display: none; }
      }

      @container fitted-card (max-height: 57px) {
        .title { display: none; }
      }

      @container fitted-card (aspect-ratio > 1.0) {
        .contact-fitted { flex-direction: row; }
      }

      @container fitted-card (aspect-ratio <= 1.0) {
        .contact-fitted { flex-direction: column; }
      }
    </style>
  </template>
};
```

### 4. `edit` — Form View

The editing interface for a card. Field components automatically render as inputs.

```typescript
static edit = class Edit extends Component<typeof BlogPost> {
  <template>
    <div class="blog-edit">
      <label>Title <@fields.title /></label>
      <label>Author <@fields.author /></label>
      <label>Body <@fields.body /></label>
    </div>
  </template>
};
```

When rendered in `edit` format, `<@fields.title />` becomes a text input, `<@fields.body />` becomes a textarea, etc. Each field type controls its own edit rendering.

### 5. `atom` — Minimal Chip

The smallest representation — typically just the card title as inline text.

```typescript
static atom = class Atom extends Component<typeof BlogPost> {
  <template>
    <span class="blog-atom">{{@model.title}}</span>
  </template>
};
```

## Format Summary

| Format | Size | Editing | Context |
|--------|------|---------|---------|
| `isolated` | Full page | No | Main content |
| `embedded` | Compact card | No | Inside other cards, search |
| `fitted` | Adaptive | No | Grid layouts, containers |
| `edit` | Full page | Yes | Card editing |
| `atom` | Inline text | No | Dense lists, chips |

## Default Templates

If you don't provide a template for a format, Boxel uses **default templates** that automatically render all fields:

- **Isolated/Edit default**: Shows card info header, all fields in a list layout, and notes
- **Embedded default**: Shows thumbnail, title, type, and description
- **Atom default**: Shows the card title or "Untitled [Type]"

## How Field Rendering Works

The `<@fields.fieldName />` syntax renders a field using its own component. The format cascades:

```
Card format       → Field renders as
─────────────────────────────────────
isolated          → embedded
embedded          → embedded
fitted            → fitted
edit              → edit
atom              → atom
```

Fields in `edit` format on a card render as their `edit` format (inputs). In all other card formats, fields render as their `embedded` format (display values).

### Explicit Format Override

You can override the format for a specific field:

```typescript
<@fields.company @format="atom" />
```

## Rendering Pipeline

```
1. Card instance loaded from realm
         ↓
2. Card class resolved (adoptsFrom → module)
         ↓
3. Format determined (isolated/embedded/fitted/edit/atom)
         ↓
4. Template component retrieved for that format
         ↓
5. Glimmer renders template with @model and @fields
         ↓
6. Each <@fields.x /> resolves field's own component
         ↓
7. Scoped CSS applied per component
```

## Re-rendering

Boxel uses Glimmer's reactive tracking system for efficient re-renders:

1. Field values are tracked via `TrackedWeakMap`
2. When a field value changes, Glimmer invalidates only affected components
3. Computed fields automatically re-evaluate when their dependencies change
4. The UI updates without full page reloads

## Themes

Cards can have themes that apply CSS variables:

```typescript
export class MyCard extends CardDef {
  static headerColor = '#6366f1';
  static prefersWideFormat = true;
}
```

The `Theme` card type allows defining reusable CSS variable sets that can be applied to cards.

## Prerendering

For published realms, cards are prerendered to static HTML for performance and SEO:

- **`isolated_html`** — Full card HTML
- **`atom_html`** — Minimal representation
- **`fitted_html`** — Adaptive layout HTML
- **`head_html`** — Meta tags, title, OpenGraph data

Prerendering happens via headless Chrome (Puppeteer) during indexing.

## Next Steps

- [Styling Cards](/card-development/styling) — CSS and theming details
- [Templates & Components](/card-development/templates) — Template API
- [Serialization](/core-concepts/serialization) — JSON-API format
