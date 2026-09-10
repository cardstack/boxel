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
import { officeKindBadge, officeStructureLabel } from './office-preview';

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

  get badge(): string {
    return officeKindBadge(this.kind, this.model.extension);
  }

  get structureLabel(): string {
    return officeStructureLabel(this.meta, this.kind);
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
    <div class='office-poster' data-kind={{this.kind}}>
      {{#if this.hasPosterContent}}
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
              <p
                class='page-block'
                data-style={{block.style}}
              >{{block.text}}</p>
            {{/each}}
          </div>
        {{/if}}
      {{else}}
        {{! The typed-placeholder branch: the same paper + badge + count the
            fitted cell draws for an uncaptured file, rendered as the capture
            itself so the always-served poster URL resolves to an informative
            tile (see the file header). }}
        <div class='placeholder'>
          <div class='ph-paper ph-{{this.kind}}'>
            <span class='ph-badge'>{{this.badge}}</span>
            {{#if this.structureLabel}}
              <span class='ph-count'>{{this.structureLabel}}</span>
            {{/if}}
          </div>
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

      /* The typed-placeholder branch, mirroring the fitted cell's uncaptured
         placeholder (office-preview's .off-fitted/.paper) with the capture
         palette pinned: a capture render must not depend on the host theme
         tokens the live placeholder reads. */
      .placeholder {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        padding: 10px;
        background: #eceef1;
      }
      .ph-paper {
        position: relative;
        width: 72%;
        aspect-ratio: 3 / 4;
        background: #fff;
        border: 1px solid #d8d8d8;
        border-radius: 3px;
        box-shadow: 0 1px 4px rgb(0 0 0 / 12%);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 6px;
        overflow: hidden;
      }
      .ph-presentation {
        aspect-ratio: 4 / 3;
      }
      .ph-word::before {
        content: '';
        position: absolute;
        inset: 14% 16%;
        background-image: repeating-linear-gradient(
          #d8d8d8 0 1px,
          transparent 1px 9px
        );
        opacity: 0.5;
      }
      .ph-spreadsheet::before {
        content: '';
        position: absolute;
        inset: 12% 12%;
        background-image:
          repeating-linear-gradient(#d8d8d8 0 1px, transparent 1px 16px),
          repeating-linear-gradient(90deg, #d8d8d8 0 1px, transparent 1px 22px);
        opacity: 0.5;
      }
      .ph-badge {
        position: relative;
        font-family: ui-monospace, Menlo, monospace;
        font-size: 0.6875rem;
        font-weight: 700;
        letter-spacing: 0.06em;
        color: #f7f7f5;
        background: #262626;
        padding: 2px 8px;
        border-radius: 3px;
      }
      .ph-count {
        position: relative;
        font-family: ui-monospace, Menlo, monospace;
        font-size: 0.5625rem;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: #555;
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
