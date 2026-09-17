// The Office families' renderer, projected into the four format shells by
// `FilePreviewStage`. The browser cannot display a `.docx`, `.pptx`, or `.xlsx`
// natively, so — unlike the PDF viewer's native `<object>` — this renders the
// structure the extractor read out of the package: a document's text flow, a
// deck's slide outline, a workbook's sheet grid. It is one component across the
// three because they share a stage, a fitted placeholder, and the "structured
// information derived from the source" provenance; it branches on the file's
// `previewKind` for the domain-specific body.
//
// Its `<style scoped>` share runs above the usual budget because the file
// draws four unrelated things — a text flow, a deck of slide faces, a sheet
// grid, and the typed placeholder — rather than one design restated per
// format. The two drawings that did repeat, the placeholder paper and the
// format badge, are each one component rendered by every caller.
//
// The fitted first-page/first-slide poster is deliberately not drawn here:
// the families' declared `poster` capture (see `office-captures`) renders the
// extracted structure's first unit during the prerender pass, and the preview
// stage prefers that rendition over the typed placeholder through the view
// model's `thumbnailUrl` — the placeholder is the graceful fallback for an
// uncaptured file.
import GlimmerComponent from '@glimmer/component';
import { cached } from '@glimmer/tracking';

import { eq } from '@cardstack/boxel-ui/helpers';

import type { FilePreviewSignature } from './file-preview-stage';

interface TextBlock {
  style: 'title' | 'heading' | 'body';
  level?: number;
  text: string;
}
interface DocumentPreview {
  blocks: TextBlock[];
  truncated: boolean;
}
interface DeckSlide {
  index: number;
  title?: string;
  bullets: string[];
}
interface DeckPreview {
  slides: DeckSlide[];
  truncated: boolean;
}
interface GridSheet {
  name: string;
  rows: string[][];
  truncated: boolean;
}
interface GridPreview {
  sheets: GridSheet[];
}

// The badge and the empty-state noun for each format.
const KIND_LABEL: Record<string, { badge: string; noun: string }> = {
  word: { badge: 'DOCX', noun: 'document' },
  presentation: { badge: 'PPTX', noun: 'presentation' },
  spreadsheet: { badge: 'XLSX', noun: 'workbook' },
};

function officeKindBadge(kind: string, extension?: string): string {
  return KIND_LABEL[kind]?.badge ?? (extension || 'OOXML').toUpperCase();
}

function officeStructureLabel(
  meta:
    | { pageCount?: number; slideCount?: number; sheetCount?: number }
    | undefined,
  kind: string,
): string {
  if (!meta) {
    return '';
  }
  if (kind === 'presentation' && meta.slideCount != null) {
    return `${meta.slideCount} ${meta.slideCount === 1 ? 'slide' : 'slides'}`;
  }
  if (kind === 'spreadsheet' && meta.sheetCount != null) {
    return `${meta.sheetCount} ${meta.sheetCount === 1 ? 'sheet' : 'sheets'}`;
  }
  if (meta.pageCount != null) {
    return `${meta.pageCount} ${meta.pageCount === 1 ? 'page' : 'pages'}`;
  }
  return '';
}

interface BadgeSignature {
  Args: { label: string };
  Element: HTMLElement;
}

// The format tag — DOCX, PPTX, XLSX — as one inverted chip. Both drawings that
// carry it (the placeholder's paper and the viewer's header) render this, so
// the tag reads the same size and the same colors in a fitted cell, a capture,
// and an open pane. The `--fd-*` pair it inverts onto is outside the theme
// contract, so it degrades here to `--tooltip`, the one inverted pairing the
// theme guarantees.
export class OfficeBadge extends GlimmerComponent<BadgeSignature> {
  <template>
    <span class='office-badge' ...attributes>{{@label}}</span>
    <style scoped>
      .office-badge {
        position: relative;
        flex-shrink: 0;
        font-family: var(--font-mono);
        font-size: 0.6875rem;
        font-weight: 700;
        letter-spacing: 0.06em;
        background-color: var(--fd-slate, var(--tooltip));
        color: var(--fd-paper, var(--tooltip-foreground));
        padding: 2px 8px;
        border-radius: 3px;
      }
    </style>
  </template>
}

interface PlaceholderSignature {
  Args: {
    kind: string;
    meta?: { pageCount?: number; slideCount?: number; sheetCount?: number };
    extension?: string;
  };
  Element: HTMLElement;
}

// The typed placeholder: a sheet of paper shaped for the format (portrait for a
// document, landscape for a deck, ruled as a grid for a workbook) carrying the
// format badge and the structural count. It has exactly two renderers — the
// fitted branch below, for a file with no capture yet, and the poster capture's
// no-first-unit branch (`office-captures`) — and both draw it through this one
// component so the two renderings of "an Office file of this kind, this big"
// cannot drift. Every color reads a theme token; a renderer that must not
// follow the host theme pins those tokens on an ancestor rather than
// restating the drawing.
export class OfficePlaceholder extends GlimmerComponent<PlaceholderSignature> {
  get badge(): string {
    return officeKindBadge(this.args.kind, this.args.extension);
  }

  get count(): string {
    return officeStructureLabel(this.args.meta, this.args.kind);
  }

  <template>
    <div class='off-fitted' data-kind={{@kind}} ...attributes>
      <div class='paper paper-{{@kind}}'>
        <OfficeBadge @label={{this.badge}} data-test-office-placeholder-badge />
        {{#if this.count}}
          <span
            class='count'
            data-test-office-placeholder-count
          >{{this.count}}</span>
        {{/if}}
      </div>
    </div>
    <style scoped>
      /* Two kinds of value resolve here on the root, once, and are read bare
         below. The family's `--fd-*` tokens are outside the theme contract, so
         each names the contract token it degrades to — the inverted badge
         landing on `--tooltip`, the one inverted pairing the theme guarantees.
         The drawing's metrics are fixed rather than themed on purpose: this is
         a scale model of a page, the poster capture renders this very
         component into a 170×250 box, and a capture keyed on file content has
         to come out the same wherever it is drawn. */
      .off-fitted {
        --office-stage: var(--fd-stage, var(--muted));
        --office-paper-radius: 3px;
        --office-count-size: 0.5625rem;

        width: 100%;
        height: 100%;
        display: grid;
        place-items: center;
        padding: 10px;
        background-color: var(--office-stage);
      }
      .paper {
        position: relative;
        width: min(72%, 8rem);
        aspect-ratio: 3 / 4;
        background-color: var(--card);
        color: var(--card-foreground);
        border: 1px solid var(--border);
        border-radius: var(--office-paper-radius);
        box-shadow: var(--shadow-sm);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 6px;
        overflow: hidden;
      }
      /* A deck reads landscape; a workbook as a ruled grid; a document as ruled
         lines of text. */
      .paper-presentation {
        aspect-ratio: 4 / 3;
      }
      .paper-word::before {
        content: '';
        position: absolute;
        inset: 14% 16%;
        background-image: repeating-linear-gradient(
          var(--border) 0 1px,
          transparent 1px 9px
        );
        opacity: 0.5;
      }
      .paper-spreadsheet::before {
        content: '';
        position: absolute;
        inset: 12% 12%;
        background-image:
          repeating-linear-gradient(var(--border) 0 1px, transparent 1px 16px),
          repeating-linear-gradient(
            90deg,
            var(--border) 0 1px,
            transparent 1px 22px
          );
        opacity: 0.5;
      }
      .count {
        position: relative;
        font-family: var(--font-mono);
        font-size: var(--office-count-size);
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export class OfficePreview extends GlimmerComponent<FilePreviewSignature> {
  get meta() {
    return this.args.model?.officeMetadata;
  }

  // The format is known from the family's static `previewKind` even before any
  // metadata is read, so the placeholder is always correctly typed.
  get kind(): string {
    return this.meta?.kind || this.args.model?.previewKind || 'word';
  }

  get badge(): string {
    return officeKindBadge(this.kind, this.args.model?.extension);
  }

  get noun(): string {
    return KIND_LABEL[this.kind]?.noun ?? 'document';
  }

  // The one structural count that matters to this format, for the placeholder
  // and the header.
  get structureLabel(): string {
    return officeStructureLabel(this.meta, this.kind);
  }

  get heading(): string {
    return (
      this.meta?.title ||
      this.args.model?.baseName ||
      this.args.model?.name ||
      this.noun
    );
  }

  // The bounded preview payload, parsed once. Typed loosely because the shape
  // is `DocumentPreview | DeckPreview | GridPreview` depending on the format;
  // each accessor below narrows it to the shape its `kind` guarantees.
  @cached
  get parsedPreview(): any {
    let raw = this.meta?.previewJson;
    if (!raw) {
      return undefined;
    }
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  }

  get document(): DocumentPreview | undefined {
    return this.kind === 'word' ? this.parsedPreview : undefined;
  }

  get deck(): DeckPreview | undefined {
    return this.kind === 'presentation' ? this.parsedPreview : undefined;
  }

  get grid(): GridPreview | undefined {
    return this.kind === 'spreadsheet' ? this.parsedPreview : undefined;
  }

  // The sampled first sheet, plus the remaining sheet names as inert tabs so the
  // preview reads as a workbook rather than a lone table.
  get sheet(): GridSheet | undefined {
    return this.grid?.sheets?.[0];
  }

  get sheetTabs(): string[] {
    return this.args.model?.officeMetadata?.sheetNames ?? [];
  }

  <template>
    {{#if (eq @format 'fitted')}}
      <OfficePlaceholder
        @kind={{this.kind}}
        @meta={{this.meta}}
        @extension={{@model.extension}}
        data-test-office-fitted
      />
    {{else}}
      <div
        class='off'
        data-kind={{this.kind}}
        data-mode={{@format}}
        data-test-office-preview={{this.kind}}
      >
        <header class='off-head'>
          <OfficeBadge @label={{this.badge}} />
          <span class='off-title' title={{this.heading}}>{{this.heading}}</span>
          {{#if this.structureLabel}}
            <span class='off-count'>{{this.structureLabel}}</span>
          {{/if}}
        </header>

        {{#if this.document}}
          <article class='doc'>
            {{#each this.document.blocks as |block|}}
              {{#if (eq block.style 'title')}}
                <h1 class='doc-title'>{{block.text}}</h1>
              {{else if (eq block.style 'heading')}}
                <h2 class='doc-heading' data-level={{block.level}}>
                  {{block.text}}
                </h2>
              {{else}}
                <p class='doc-body'>{{block.text}}</p>
              {{/if}}
            {{/each}}
            {{#if this.document.truncated}}
              <p class='more'>… continues in the full document</p>
            {{/if}}
          </article>

        {{else if this.deck}}
          <div class='deck'>
            {{#each this.deck.slides as |slide|}}
              <figure class='slide'>
                <div class='slide-face'>
                  {{#if slide.title}}
                    <div class='slide-title'>{{slide.title}}</div>
                  {{/if}}
                  {{#if slide.bullets.length}}
                    <ul class='slide-bullets'>
                      {{#each slide.bullets as |bullet|}}
                        <li>{{bullet}}</li>
                      {{/each}}
                    </ul>
                  {{else if (eq slide.title undefined)}}
                    <div class='slide-empty'>No text</div>
                  {{/if}}
                </div>
                <figcaption class='slide-no'>{{slide.index}}</figcaption>
              </figure>
            {{/each}}
            {{#if this.deck.truncated}}
              <div class='more more-tile'>More slides…</div>
            {{/if}}
          </div>

        {{else if this.sheet}}
          <div class='sheet'>
            {{#if this.sheetTabs.length}}
              <div class='tabs' role='tablist'>
                {{#each this.sheetTabs as |tab index|}}
                  <span
                    class='tab {{if (eq index 0) "active"}}'
                    role='tab'
                    aria-selected={{if (eq index 0) 'true' 'false'}}
                  >{{tab}}</span>
                {{/each}}
              </div>
            {{/if}}
            <div class='grid-scroll'>
              <table class='grid'>
                <tbody>
                  {{#each this.sheet.rows as |row|}}
                    <tr>
                      {{#each row as |cell|}}
                        <td>{{cell}}</td>
                      {{/each}}
                    </tr>
                  {{/each}}
                </tbody>
              </table>
            </div>
            {{#if this.sheet.truncated}}
              <p class='more'>Showing the top-left of “{{this.sheet.name}}”</p>
            {{/if}}
          </div>

        {{else}}
          <div class='off-empty'>
            <OfficeBadge @label={{this.badge}} />
            <span class='off-empty-label'>No preview extracted</span>
          </div>
        {{/if}}
      </div>
    {{/if}}

    <style scoped>
      /* Same resolve-once root as the placeholder: the family's out-of-contract
         `--fd-*` tokens name the contract token each degrades to, and are read
         bare below. Unlike the placeholder, nothing here is captured, so the
         rest reads the theme's own ladders and type roles. */
      .off {
        --office-stage: var(--fd-stage, var(--muted));
        --office-stage-deep: var(--fd-stage-deep, var(--inset));

        width: 100%;
        height: 100%;
        min-height: 0;
        display: flex;
        flex-direction: column;
        background-color: var(--card);
        color: var(--card-foreground);
        overflow: hidden;
        container-type: inline-size;
      }

      /* Embedded/isolated: the extracted structure, on the family's own surface,
         scrolling within the space the shell hands it. */
      .off-head {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-2xs);
        padding: var(--boxel-sp-2xs) var(--boxel-sp-sm);
        border-bottom: 1px solid var(--border);
        flex-shrink: 0;
      }
      .off-title {
        font-size: var(--boxel-font-size-sm);
        font-weight: 600;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      /* The tracked-out mono kickers all take the eyebrow role as a group — its
         size, line-height and tracking are part of the theme's voice — and keep
         only the mono family, which the container does not apply outside
         rendered Markdown. */
      .off-count,
      .more,
      .slide-empty,
      .slide-no,
      .off-empty-label {
        font-family: var(--font-mono);
        font-size: var(--boxel-eyebrow-font-size);
        line-height: var(--boxel-eyebrow-line-height);
        letter-spacing: var(--boxel-eyebrow-letter-spacing);
        text-transform: uppercase;
        color: var(--muted-foreground);
      }
      .off-count {
        margin-left: auto;
        flex-shrink: 0;
      }

      /* Document flow */
      .doc {
        margin: 0;
        padding: var(--boxel-sp-lg)
          clamp(var(--boxel-sp), 8cqi, var(--boxel-sp-4xl));
        overflow: auto;
        min-height: 0;
        line-height: 1.55;
        max-width: 46rem;
      }
      /* `.doc-title` and `.doc-heading` are an h1 and an h2: the container
         already gives them the heading and section-heading roles, so only the
         rhythm and the sub-level step are declared here. */
      .doc-title {
        margin: 0 0 0.6em;
      }
      .doc-heading {
        margin: 1em 0 0.35em;
      }
      .doc-heading[data-level='2'],
      .doc-heading[data-level='3'] {
        font-size: var(--boxel-subheading-font-size);
        line-height: var(--boxel-subheading-line-height);
      }
      .doc-heading[data-level='3'] {
        color: var(--muted-foreground);
      }
      .doc-body {
        margin: 0 0 0.7em;
        font-size: var(--boxel-font-size-sm);
      }
      .more {
        margin: 1em 0 0;
      }

      /* Slide deck */
      .deck {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
        gap: var(--boxel-sp-sm);
        padding: var(--boxel-sp-sm);
        overflow: auto;
        min-height: 0;
        align-content: start;
        background-color: var(--office-stage);
        color: var(--foreground);
      }
      .slide {
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-4xs);
      }
      .slide-face {
        aspect-ratio: 16 / 9;
        background-color: var(--card);
        color: var(--card-foreground);
        border: 1px solid var(--border);
        border-radius: var(--boxel-border-radius-xs);
        box-shadow: var(--shadow-xs);
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        overflow: hidden;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-3xs);
      }
      .slide-title {
        font-size: var(--boxel-font-size-xs);
        font-weight: 700;
        line-height: 1.25;
        overflow: hidden;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        line-clamp: 2;
      }
      .slide-bullets {
        margin: 0;
        padding-left: 1.1em;
        font-size: var(--boxel-font-size-2xs);
        line-height: 1.4;
        color: var(--muted-foreground);
        overflow: hidden;
      }
      .slide-empty {
        margin: auto;
      }
      .slide-no {
        text-align: right;
      }
      .more-tile {
        margin: 0;
        display: grid;
        place-items: center;
        aspect-ratio: 16 / 9;
        border: 1px dashed var(--border);
        border-radius: var(--boxel-border-radius-xs);
      }

      /* Sheet grid */
      .sheet {
        display: flex;
        flex-direction: column;
        min-height: 0;
        overflow: hidden;
      }
      .tabs {
        display: flex;
        gap: 2px;
        padding: var(--boxel-sp-2xs) var(--boxel-sp-xs) 0;
        overflow-x: auto;
        flex-shrink: 0;
        background-color: var(--office-stage);
        color: var(--foreground);
      }
      /* Tabs are control text: the label role, which the theme tunes for
         exactly this. */
      .tab {
        font-size: var(--boxel-ui-label-font-size);
        line-height: var(--boxel-ui-label-line-height);
        font-weight: var(--boxel-ui-label-font-weight);
        white-space: nowrap;
        padding: var(--boxel-sp-5xs) var(--boxel-sp-xs);
        border: 1px solid var(--border);
        border-bottom: none;
        border-radius: var(--boxel-border-radius-xs)
          var(--boxel-border-radius-xs) 0 0;
        background-color: var(--office-stage-deep);
        color: var(--muted-foreground);
      }
      .tab.active {
        background-color: var(--card);
        color: var(--card-foreground);
        font-weight: 600;
      }
      .grid-scroll {
        overflow: auto;
        min-height: 0;
      }
      .grid {
        border-collapse: collapse;
        font-size: var(--boxel-font-size-xs);
        font-variant-numeric: tabular-nums;
      }
      .grid td {
        border: 1px solid var(--border);
        padding: var(--boxel-sp-5xs) var(--boxel-sp-2xs);
        max-width: 16rem;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        text-align: left;
      }
      .grid tr:first-child td {
        font-weight: 600;
        background-color: var(--office-stage);
      }

      .off-empty {
        margin: auto;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--boxel-sp-2xs);
        padding: var(--boxel-sp-xl);
      }
    </style>
  </template>
}
