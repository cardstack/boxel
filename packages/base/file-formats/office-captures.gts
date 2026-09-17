// The Office families' declared-screenshot capture: a capture-only component
// that renders the first unit of the extracted structure — a document's
// opening text flow, a deck's title slide, a workbook's first sheet — as a
// page-shaped poster for the fitted cell and the thumbnail fallback chain.
//
// Rasterization goes through the screenshot engine by design: the browser
// has no decode path for OOXML, so the extracted-structure rendering IS the
// office viewer, and screenshotting it is the pattern rather than an
// exception. The render is synchronous DOM over already-extracted fields, so
// every poster captures on the engine's settle with no readiness signal. A
// file whose extraction yielded no renderable first unit — an oversize
// document the extractor skipped, or a format with no preview payload —
// captures the typed placeholder look (paper + format badge + structural
// count) rather than a filename-on-white page. Declining the capture (the
// PDF sibling's move for an undecodable document) is not an option here: the
// prerendered fitted cell serves the declaration-injected poster URL without
// knowing the capture outcome, and its `<img>` has no error fallback, so a
// declined slot leaves that tile empty — worse than either rendering.
// Capturing the placeholder keeps the prerendered and live tiles agreeing on
// the degenerate case.
import GlimmerComponent from '@glimmer/component';
import { cached } from '@glimmer/tracking';

import { eq } from '@cardstack/boxel-ui/helpers';

import { ensureFileViewModel, type FileViewModel } from './file-view-model';
import { OfficePlaceholder } from './office-preview';

import type { ScreenshotSpec } from '../card-api';

// How much of the opening text flow a document poster shows. The capture box
// crops overflow anyway; the cap just keeps the capture render from laying
// out an entire manuscript to show one page.
const POSTER_BLOCK_BUDGET = 12;
const POSTER_ROW_BUDGET = 12;
const POSTER_CELL_BUDGET = 4;

interface CaptureSignature {
  Args: {
    model: any;
  };
  Element: HTMLElement;
}

export class OfficePosterCapture extends GlimmerComponent<CaptureSignature> {
  @cached
  get model(): FileViewModel {
    return ensureFileViewModel(this.args.model, 'embedded');
  }

  get meta() {
    return this.model.officeMetadata;
  }

  get kind(): string {
    return this.meta?.kind || this.model.previewKind || 'word';
  }

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

  get blocks(): { style: string; text: string }[] {
    if (this.kind !== 'word') {
      return [];
    }
    return (this.parsedPreview?.blocks ?? []).slice(0, POSTER_BLOCK_BUDGET);
  }

  get titleSlide(): { title?: string; bullets: string[] } | undefined {
    if (this.kind !== 'presentation') {
      return undefined;
    }
    return this.parsedPreview?.slides?.[0];
  }

  get sheet(): { name: string; rows: string[][] } | undefined {
    if (this.kind !== 'spreadsheet') {
      return undefined;
    }
    return this.parsedPreview?.sheets?.[0];
  }

  get sheetRows(): string[][] {
    return (this.sheet?.rows ?? [])
      .slice(0, POSTER_ROW_BUDGET)
      .map((row: string[]) => row.slice(0, POSTER_CELL_BUDGET));
  }

  get heading(): string {
    return (
      this.meta?.title || this.model.baseName || this.model.name || 'Document'
    );
  }

  // A document that opens with its own title block leads with it, as its
  // first page does; the heading (core title, else the filename) stands in
  // only when the text flow carries no title of its own.
  get leadsWithTitle(): boolean {
    return this.blocks[0]?.style === 'title';
  }

  // Selects between the extracted first unit and the typed-placeholder branch
  // (see the file header): only a renderable first unit earns the page-shaped
  // rendering; anything less captures the placeholder look instead.
  get hasPosterContent(): boolean {
    if (this.kind === 'presentation') {
      let slide = this.titleSlide;
      return !!slide && (!!slide.title || (slide.bullets?.length ?? 0) > 0);
    }
    if (this.kind === 'spreadsheet') {
      return this.sheetRows.length > 0;
    }
    return this.blocks.length > 0;
  }

  <template>
    <div
      class='office-poster'
      data-kind={{this.kind}}
      data-test-office-poster={{this.kind}}
    >
      {{#if this.hasPosterContent}}
        {{#if (eq this.kind 'presentation')}}
          <div class='slide' data-test-office-poster-slide>
            <div class='slide-title'>{{if
                this.titleSlide.title
                this.titleSlide.title
                this.heading
              }}</div>
            {{#each this.titleSlide.bullets as |bullet|}}
              <div class='slide-bullet'>{{bullet}}</div>
            {{/each}}
          </div>
        {{else if (eq this.kind 'spreadsheet')}}
          <div class='sheet' data-test-office-poster-sheet>
            {{#if this.sheet.name}}<div
                class='sheet-tab'
              >{{this.sheet.name}}</div>{{/if}}
            <table class='sheet-grid'>
              <tbody>
                {{#each this.sheetRows as |row|}}
                  <tr>
                    {{#each row as |cell|}}
                      <td>{{cell}}</td>
                    {{/each}}
                  </tr>
                {{/each}}
              </tbody>
            </table>
          </div>
        {{else}}
          <div class='page' data-test-office-poster-page>
            {{#unless this.leadsWithTitle}}
              <div
                class='page-title'
                data-test-office-poster-heading
              >{{this.heading}}</div>
            {{/unless}}
            {{#each this.blocks as |block|}}
              <p
                class='page-block'
                data-style={{block.style}}
              >{{block.text}}</p>
            {{/each}}
          </div>
        {{/if}}
      {{else}}
        {{! The typed-placeholder branch: the very component the fitted cell
            draws for an uncaptured file, rendered as the capture itself so
            the always-served poster URL resolves to an informative tile (see
            the file header). }}
        <div class='placeholder'>
          <OfficePlaceholder
            @kind={{this.kind}}
            @meta={{this.meta}}
            @extension={{this.model.extension}}
            data-test-office-poster-placeholder
          />
        </div>
      {{/if}}
    </div>
    <style scoped>
      /* A capture keyed on file content must come out the same for every
         viewer, so the theme's tokens are pinned here, once, on the capture
         root: the drawing below — and `OfficePlaceholder`, which renders into
         the same root — reads them exactly as it does under a live theme, and
         no viewer's theme can reach them. Each fallback partner is pinned
         too, so no chain can escape to the viewer's theme if a token ahead of
         it is ever dropped. The type scale is likewise held here rather than
         scattered through the rules: these are the fixed proportions of a
         170×250 page, not a themed ladder. */
      .office-poster {
        --card: #fff;
        --card-foreground: #1a1a1a;
        --muted: #eceef1;
        --muted-foreground: #555;
        --border: #d8d8d8;
        --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        --font-mono: ui-monospace, Menlo, monospace;
        --tooltip: #262626;
        --tooltip-foreground: #f7f7f5;
        --fd-stage: #eceef1;
        --fd-paper: #f7f7f5;
        --fd-slate: #262626;
        --shadow-sm: 0 1px 4px rgb(0 0 0 / 12%);

        --poster-slide-title-size: 0.875rem;
        --poster-title-size: 0.8125rem;
        --poster-heading-size: 0.6875rem;
        --poster-body-size: 0.5625rem;
        --poster-cell-size: 0.5rem;
        --poster-radius: 3px;

        /* One page filling the capture box; overflow past the box is the crop,
           exactly as a physical first page would crop. */
        position: absolute;
        inset: 0;
        overflow: hidden;
        background-color: var(--card);
        color: var(--card-foreground);
        font-family: var(--font-sans);
      }
      .page {
        padding: 14px 12px;
      }
      .page-title {
        font-size: var(--poster-title-size);
        font-weight: 700;
        line-height: 1.25;
        margin-bottom: 8px;
      }
      .page-block {
        font-size: var(--poster-body-size);
        line-height: 1.45;
        margin: 0 0 5px;
      }
      .page-block[data-style='title'] {
        font-size: var(--poster-title-size);
        font-weight: 700;
        line-height: 1.25;
        margin-bottom: 8px;
      }
      .page-block[data-style='heading'] {
        font-size: var(--poster-heading-size);
        font-weight: 600;
        margin-top: 7px;
      }
      .slide {
        height: 100%;
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: 6px;
        padding: 14px 12px;
      }
      .slide-title {
        font-size: var(--poster-slide-title-size);
        font-weight: 700;
        line-height: 1.2;
      }
      .slide-bullet {
        font-size: var(--poster-body-size);
        line-height: 1.4;
        padding-left: 10px;
        position: relative;
      }
      .slide-bullet::before {
        content: '•';
        position: absolute;
        left: 0;
      }
      .sheet {
        padding: 8px;
      }
      .sheet-tab {
        display: inline-block;
        font-size: var(--poster-cell-size);
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--muted-foreground);
        border: 1px solid var(--border);
        border-bottom: 0;
        border-radius: var(--poster-radius) var(--poster-radius) 0 0;
        padding: 2px 6px;
      }
      .sheet-grid {
        width: 100%;
        border-collapse: collapse;
      }
      .sheet-grid td {
        border: 1px solid var(--border);
        font-size: var(--poster-cell-size);
        line-height: 1.3;
        padding: 2px 4px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 48px;
      }

      /* The typed-placeholder branch fills the capture box with the shared
         placeholder, which reads the tokens pinned on the root above. */
      .placeholder {
        position: absolute;
        inset: 0;
      }
    </style>
  </template>
}

// One roster shared by DocxDef / PptxDef / XlsxDef: a `poster` at the
// recommended thumbnail box (the CardsGrid tile, 170×250 at the default
// deviceScaleFactor of 2), keyed on file content, feeding the thumbnail
// fallback chain and the fitted cell through the view model's thumbnail
// seam. Every office file captures — a real first unit when the extraction
// carried one, the typed-placeholder rendering when it didn't — so the
// live placeholder only stands in while a capture is still outstanding.
export const OFFICE_FAMILY_SCREENSHOTS: Record<string, ScreenshotSpec> = {
  poster: {
    render: OfficePosterCapture,
    width: 170,
    height: 250,
    keyBy: 'file-content',
    useAsThumbnail: true,
  },
};
