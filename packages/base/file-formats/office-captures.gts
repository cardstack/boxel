// The Office families' declared-screenshot capture: a capture-only component
// that renders the first unit of the extracted structure — a document's
// opening text flow, a deck's title slide, a workbook's first sheet — as a
// page-shaped poster for the fitted cell and the thumbnail fallback chain.
//
// Rasterization goes through the screenshot engine by design: the browser
// has no decode path for OOXML, so the extracted-structure rendering IS the
// office viewer, and screenshotting it is the pattern rather than an
// exception. Everything here is synchronous DOM over already-extracted
// fields, so no readiness signal is needed — the engine's settle covers it.
import GlimmerComponent from '@glimmer/component';
import { cached } from '@glimmer/tracking';

import { eq } from '@cardstack/boxel-ui/helpers';

import { ensureFileViewModel, type FileViewModel } from './file-view-model';

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

  <template>
    <div class='office-poster' data-kind={{this.kind}}>
      {{#if (eq this.kind 'presentation')}}
        <div class='slide'>
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
        <div class='sheet'>
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
        <div class='page'>
          <div class='page-title'>{{this.heading}}</div>
          {{#each this.blocks as |block|}}
            <p class='page-block' data-style={{block.style}}>{{block.text}}</p>
          {{/each}}
        </div>
      {{/if}}
    </div>
    <style scoped>
      /* One white page filling the capture box; overflow past the box is the
         crop, exactly as a physical first page would crop. */
      .office-poster {
        position: absolute;
        inset: 0;
        overflow: hidden;
        background: #fff;
        color: #1a1a1a;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }
      .page {
        padding: 14px 12px;
      }
      .page-title {
        font-size: 0.8125rem;
        font-weight: 700;
        line-height: 1.25;
        margin-bottom: 8px;
      }
      .page-block {
        font-size: 0.5625rem;
        line-height: 1.45;
        margin: 0 0 5px;
      }
      .page-block[data-style='heading'] {
        font-size: 0.6875rem;
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
        background: #fff;
      }
      .slide-title {
        font-size: 0.875rem;
        font-weight: 700;
        line-height: 1.2;
      }
      .slide-bullet {
        font-size: 0.5625rem;
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
        font-size: 0.5rem;
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: #555;
        border: 1px solid #d8d8d8;
        border-bottom: 0;
        border-radius: 3px 3px 0 0;
        padding: 2px 6px;
      }
      .sheet-grid {
        width: 100%;
        border-collapse: collapse;
      }
      .sheet-grid td {
        border: 1px solid #e2e2e2;
        font-size: 0.5rem;
        line-height: 1.3;
        padding: 2px 4px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 48px;
      }
    </style>
  </template>
}

// One roster shared by DocxDef / PptxDef / XlsxDef: a `poster` at the
// recommended thumbnail box (the CardsGrid tile, 170×250 at the default
// deviceScaleFactor of 2), keyed on file content, feeding the thumbnail
// fallback chain and the fitted cell through the view model's thumbnail
// seam. The typed placeholder remains the fallback until a capture serves.
export const OFFICE_FAMILY_SCREENSHOTS: Record<string, ScreenshotSpec> = {
  poster: {
    render: OfficePosterCapture,
    width: 170,
    height: 250,
    keyBy: 'file-content',
    useAsThumbnail: true,
  },
};
