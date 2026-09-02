// The Office families' renderer, projected into the four format shells by
// `FilePreviewStage`. The browser cannot display a `.docx`, `.pptx`, or `.xlsx`
// natively, so — unlike the PDF viewer's native `<object>` — this renders the
// structure the extractor read out of the package: a document's text flow, a
// deck's slide outline, a workbook's sheet grid. It is one component across the
// three because they share a stage, a fitted placeholder, and the "structured
// information derived from the source" provenance; it branches on the file's
// `previewKind` for the domain-specific body.
//
// The fitted first-page/first-slide poster is deliberately not drawn here — it
// needs the derived-artifact contract (CS-12231) to rasterize and store a real
// rendition. Once that lands and populates `thumbnailUrl`, the preview stage
// prefers the real poster over the typed placeholder automatically, with no
// change to this component.
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
    return (
      KIND_LABEL[this.kind]?.badge ??
      (this.args.model?.extension || 'OOXML').toUpperCase()
    );
  }

  get noun(): string {
    return KIND_LABEL[this.kind]?.noun ?? 'document';
  }

  // The one structural count that matters to this format, for the placeholder
  // and the header.
  get structureLabel(): string {
    let m = this.meta;
    if (!m) {
      return '';
    }
    if (this.kind === 'presentation' && m.slideCount != null) {
      return `${m.slideCount} ${m.slideCount === 1 ? 'slide' : 'slides'}`;
    }
    if (this.kind === 'spreadsheet' && m.sheetCount != null) {
      return `${m.sheetCount} ${m.sheetCount === 1 ? 'sheet' : 'sheets'}`;
    }
    if (m.pageCount != null) {
      return `${m.pageCount} ${m.pageCount === 1 ? 'page' : 'pages'}`;
    }
    return '';
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
      <div class='off-fitted' data-kind={{this.kind}} data-test-office-fitted>
        <div class='paper paper-{{this.kind}}'>
          <span class='badge'>{{this.badge}}</span>
          {{#if this.structureLabel}}
            <span class='count'>{{this.structureLabel}}</span>
          {{/if}}
        </div>
      </div>
    {{else}}
      <div
        class='off'
        data-kind={{this.kind}}
        data-mode={{@format}}
        data-test-office-preview={{this.kind}}
      >
        <header class='off-head'>
          <span class='badge'>{{this.badge}}</span>
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
            <span class='badge'>{{this.badge}}</span>
            <span class='off-empty-label'>No preview extracted</span>
          </div>
        {{/if}}
      </div>
    {{/if}}

    <style scoped>
      /* Fitted: a typed placeholder, not a rendering engine. It reads as "an
         Office document of this kind, this many pages/slides/sheets" until the
         poster contract renders a real first page. */
      .off-fitted {
        width: 100%;
        height: 100%;
        display: grid;
        place-items: center;
        padding: 10px;
        background: var(--fd-stage, var(--muted, #eceef1));
        container-type: inline-size;
      }
      .paper {
        position: relative;
        width: min(72%, 8rem);
        aspect-ratio: 3 / 4;
        background: var(--card, #fff);
        border: 1px solid var(--border);
        border-radius: 3px;
        box-shadow: 0 1px 4px rgb(0 0 0 / 12%);
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
        background-image: repeating-linear-gradient(
            var(--border) 0 1px,
            transparent 1px 16px
          ),
          repeating-linear-gradient(
            90deg,
            var(--border) 0 1px,
            transparent 1px 22px
          );
        opacity: 0.5;
      }
      .badge {
        position: relative;
        font-family: var(--font-mono);
        font-size: 0.6875rem;
        font-weight: 700;
        letter-spacing: 0.06em;
        color: var(--fd-paper, var(--card, #f7f7f5));
        background: var(--fd-slate, var(--foreground));
        padding: 2px 8px;
        border-radius: 3px;
        flex-shrink: 0;
      }
      .count {
        position: relative;
        font-family: var(--font-mono);
        font-size: 0.5625rem;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--muted-foreground);
      }

      /* Embedded/isolated: the extracted structure, on the family's own surface,
         scrolling within the space the shell hands it. */
      .off {
        width: 100%;
        height: 100%;
        min-height: 0;
        display: flex;
        flex-direction: column;
        background: var(--card, #fff);
        color: var(--card-foreground, var(--foreground));
        font-family: var(--font-sans);
        overflow: hidden;
        container-type: inline-size;
      }
      .off-head {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        border-bottom: 1px solid var(--border);
        background: var(--card);
        flex-shrink: 0;
      }
      .off-title {
        font-size: 0.8125rem;
        font-weight: 600;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .off-count {
        margin-left: auto;
        font-family: var(--font-mono);
        font-size: 0.5625rem;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--muted-foreground);
        flex-shrink: 0;
      }

      /* Document flow */
      .doc {
        margin: 0;
        padding: 20px clamp(16px, 8cqw, 56px);
        overflow: auto;
        min-height: 0;
        line-height: 1.55;
        max-width: 46rem;
      }
      .doc-title {
        margin: 0 0 0.6em;
        font-size: 1.5rem;
        font-weight: 700;
        letter-spacing: -0.01em;
      }
      .doc-heading {
        margin: 1em 0 0.35em;
        font-size: 1.05rem;
        font-weight: 650;
      }
      .doc-heading[data-level='2'] {
        font-size: 0.95rem;
      }
      .doc-heading[data-level='3'] {
        font-size: 0.875rem;
        color: var(--muted-foreground);
      }
      .doc-body {
        margin: 0 0 0.7em;
        font-size: 0.8125rem;
      }
      .more {
        margin: 1em 0 0;
        font-family: var(--font-mono);
        font-size: 0.625rem;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--muted-foreground);
      }

      /* Slide deck */
      .deck {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
        gap: 12px;
        padding: 14px;
        overflow: auto;
        min-height: 0;
        align-content: start;
        background: var(--fd-stage, var(--muted, #eceef1));
      }
      .slide {
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .slide-face {
        aspect-ratio: 16 / 9;
        background: var(--card, #fff);
        border: 1px solid var(--border);
        border-radius: 4px;
        box-shadow: 0 1px 3px rgb(0 0 0 / 10%);
        padding: 10px 12px;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        gap: 5px;
      }
      .slide-title {
        font-size: 0.75rem;
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
        font-size: 0.625rem;
        line-height: 1.4;
        color: var(--muted-foreground);
        overflow: hidden;
      }
      .slide-empty {
        font-family: var(--font-mono);
        font-size: 0.5625rem;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        color: var(--muted-foreground);
        margin: auto;
      }
      .slide-no {
        font-family: var(--font-mono);
        font-size: 0.5625rem;
        color: var(--muted-foreground);
        text-align: right;
      }
      .more-tile {
        margin: 0;
        display: grid;
        place-items: center;
        aspect-ratio: 16 / 9;
        border: 1px dashed var(--border);
        border-radius: 4px;
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
        padding: 6px 10px 0;
        overflow-x: auto;
        flex-shrink: 0;
        background: var(--fd-stage, var(--muted, #eceef1));
      }
      .tab {
        font-family: var(--font-sans);
        font-size: 0.6875rem;
        white-space: nowrap;
        padding: 4px 10px;
        border: 1px solid var(--border);
        border-bottom: none;
        border-radius: 4px 4px 0 0;
        background: var(--fd-stage-deep, #e2e5ea);
        color: var(--muted-foreground);
      }
      .tab.active {
        background: var(--card, #fff);
        color: var(--foreground);
        font-weight: 600;
      }
      .grid-scroll {
        overflow: auto;
        min-height: 0;
      }
      .grid {
        border-collapse: collapse;
        font-size: 0.75rem;
        font-variant-numeric: tabular-nums;
      }
      .grid td {
        border: 1px solid var(--border);
        padding: 3px 8px;
        max-width: 16rem;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        text-align: left;
      }
      .grid tr:first-child td {
        font-weight: 600;
        background: var(--fd-stage, var(--muted, #eceef1));
      }

      .off-empty {
        margin: auto;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        padding: 24px;
      }
      .off-empty-label {
        font-family: var(--font-mono);
        font-size: 0.53125rem;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--muted-foreground);
      }
    </style>
  </template>
}
