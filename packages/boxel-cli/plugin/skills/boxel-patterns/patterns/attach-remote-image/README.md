---
validated: source-proven
---

# attach-remote-image — image field that accepts external URL OR uploaded ImageDef

**What this gives you:** A schema + template pair that lets a card carry an image as EITHER a `linksTo(ImageDef)` (uploaded into the realm) OR a string URL (Unsplash, CDN, S3, any `https://` URL). The template resolves at render time, preferring the URL when set.

**When to use:** Any CardDef that should display an image when the author has provided one of two ways — uploaded bytes via FileDef OR an external URL. This is the pattern to reach for whenever an AI agent might be tempted to drop an Unsplash URL into a card.

**Why this matters:** Putting an external URL directly into a relationship's `links.self` BRICKS the realm. The indexer fetches the URL expecting a card document, gets JPEG/PNG binary bytes, JSON.parse throws on the binary, the error message contains the binary's NULL byte, postgres rejects the JSONB write (`22P05: unsupported Unicode escape sequence`), and the entire indexing transaction rolls back — every successfully-rendered sibling card in the batch is lost. The whole realm stays unindexed until the bad instance is fixed. See `boxel/SKILL.md` Cardinal Rule 13.

**The insight:** This is the same pair pattern base `cardInfo` already uses for thumbnails (`base/card-api.gts:2892-2893`):

```ts
@field cardThumbnail = linksTo(() => ImageDef);
@field cardThumbnailURL = contains(MaybeBase64Field);
```

Two fields, one logical concept, template-side resolution.

## Recipe

### Schema (single image)

```gts
import { CardDef, Component, contains, field, linksTo } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import UrlField from 'https://cardstack.com/base/url';
import ImageDef from 'https://cardstack.com/base/image';

export class Property extends CardDef {
  static displayName = 'Property';

  @field address = contains(StringField);
  @field heroImage = linksTo(() => ImageDef);  // for uploaded card-side images
  @field heroImageURL = contains(UrlField);    // for external URLs

  static isolated = class Isolated extends Component<typeof Property> {
    <template>
      <article>
        <h1>{{@model.address}}</h1>
        {{#if @model.heroImageURL}}
          <img src={{@model.heroImageURL}} alt='' class='hero' />
        {{else}}
          <@fields.heroImage @format='embedded' />
        {{/if}}
      </article>
      <style scoped>
        .hero { width: 100%; height: auto; display: block; }
      </style>
    </template>
  };
  // ... embedded + fitted formats analogously
}
```

### Schema (gallery — linksToMany)

```gts
@field galleryImages = linksToMany(ImageDef);
@field galleryImageURLs = containsMany(UrlField);
```

Template:

```hbs
{{#if @model.galleryImageURLs.length}}
  <div class='gallery'>
    {{#each @model.galleryImageURLs as |url|}}
      <img src={{url}} alt='' />
    {{/each}}
  </div>
{{else}}
  <@fields.galleryImages @format='embedded' />
{{/if}}
```

### Instance JSON — external URL form

```json
{
  "data": {
    "type": "card",
    "attributes": {
      "address": "27 Spruce Lane",
      "heroImageURL": "https://images.unsplash.com/photo-1568605114967-8130f3a36994?auto=format&fit=crop&w=1600"
    },
    "relationships": {
      "heroImage": { "links": { "self": null } }
    },
    "meta": {
      "adoptsFrom": { "module": "../property", "name": "Property" }
    }
  }
}
```

### Instance JSON — uploaded ImageDef form

```json
{
  "data": {
    "type": "card",
    "attributes": {
      "address": "27 Spruce Lane"
    },
    "relationships": {
      "heroImage": { "links": { "self": "../Images/spruce-front" } }
    },
    "meta": {
      "adoptsFrom": { "module": "../property", "name": "Property" }
    }
  }
}
```

The relationship link points at a real ImageDef instance in the realm — never at an external URL.

## Gotchas

- **NEVER cross-mix.** Don't put an external URL into `relationships.heroImage.links.self`. That's the realm-bricking shape. The relationship is for in-realm card identifiers only.
- **Use `UrlField`, not `StringField`, and not `MaybeBase64Field`.** `UrlField` (from `https://cardstack.com/base/url`) extends `StringField` with URL-shape validation in edit mode. The base `cardInfo` field uses `MaybeBase64Field` for historical reasons (it also accepts inline base64) — don't follow that lead in new code; `UrlField` is the canonical choice for an external HTTP(S) URL.
- **Empty string vs null.** When clearing the URL, set the JSON value to `null` not `""` — empty strings can confuse downstream consumers expecting truthiness.

## Source

- Pattern shape from base `cardInfo`: `~/Projects/boxel/packages/base/card-api.gts:2892-2893` (cardThumbnail + cardThumbnailURL).
- Real-world application across 10 schemas in the institutional-meerkat realm, 2026-05-22 (after diagnosing the realm-bricking bug). Affected fields: `events/event.gts heroImage`, `events/speaker.gts portraitImage`, `events/venue.gts heroImage`, `real-estate/agent.gts headshot`, `real-estate/property.gts heroImage + galleryImages`, `marketing/campaign.gts heroImage`, `hr/employee-stub.gts photo`, `hr/candidate.gts portraitImage`, `loyalty/merchant.gts logo`, `loyalty/reward.gts heroImage`.

## See also

- `boxel/SKILL.md` Cardinal Rule 13 — the realm-bricking failure mode this pattern prevents.
- `boxel/references/base-field-catalog.md` "Image fields — the URL/ImageDef pair pattern".
- `boxel-file-def/SKILL.md` — for uploading bytes into the realm via `WriteBinaryFileCommand` → `ImageDef`.
- `integrate-openrouter-image-generation` — when generating images via OpenRouter, the resulting bytes become an ImageDef (linked side); use this pattern when the source could be either generated bytes OR a hand-picked external URL.

## Future direction

A single compound `Image` FieldDef that wraps either a URL or an ImageDef link and exposes a unified `.src` accessor. Until then, the pair-of-fields approach is canonical.
