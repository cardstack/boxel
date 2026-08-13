// Embedded: the format that flows inside a document. It renders complete
// content by default and picks a shape from the file's domain rather than
// imposing one height on every family — a video, a waveform, a note sequence,
// and a portrait photograph each need different vertical room.
import GlimmerComponent from '@glimmer/component';
import { htmlSafe } from '@ember/template';

import {
  boundedVideoFrameAspectRatio,
  containEmbeddedInteraction,
  fileIconFor,
  humanSize,
  shortDate,
} from './file-presentation';
import {
  FilePreviewStage,
  type FilePreviewComponent,
} from './file-preview-stage';
import type { FileViewModel } from './file-view-model';

interface FileEmbeddedShellSignature {
  Args: {
    model: FileViewModel;
    fields?: Record<string, any>;
    preview?: FilePreviewComponent;
  };
  Element: HTMLElement;
}

export class FileEmbeddedShell extends GlimmerComponent<FileEmbeddedShellSignature> {
  get icon() {
    return fileIconFor(this.args.model);
  }

  get nameHead() {
    let b = this.args.model?.baseName ?? '';
    return b.length > 16 ? b.slice(0, b.length - 8) : b;
  }

  get nameTail() {
    let b = this.args.model?.baseName ?? '';
    return b.length > 16 ? b.slice(-8) : '';
  }

  get size() {
    return humanSize(this.args.model?.contentSize);
  }

  get modified() {
    return shortDate(this.args.model?.lastModified);
  }

  get embedShape() {
    let kind = this.args.model?.previewKind ?? '';
    if (kind === 'video') {
      return 'video';
    }
    if (kind === 'waveform') {
      return 'audio';
    }
    // A piano roll needs more vertical room than native audio chrome.
    if (kind === 'midi') {
      return 'sequence';
    }
    // An interactive mockup needs a substantial inline viewport.
    if (kind === 'html') {
      return 'html-document';
    }
    // An Office document renders its extracted structure (text flow, slide grid,
    // sheet) and needs real reading height inline, not the default bounded box.
    if (
      kind === 'word' ||
      kind === 'presentation' ||
      kind === 'spreadsheet'
    ) {
      return 'office-document';
    }
    if (kind === 'svg' || kind === 'gif') {
      return 'square-visual';
    }
    if (kind === 'photo') {
      let ratio = this.args.model?.aspectRatio;
      return ratio != null && ratio < 0.9
        ? 'portrait-visual'
        : 'landscape-visual';
    }
    return 'bounded-content';
  }

  // Extracted dimensions shape the inline player, bounded so an ultrawide or
  // very tall source can't produce an unusable frame.
  get previewFrameStyle() {
    if (this.args.model?.previewKind !== 'video') {
      return undefined;
    }
    return htmlSafe(
      `aspect-ratio: ${boundedVideoFrameAspectRatio(this.args.model?.aspectRatio)}`,
    );
  }

  get videoNeedsMatte() {
    let ratio = Number(this.args.model?.aspectRatio);
    return (
      Number.isFinite(ratio) && ratio > 0 && (ratio < 4 / 5 || ratio > 16 / 9)
    );
  }

  <template>
    {{! Interaction stays local: a press on a native control must not open the
    enclosing card. Navigating to isolated stays in the host's ••• menu. }}
    <div
      class='emb'
      data-preview-kind={{@model.previewKind}}
      data-family={{@model.family}}
      data-embed-shape={{this.embedShape}}
      data-test-file-embedded
      {{containEmbeddedInteraction}}
    >
      <header class='emb-head'>
        <this.icon class='emb-icon' width='17' height='17' aria-hidden='true' />
        <div class='emb-id' title={{@model.name}}>
          <span class='emb-name'>
            <span class='sr-only'>{{@model.name}}</span>
            <span class='emb-name-visual' aria-hidden='true'><span
                class='nh'
              >{{this.nameHead}}</span><span
                class='nt'
              >{{this.nameTail}}</span></span>
          </span>
          <span class='emb-meta'>
            {{#if this.size}}{{this.size}}{{/if}}
            {{#if this.modified}}· modified {{this.modified}}{{/if}}
          </span>
        </div>
        {{#if @model.extension}}
          <span class='ext-pill'>.{{@model.extension}}</span>
        {{/if}}
      </header>
      <div
        class='emb-body'
        data-video-matted={{this.videoNeedsMatte}}
        style={{this.previewFrameStyle}}
      >
        <FilePreviewStage
          @model={{@model}}
          @mode='embedded'
          @fields={{@fields}}
          @preview={{@preview}}
        />
      </div>
    </div>
    <style scoped>
      .emb {
        background: var(--card, #fff);
        color: var(--card-foreground, var(--foreground));
        font-family: var(--font-sans);
        display: flex;
        flex-direction: column;
        width: 100%;
        min-width: 0;
        overflow: hidden;
        border: 1px solid var(--border);
        /* A host that disables its card container leaves the embed to own its
           own boundary. */
        border-radius: var(--radius, 0.5rem);
      }
      .emb-head {
        display: flex;
        align-items: center;
        gap: 9px;
        padding: 9px 12px;
        border-bottom: 1px solid var(--border);
        min-width: 0;
      }
      .emb-icon {
        flex-shrink: 0;
        color: var(--foreground);
      }
      .emb-id {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 1px;
      }
      .emb-name {
        font-size: 0.8125rem;
        font-weight: 500;
        min-width: 0;
      }
      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }
      .emb-name-visual {
        display: flex;
        min-width: 0;
        white-space: nowrap;
      }
      .emb-name-visual .nh {
        flex: 0 1 auto;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .emb-name-visual .nt {
        flex: none;
      }
      .emb-meta {
        font-family: var(--font-mono);
        font-size: 0.5625rem;
        color: var(--muted-foreground);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .ext-pill {
        flex-shrink: 0;
        font-family: var(--font-mono);
        font-size: 0.625rem;
        font-weight: 700;
        letter-spacing: 0.03em;
        color: var(--fd-paper, var(--card, #f7f7f5));
        background: var(--fd-slate, var(--foreground));
        padding: 2px 7px;
        border-radius: 4px;
      }
      .emb-body {
        height: 220px;
        min-height: 0;
        position: relative;
      }
      .emb[data-embed-shape='video'] .emb-body {
        height: auto;
        /* Player controls and poster never collapse into an ultrawide strip. */
        min-height: 220px;
        max-height: 36rem;
        background: var(--fd-slate, var(--foreground));
      }
      .emb[data-embed-shape='landscape-visual'] .emb-body {
        height: auto;
        aspect-ratio: 3 / 2;
      }
      .emb[data-embed-shape='square-visual'] .emb-body {
        height: auto;
        /* Square assets stay substantial without dominating the document. */
        aspect-ratio: 4 / 3;
      }
      .emb[data-embed-shape='portrait-visual'] .emb-body {
        height: auto;
        aspect-ratio: 4 / 5;
        max-height: 34rem;
      }
      .emb[data-embed-shape='audio'] .emb-body {
        /* Audio needs controls and a waveform, not a video-sized void. */
        height: clamp(150px, 24vw, 190px);
      }
      .emb[data-embed-shape='sequence'] .emb-body {
        /* Symbolic notes plus transport remain legible inline. */
        height: clamp(210px, 32vw, 280px);
      }
      .emb[data-embed-shape='html-document'] .emb-body {
        height: clamp(320px, 56vw, 520px);
        background: var(--card);
      }
      .emb[data-embed-shape='office-document'] .emb-body {
        /* Tall enough to read a page, browse a deck, or scan a sheet; the
           preview scrolls within it. */
        height: clamp(360px, 60vw, 560px);
        background: var(--card);
      }
      @container embedded-card (max-width: 360px) {
        .emb[data-embed-shape='bounded-content'] .emb-body {
          height: 160px;
        }
        .emb[data-embed-shape='audio'] .emb-body {
          height: 150px;
        }
      }
    </style>
  </template>
}
