import {
  CardDef,
  Component,
  contains,
  field,
  type ScreenshotSpec,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';

// 🧩 PATTERN: declared screenshots — self-refreshing capture slots on the class.
//
// Two slots are declared below:
//   thumb  — captures the card's own embedded format at the standard grid-tile
//            box and feeds cardThumbnailURL, so every fitted tile shows the
//            real rendering with zero template edits.
//   social — a capture-only component sized for share/og images. It never
//            renders in the app; only the capture engine draws it.

// Capture-only component. Full author surface (@model / @fields / linked
// data), but referenced only from the `static screenshots` declaration.
// Keep captured markup deterministic: no timestamps-relative-to-now, no
// randomness, no mid-flight animations — unchanged data should produce
// identical pixels so re-indexes dedupe instead of re-uploading.
class SocialCard extends Component<typeof Recipe> {
  <template>
    <div class='social'>
      <h1>{{@model.title}}</h1>
      <p>{{@model.tagline}}</p>
    </div>
    <style scoped>
      .social {
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        justify-content: center;
        padding: 4rem;
        background-color: var(--card);
        color: var(--card-foreground);
      }
      .social h1 {
        font-size: 4rem;
        margin: 0;
      }
    </style>
  </template>
}

export class Recipe extends CardDef {
  static displayName = 'Recipe';

  @field title = contains(StringField);
  @field tagline = contains(StringField);

  // ⚠️ The annotation is required: a bare `static screenshots = {...}`
  // widens 'embedded' to string and fails type-checking (TS2417).
  static screenshots: Record<string, ScreenshotSpec> = {
    // 170×250 is the standard grid-tile box (at the default dsf of 2).
    // `embedded` (not `fitted`) as the thumbnail source: the default fitted
    // template renders cardThumbnailURL itself, so a fitted capture would
    // recursively include its own previous thumbnail.
    thumb: {
      format: 'embedded',
      width: 170,
      height: 250,
      useAsThumbnail: true,
    },
    // Wide share image drawn by the capture-only component above.
    // 1200×630 CSS px; dsf 1 keeps the output at exactly og:image size.
    social: {
      render: SocialCard,
      width: 1200,
      height: 630,
      deviceScaleFactor: 1,
      type: 'jpeg',
    },
  };

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='recipe'>
        <h2>{{@model.title}}</h2>
        <p>{{@model.tagline}}</p>
      </div>
      <style scoped>
        .recipe {
          padding: var(--boxel-sp);
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <article class='article'>
        <h1>{{@model.title}}</h1>
        <p>{{@model.tagline}}</p>

        {{! Consuming a slot: screenshotURLs is a reserved getter with one
            key per declared slot. The value is undefined until a capture
            exists (new instance, capture in flight, or capture failed) —
            ALWAYS guard: Glimmer omits the src for undefined, but the
            src-less <img> still renders (alt text and a layout hole). }}
        {{#if @model.screenshotURLs.social}}
          <img
            class='screenshot'
            src={{@model.screenshotURLs.social}}
            alt='Share preview for {{@model.title}}'
          />
        {{/if}}
      </article>
      <style scoped>
        .article {
          padding: 1.5rem;
        }
        .screenshot {
          margin-top: 1.5rem;
          border: 1px solid var(--border);
          border-radius: var(--boxel-border-radius-sm);
        }
      </style>
    </template>
  };
}
