// The font family's renderer, projected into the four format shells by
// `FilePreviewStage`. The browser is the decoder: `applyFileFont` loads the
// linked face onto the specimen container and every sample below inherits it,
// so what shows is the real typeface, not a description of it.
//
// Each format gets a different amount of the specimen — a single showcase glyph in
// a budgeted collection cell, a compact name-plus-pangram inline, and a full
// waterfall with a character map when isolated — while all three share one
// FontFace load.
import GlimmerComponent from '@glimmer/component';

import { eq } from '@cardstack/boxel-ui/helpers';

import { applyFileFont } from './file-resources';
import type { FilePreviewSignature } from './file-preview-stage';

// A type-designer's pangram: every letter, and a shape mix that shows a face's
// personality faster than "quick brown fox".
const PANGRAM = 'Sphinx of black quartz, judge my vow';

// The reading-size waterfall. Large enough at the top to read the letterforms,
// small enough at the bottom to prove the face holds up as body text.
const WATERFALL_SIZES = [64, 48, 36, 28, 22, 18, 15, 13];

// The character map an isolated specimen lays out in the face itself.
const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';
const PUNCTUATION = '&.,;:!?“”‘’()[]{}/@#$%*+=—';

export class FontSpecimen extends GlimmerComponent<FilePreviewSignature> {
  get metadata() {
    return this.args.model?.fontMetadata;
  }

  // The face's own name is the natural showcase string; the file name is the
  // honest fallback before extraction has run (or for a WOFF2, whose name table
  // we can't read).
  get displayName(): string {
    return (
      this.metadata?.familyName ||
      this.metadata?.fullName ||
      this.args.model?.baseName ||
      this.args.model?.name ||
      'Specimen'
    );
  }

  get subfamily(): string {
    return this.metadata?.subfamilyName ?? '';
  }

  // A short showcase glyph pair for the budgeted fitted cell — big enough to
  // read the face's character at a glance without loading a whole waterfall.
  get fittedGlyphs(): string {
    return 'Ag';
  }

  get pangram(): string {
    return PANGRAM;
  }

  get waterfallSizes(): number[] {
    return WATERFALL_SIZES;
  }

  get characterRows(): { label: string; glyphs: string }[] {
    return [
      { label: 'Uppercase', glyphs: UPPERCASE },
      { label: 'Lowercase', glyphs: LOWERCASE },
      { label: 'Numerals', glyphs: DIGITS },
      { label: 'Punctuation', glyphs: PUNCTUATION },
    ];
  }

  // The URL the FontFace loads from. `resourceUrl` is the served file; the auth
  // service worker injects the realm token on the native request.
  get resourceUrl(): string {
    return this.args.model?.resourceUrl ?? this.args.model?.url ?? '';
  }

  // A face family name unique to this file, so two specimens on one page each
  // load their own face instead of colliding in the document's FontFace
  // registry. The content hash is stable across renders of the same bytes.
  get specimenFamily(): string {
    let token =
      this.args.model?.contentHash ||
      this.args.model?.id ||
      this.resourceUrl ||
      this.displayName;
    return `Boxel specimen ${token}`;
  }

  <template>
    {{#if (eq @format 'fitted')}}
      <div
        class='specimen specimen--fitted'
        {{applyFileFont null this.resourceUrl this.specimenFamily}}
        data-test-font-specimen='fitted'
      >
        <span class='fitted-glyphs'>{{this.fittedGlyphs}}</span>
        <span class='fitted-name'>{{this.displayName}}</span>
      </div>
    {{else if (eq @format 'embedded')}}
      <div
        class='specimen specimen--embedded'
        {{applyFileFont null this.resourceUrl this.specimenFamily}}
        data-test-font-specimen='embedded'
      >
        <div class='name-line' title={{this.displayName}}>{{this.displayName}}</div>
        <div class='pangram pangram--embedded'>{{this.pangram}}</div>
        <div class='mini-waterfall'>
          <div class='waterfall-line wf-30'>{{this.pangram}}</div>
          <div class='waterfall-line wf-18'>{{this.pangram}}</div>
        </div>
      </div>
    {{else}}
      <div
        class='specimen specimen--isolated'
        {{applyFileFont null this.resourceUrl this.specimenFamily}}
        data-test-font-specimen='isolated'
      >
        <header class='specimen-head'>
          <div class='hero' title={{this.displayName}}>{{this.displayName}}</div>
          {{#if this.subfamily}}
            <div class='hero-sub'>{{this.subfamily}}</div>
          {{/if}}
        </header>

        <section class='waterfall' aria-label='Waterfall'>
          {{#each this.waterfallSizes as |size|}}
            <div class='waterfall-line wf-{{size}}'>{{this.pangram}}</div>
          {{/each}}
        </section>

        <section class='charmap' aria-label='Character set'>
          {{#each this.characterRows as |row|}}
            <div class='charmap-row'>
              <div class='charmap-label'>{{row.label}}</div>
              <div class='charmap-glyphs'>{{row.glyphs}}</div>
            </div>
          {{/each}}
        </section>
      </div>
    {{/if}}

    <style scoped>
      /* The specimen container carries the loaded face via `applyFileFont`, and
         the samples inherit it. Chrome (labels, size markers) sets its own
         family so only the actual specimen text renders in the linked font. */
      .specimen {
        width: 100%;
        height: 100%;
        min-height: 0;
        box-sizing: border-box;
        background: var(--card, #fff);
        color: var(--foreground);
        text-align: left;
        /* Own the container context so the `cqw` sizing below scales the hero
           and glyphs against the specimen's own width, not the viewport — a
           narrow embedded cell gets a proportionally smaller showcase. */
        container-type: inline-size;
      }

      /* Fitted: a budgeted collection cell. One showcase glyph pair plus the
         family name, both in the face. */
      .specimen--fitted {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 4px;
        padding: 8px;
        overflow: hidden;
      }
      .fitted-glyphs {
        font-size: clamp(2.25rem, 34cqw, 5rem);
        line-height: 1;
      }
      .fitted-name {
        max-width: 100%;
        font-family: var(--font-mono);
        font-size: 0.5625rem;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--muted-foreground);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      /* Embedded: a compact plate — name, one pangram, a two-step waterfall. */
      .specimen--embedded {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 16px;
        overflow: hidden;
      }
      .name-line {
        font-size: clamp(1.75rem, 8cqw, 2.75rem);
        line-height: 1.1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .pangram--embedded {
        font-size: 1.125rem;
        line-height: 1.3;
        color: var(--foreground);
      }
      .mini-waterfall {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-height: 0;
        overflow: hidden;
      }

      /* Isolated: the full specimen — hero name, waterfall, character map. */
      .specimen--isolated {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-lg, 24px);
        padding: var(--boxel-sp-xl, 32px);
        overflow: auto;
      }
      .specimen-head {
        border-bottom: 1px solid var(--border);
        padding-bottom: var(--boxel-sp, 16px);
      }
      .hero {
        font-size: clamp(2.5rem, 9cqw, 5rem);
        line-height: 1.05;
        word-break: break-word;
      }
      .hero-sub {
        margin-top: 4px;
        font-size: 1.25rem;
        color: var(--muted-foreground);
      }
      .waterfall {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .waterfall-line {
        line-height: 1.25;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      /* The waterfall steps through a fixed set of sizes; a class per step keeps
         the size out of an inline style. */
      .wf-64 {
        font-size: 64px;
      }
      .wf-48 {
        font-size: 48px;
      }
      .wf-36 {
        font-size: 36px;
      }
      .wf-30 {
        font-size: 30px;
      }
      .wf-28 {
        font-size: 28px;
      }
      .wf-22 {
        font-size: 22px;
      }
      .wf-18 {
        font-size: 18px;
      }
      .wf-15 {
        font-size: 15px;
      }
      .wf-13 {
        font-size: 13px;
      }
      .charmap {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp, 16px);
      }
      .charmap-row {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .charmap-label {
        font-family: var(--font-mono);
        font-size: 0.5625rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted-foreground);
      }
      .charmap-glyphs {
        font-size: 1.75rem;
        line-height: 1.4;
        letter-spacing: 0.08em;
        word-break: break-word;
      }
    </style>
  </template>
}
