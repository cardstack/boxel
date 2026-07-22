# Base field catalog — what ships in `https://cardstack.com/base/*`

Every field listed here is importable from a stable URL and ready to use without code. Reach for the specific type instead of `StringField` whenever the value has a known shape — you get validation, a tailored editor, formatting, and queryability for free.

## Primitives & string variants

| Field | Import | Notes |
|---|---|---|
| `StringField` | `'https://cardstack.com/base/string'` | The default for any text. Default import. |
| `NumberField` | `'https://cardstack.com/base/number'` | Any numeric value. Default import. |
| `BooleanField` | `'https://cardstack.com/base/boolean'` | Checkbox in edit mode. |
| `BigIntegerField` | `'https://cardstack.com/base/big-integer'` | For values beyond `Number.MAX_SAFE_INTEGER`. |
| `TextAreaField` | `'https://cardstack.com/base/text-area'` | Multi-line plain text (sub-page). For paragraphs that aren't markdown. |
| `EmailField` | `'https://cardstack.com/base/email'` | Validates as `user@domain`. Renders as `mailto:` link. |
| `UrlField` | `'https://cardstack.com/base/url'` | Validates URL shape. Renders as `<a>` in non-edit modes. |
| `PhoneNumberField` | `'https://cardstack.com/base/phone-number'` | Country code + national number. Compound field. |
| `EthereumAddressField` | `'https://cardstack.com/base/ethereum-address'` | Web3 address with checksum validation. |
| `ColorField` | `'https://cardstack.com/base/color'` | Renders a color swatch + picker in edit mode. |

## Time

| Field | Import | Notes |
|---|---|---|
| `DateField` | `'https://cardstack.com/base/date'` | Date only (no time). JSON value MUST be `YYYY-MM-DD`. |
| `DateTimeField` | `'https://cardstack.com/base/datetime'` | Date + time. JSON value MUST be ISO datetime with `T` — `YYYY-MM-DDTHH:MM:SS[.sss]Z`. |
| `TimeField` | `'https://cardstack.com/base/time'` | Time of day only. |
| `DateRangeField` | `'https://cardstack.com/base/date-range-field'` | Start + end date as a single compound field — use this instead of two `DateField`s for trips, bookings, periods. |
| `DateTimeStampField` | `'https://cardstack.com/base/datetime-stamp'` | Immutable "stamped at" datetime. Auto-populates on first save. |

### 🚨 Image fields — the URL/ImageDef pair pattern

**Never put an external image URL in a `linksTo(ImageDef)` relationship's `links.self`.** Doing so bricks the entire realm: the indexer fetches the URL expecting a card document, gets JPEG/PNG binary bytes, JSON.parse throws on the binary, the error message contains the binary's NULL byte, postgres rejects the JSONB write (`22P05: unsupported Unicode escape sequence`), the transaction rolls back, and every successfully-rendered sibling card in the batch is lost. The realm stays unindexed until the bad instance is fixed.

**The fix — pair pattern modeled on `cardInfo` (`base/card-api.gts:2892-2893`):**

```ts
import UrlField from 'https://cardstack.com/base/url';
import ImageDef from 'https://cardstack.com/base/image-file-def';   // ← correct module
// OR equivalently: import { ImageDef } from 'https://cardstack.com/base/card-api';

// On the CardDef:
@field heroImage = linksTo(() => ImageDef);  // for uploaded card-side images
@field heroImageURL = contains(UrlField);    // for external URLs (Unsplash, CDN, S3)
```

> **Critical import distinction.** `ImageDef` (file-backed, extends FileDef) is defined in `base/card-api.gts` and re-exported by `base/image-file-def`. Both `import ImageDef from '.../base/image-file-def'` (default) and `import { ImageDef } from '.../base/card-api'` (named) work and reference the same class. **DO NOT** write `import ImageDef from 'https://cardstack.com/base/image'` — that module's default is `ImageCard` (deprecated, extends CardDef). The local alias makes lint happy, but at runtime you get the wrong class, and the field schema is broken.

> **Why `UrlField` not `StringField`** (and not `MaybeBase64Field` even though `cardInfo` uses it): `UrlField` extends `StringField`, adds URL-shape validation on the edit form, and renders as a clickable link in atom format. It's the correct shape for an external HTTP(S) URL. The base `cardInfo` uses `MaybeBase64Field` for historical reasons (it accepts inline base64 too) — **don't propagate that to new code**. For new schemas, always reach for `UrlField`.

```hbs
{{!-- In the template — URL preferred, linked image as fallback --}}
{{#if @model.heroImageURL}}
  <img src={{@model.heroImageURL}} alt='' class='hero' />
{{else}}
  <@fields.heroImage @format='embedded' />
{{/if}}
```

```json
{{!-- In the JSON instance --}}
"attributes": {
  "heroImageURL": "https://images.unsplash.com/photo-..."
},
"relationships": {
  "heroImage": { "links": { "self": null } }
}
```

The exact same pattern is what base `cardInfo` uses:

```ts
@field cardThumbnail = linksTo(() => ImageDef);
@field cardThumbnailURL = contains(MaybeBase64Field);
```

For a `linksToMany(ImageDef)` gallery, the URL twin is `containsMany(UrlField)`:

```ts
@field galleryImages = linksToMany(() => ImageDef);   // thunk for cycle safety
@field galleryImageURLs = containsMany(UrlField);
```

**The contract:**

- `relationships.<field>.links.self` is for card identifiers — relative paths (`"../Theme/foo"`) or absolute realm URLs only.
- External URLs (Unsplash, S3, CDN, any `https://` URL pointing at non-card content) go in `attributes.<field>URL` on the URL-twin field.
- Uploaded card-side images go in the linked ImageDef as a normal `linksTo` relationship.

**Future direction (not implemented yet):** a single compound `Image` FieldDef that wraps either a URL or an ImageDef link and exposes a unified `.src` accessor. Until then, use the pair-of-fields approach above.

### 🔴 DateField vs DateTimeField — the schema-vs-value contract

The most common silent failure pattern in Boxel card families: declaring `contains(DateField)` in the .gts but writing an ISO datetime (`"2026-06-13T15:30:00Z"`) in the JSON instance, OR declaring `contains(DateTimeField)` and writing only `"2026-06-13"`.

**What happens:** lint passes. `npx boxel file write` succeeds. The realm indexes the card. The mismatch only surfaces when the host tries to render or re-serialize the instance — `date-fns` `format()` is called on a Date object built from the wrong-shaped string, and throws:

```
RangeError: Invalid time value
  at format (host-bundle date-fns)
  at Module.serialize (base/date | base/datetime)
  at Contains.serialize
  at Proxy.serializedGet
  at serializeCardResource
```

**The contract — drill it in:**

| Schema | Required JSON value shape | Wrong example |
|---|---|---|
| `contains(DateField)` | `"YYYY-MM-DD"` — no `T`, no time component | `"2026-06-13T00:00:00Z"` |
| `contains(DateTimeField)` | `"YYYY-MM-DDTHH:MM:SS[.sss]Z"` — must contain `T` | `"2026-06-13"` |

**Picking the type:** use the field-name suffix as the guide:

- `*At` (`startAt`, `joinedAt`, `occurredAt`, `placedAt`, `scheduledAt`, `subscribedAt`) → moment in time → **DateTimeField**
- `*Date`, `*On` (`closeDate`, `effectiveDate`, `hireDate`, `signedDate`, `startsOn`, `endsOn`, `foundedDate`) → calendar date → **DateField**
- `dob`, `*Birth*` → calendar date → **DateField**
- "Will I ever want to display the time-of-day?" — if yes, DateTimeField. If no, DateField.

**Cross-check before declaring done:**

```sh
# For each .gts in your kit, list its date/datetime fields:
grep -E "@field \w+ = contains\(Date(Time)?Field" <kit>/*.gts

# Then for each instance, confirm the value shape matches.
# Datetime-typed should contain 'T'; date-typed should not.
```

Pair this static check with at least one runtime instantiation:

```sh
npx boxel run-command @cardstack/boxel-host/tools/instantiate-card/default \
  --realm <url> \
  --input '{"moduleIdentifier":"<module-url>","cardName":"<ClassName>","realmIdentifier":"<url>"}'
```

The mismatch will surface in the result's `error` / `stackTrace` if it's present.

## Money & quantities

| Field | Import | Notes |
|---|---|---|
| `PercentageField` | `'https://cardstack.com/base/percentage'` | Extends `NumberField`. Renders with `%` suffix in atom/embedded. |
| `AmountWithCurrency` | `'https://cardstack.com/base/amount-with-currency'` | Compound: number + Currency link. Use for prices, balances. |
| `CurrencyField` *(via `currency.gts`)* | `'https://cardstack.com/base/currency'` | Standalone currency code (USD/EUR/etc) for lookup tables. |

## Geographic & physical

| Field | Import | Notes |
|---|---|---|
| `AddressField` | `'https://cardstack.com/base/address'` | Street/city/state/zip/country as a compound field. |
| `CountryField` | `'https://cardstack.com/base/country'` | ISO country code with display name. |
| `CoordinateField` | `'https://cardstack.com/base/coordinate'` | Lat/long pair. Pairs with `library-leaflet` patterns. |

## Markdown & rich text

| Field | Import | Notes |
|---|---|---|
| `MarkdownField` | `'https://cardstack.com/base/markdown'` | Plain CommonMark string. Renders to HTML in non-edit; textarea editor. |
| `RichMarkdownField` | `'https://cardstack.com/base/rich-markdown'` | BFM-aware authoring surface with toolbar + slash menu. Use for cards where the body is the primary content (blog posts, docs). |

## File-backed (linksTo only)

These extend `FileDef` and must be used with `linksTo`, never `contains`. See `boxel-file-def/SKILL.md`.

| Field | Import | Notes |
|---|---|---|
| `FileDef` *(generic)* | `'https://cardstack.com/base/file-api'` | Generic file slot. Use a specific subtype when possible. |
| `ImageDef` | `'https://cardstack.com/base/image'` | Generic image. Polymorphic — accepts any image subtype. |
| `PngDef` | `'https://cardstack.com/base/png-image-def'` | PNG-specific. |
| `JpgDef` | `'https://cardstack.com/base/jpg-image-def'` | JPG. |
| `WebpDef` | `'https://cardstack.com/base/webp-image-def'` | WebP. |
| `GifDef` | `'https://cardstack.com/base/gif-image-def'` | Animated GIF. |
| `AvifDef` | `'https://cardstack.com/base/avif-image-def'` | AVIF. |
| `SvgDef` | `'https://cardstack.com/base/svg-image-def'` | Inline SVG. |
| `MarkdownDef` | `'https://cardstack.com/base/markdown-file-def'` | File-backed markdown (the file IS the content; rendered server-side). |
| `CsvFileDef` | `'https://cardstack.com/base/csv-file-def'` | CSV file with parsed access. |
| `JsonFileDef` | `'https://cardstack.com/base/json-file-def'` | JSON file. |
| `GtsFileDef` | `'https://cardstack.com/base/gts-file-def'` | `.gts` source file (for tooling/preview cards). |
| `TsFileDef` | `'https://cardstack.com/base/ts-file-def'` | `.ts` source file. |
| `TextFileDef` | `'https://cardstack.com/base/text-file-def'` | Generic text file. |

## Metadata / schema

| Field | Import | Notes |
|---|---|---|
| `CodeRefField` | `'https://cardstack.com/base/code-ref'` | A `{ module, name }` reference to a CardDef class. Used in command inputs, type filters, query `on:` clauses. Stored as string-pair. |
| `AbsoluteCodeRefField` | `'https://cardstack.com/base/code-ref'` (named export) | Same shape but always resolves to absolute URLs. |
| `RealmField` | `'https://cardstack.com/base/realm'` | A realm reference for cross-realm queries / install targets. |
| `CssValueField` | `'https://cardstack.com/base/css-value'` | A typed CSS value (length, color, keyword) — used inside Theme system. |
| `TypographyField` | `'https://cardstack.com/base/typography'` | Font family + scale fields — used inside Theme cards. |

## Enum

| Helper | Import | Notes |
|---|---|---|
| `enumField(BaseField, { options })` | `'https://cardstack.com/base/enum'` (default export) | Wraps a base field with constrained values + a `BoxelSelect` editor. See `enumerations.md`. |

## Special

| Field | Import | Notes |
|---|---|---|
| `Tag` (CardDef) | `'https://cardstack.com/base/tag'` | A standalone CardDef for tags — link with `linksToMany(Tag)`. Not a FieldDef. |
| `PositionedCardField` | `'https://cardstack.com/base/positioned-card'` | A linksTo + x/y coordinates. For canvas/board layouts. |
| `Base64ImageField` | `'https://cardstack.com/base/base64-image'` | **Deprecated for new cards.** Embeds image bytes in the JSON. Use `linksTo(ImageDef)` instead — file is stored separately and the JSON stays small. |

## Decision guide

```
Need text?
├── Single line, generic → StringField
├── Email/URL/phone → EmailField / UrlField / PhoneNumberField
├── Multi-line plain → TextAreaField
└── Markdown
    ├── Stored on the card → MarkdownField (or RichMarkdownField for editor chrome)
    └── Stored as a file in the realm → linksTo(MarkdownDef)

Need a number?
├── Integer / decimal → NumberField
├── Percentage → PercentageField (renders %)
├── Price → AmountWithCurrency (number + Currency)
└── Beyond 2^53 → BigIntegerField

Need a date?
├── Single date → DateField
├── Date + time → DateTimeField
├── Range (start + end) → DateRangeField
└── Auto-stamped → DateTimeStampField

Need an image / file?
└── Always linksTo(ImageDef) or specific subtype. NEVER contains(ImageDef).

Need bounded choices?
└── enumField(StringField, { options: [...] })

Need to point at a card class (not an instance)?
└── CodeRefField with { module, name } shape

Need to point at another realm?
└── RealmField
```

**Source:** `~/Projects/boxel/packages/base/*.gts` — every field with a `displayName` + `extends FieldDef` is importable from `https://cardstack.com/base/<file-stem>`.
