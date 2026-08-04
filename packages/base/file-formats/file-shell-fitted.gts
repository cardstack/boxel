// Fitted: the parent-sized collection cell, and the format most often
// prerendered. Its layout is driven entirely by the host's `fitted-card` size
// container — this shell queries that container and deliberately does not
// create a competing one, so a grid tile, a list strip, and a badge-height row
// all get a composition that fits rather than a scaled-down copy of one design.
//
// The work budgets this format depends on (truncated text, capped rows and
// entries, resampled waveforms) are applied in `fileViewModel` before this
// component ever sees the data.
import GlimmerComponent from '@glimmer/component';

import { humanSize, iconFor, relativeDate } from './file-presentation';
import {
  FilePreviewStage,
  type FilePreviewComponent,
} from './file-preview-stage';
import type { FileViewModel } from './file-view-model';

interface FileFittedShellSignature {
  Args: {
    model: FileViewModel;
    fields?: Record<string, any>;
    preview?: FilePreviewComponent;
  };
  Element: HTMLElement;
}

const STATE_LABELS: Record<string, string> = {
  loading: 'QUEUED',
  generating: 'GENERATING',
  stale: 'STALE',
  failed: 'FAILED',
  unsupported: 'NO READER',
  empty: 'EMPTY',
  malformed: 'PARTIAL',
};

export class FileFittedShell extends GlimmerComponent<FileFittedShellSignature> {
  get icon() {
    return iconFor(this.args.model?.previewKind, this.args.model?.family);
  }

  // A sparse or still-loading FileDef must still show something identifying.
  get displayName() {
    return (
      this.args.model?.name ??
      this.args.model?.baseName ??
      this.args.model?.kind ??
      'Untitled file'
    );
  }

  get displayBaseName() {
    return (
      this.args.model?.baseName ??
      this.args.model?.name ??
      this.args.model?.kind ??
      'Untitled file'
    );
  }

  // Split the name so the head can ellipsize while the tail stays visible:
  // `quarterly-financial-rep…-final` beats `quarterly-financial-rep…`.
  get nameHead() {
    let b = this.displayBaseName;
    return b.length > 12 ? b.slice(0, b.length - 6) : b;
  }

  get nameTail() {
    let b = this.displayBaseName;
    return b.length > 12 ? b.slice(-6) : '';
  }

  get modified() {
    return relativeDate(this.args.model?.lastModified);
  }

  get size() {
    return humanSize(this.args.model?.contentSize);
  }

  get stateChip() {
    let state = this.args.model?.fileState ?? 'normal';
    if (state === 'normal') {
      return '';
    }
    return STATE_LABELS[state] ?? state.toUpperCase();
  }

  get isWarnState() {
    return ['stale', 'failed', 'malformed', 'unsupported'].includes(
      this.args.model?.fileState ?? 'normal',
    );
  }

  // A waveform is semantic SVG rather than a screenshot crop, so it renders
  // live in the thumbnail rail even when a cached rendition exists — and it
  // needs horizontal measure, which a square rail would destroy.
  get isWaveform() {
    return this.args.model?.previewKind === 'waveform';
  }

  get waveformModel() {
    return { ...this.args.model, thumbnailUrl: '' };
  }

  get previewModel() {
    return this.isWaveform ? this.waveformModel : this.args.model;
  }

  get thumbUrl() {
    let m = this.args.model;
    if (m?.thumbnailUrl && !m?.thumbnailStale) {
      return String(m.thumbnailUrl);
    }
    if (!m?.imageUrl) {
      return '';
    }
    // Only kinds whose source image is itself the right picture go straight to
    // the source; everything else waits for an extracted rendition.
    return ['photo', 'gif', 'video', 'svg'].includes(m.previewKind ?? '')
      ? String(m.imageUrl)
      : '';
  }

  get thumbContain() {
    if (this.args.model?.previewKind === 'svg') {
      return true;
    }
    // A square center-crop of a panorama or a skyscraper is meaningless, so
    // contain those; ordinary shapes may cover.
    let r = this.args.model?.aspectRatio;
    return r != null && (r >= 2.5 || r <= 0.4);
  }

  <template>
    <div class='fit' data-test-file-fitted>
      <div class='fit-stage'>
        <FilePreviewStage
          @model={{this.previewModel}}
          @mode='fitted'
          @fields={{@fields}}
          @preview={{@preview}}
        />
      </div>
      <div
        class='fit-thumb
          {{if this.thumbContain "contain"}}
          {{if this.isWaveform "waveform-thumb"}}'
      >
        {{#if this.isWaveform}}
          <FilePreviewStage
            @model={{this.waveformModel}}
            @mode='fitted'
            @fields={{@fields}}
            @preview={{@preview}}
          />
        {{else if this.thumbUrl}}
          <img class='thumb-img' src={{this.thumbUrl}} alt='' loading='lazy' />
        {{else}}
          <this.icon width='22' height='22' aria-hidden='true' />
        {{/if}}
      </div>
      <div class='strip'>
        <div class='row-id' title={{this.displayName}}>
          <this.icon
            class='id-icon'
            width='16'
            height='16'
            aria-hidden='true'
          />
          <span class='id-name'>
            <span class='sr-only'>{{this.displayName}}</span>
            <span class='id-name-1l' aria-hidden='true'><span
                class='nh'
              >{{this.nameHead}}</span><span
                class='nt'
              >{{this.nameTail}}</span></span>
            <span
              class='id-name-2l'
              aria-hidden='true'
            >{{this.displayBaseName}}</span>
          </span>
          {{#if this.stateChip}}
            <span
              class='state-chip chip-inline {{if this.isWarnState "warn"}}'
              data-test-file-state-chip
            >{{this.stateChip}}</span>
          {{/if}}
          <span class='ext-pill pill-inline'>.{{@model.extension}}</span>
        </div>
        <div class='row-sub'>
          <span class='sub-left'>
            {{#if @model.heroFact}}<span
                class='sub-fact'
              >{{@model.heroFact}}</span>{{/if}}
            {{#if this.modified}}<span class='sub-mod'>·
                {{this.modified}}</span>
            {{/if}}
          </span>
          <span class='sub-right'>
            {{#if this.stateChip}}
              <span
                class='state-chip chip-sub {{if this.isWarnState "warn"}}'
              >{{this.stateChip}}</span>
            {{/if}}
            <span class='ext-pill pill-sub'>.{{@model.extension}}</span>
          </span>
        </div>
        <div class='row-type'>
          {{#if @model.kind}}<span
              class='kind'
              data-test-file-kind
            >{{@model.kind}}</span>{{/if}}
          <span class='type-right'>
            {{#if this.stateChip}}
              <span
                class='state-chip chip-type {{if this.isWarnState "warn"}}'
              >{{this.stateChip}}</span>
            {{/if}}
            <span class='ext-pill pill-type'>.{{@model.extension}}</span>
          </span>
        </div>
        <div class='row-facts'>
          {{#if @model.heroFact}}<span class='fact'>{{@model.heroFact}}</span>
          {{/if}}
          {{#if this.modified}}<span class='fact'>· {{this.modified}}</span>
          {{/if}}
          {{#each @model.facts as |fact|}}<span class='fact'>· {{fact}}</span>
          {{/each}}
          {{#if this.size}}<span class='fact'>· {{this.size}}</span>{{/if}}
        </div>
        <div class='row-badges'>
          {{#each @model.badges as |badge|}}<span class='badge'>{{badge}}</span>
          {{/each}}
        </div>
      </div>
    </div>
    <style scoped>
      .fit {
        /* Match the host's `fitted-card` size container rather than declaring
           a competing one. */
        width: 100%;
        height: 100%;
        display: grid;
        grid-template-rows: minmax(0, 1fr) auto;
        min-width: 0;
        overflow: hidden;
        background: var(--card, #fff);
        color: var(--card-foreground, var(--foreground));
        font-family: var(--font-sans);
      }
      .fit-stage {
        min-height: 0;
        min-width: 0;
        overflow: hidden;
        border-bottom: 1px solid var(--border);
      }
      .fit-thumb {
        display: none;
        height: 100%;
        aspect-ratio: 1;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        background: var(--fd-stage, var(--muted, #eceef1));
        border-right: 1px solid var(--border);
        color: var(--muted-foreground);
      }
      .thumb-img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .fit-thumb.contain {
        background: var(--fd-paper, var(--card, #f7f7f5));
      }
      .fit-thumb.contain .thumb-img {
        object-fit: contain;
        padding: 6px;
      }
      /* A signal needs horizontal measure; a square rail destroys its shape. */
      .fit-thumb.waveform-thumb {
        position: relative;
        width: clamp(112px, 32cqw, 180px);
        aspect-ratio: auto;
        background: var(--fd-slate, var(--foreground));
      }
      .fit-thumb.waveform-thumb :deep(.stage) {
        width: 100%;
        height: 100%;
      }
      .strip {
        padding: 7px 10px 8px;
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 0;
        min-height: 0;
        overflow: hidden;
        /* The metadata rail owns a stable readable surface in every theme. */
        background: var(--card);
        color: var(--foreground);
      }
      .row-id {
        display: flex;
        align-items: center;
        gap: 7px;
        min-width: 0;
      }
      .id-icon {
        flex-shrink: 0;
        color: var(--foreground);
      }
      .id-name {
        flex: 1;
        min-width: 0;
        font-size: 0.8125rem;
        font-weight: 600;
        letter-spacing: -0.01em;
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
      .id-name-1l {
        display: flex;
        min-width: 0;
        white-space: nowrap;
      }
      .id-name-1l .nh {
        flex: 0 1 auto;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .id-name-1l .nt {
        flex: none;
      }
      .id-name-2l {
        display: none;
      }
      .ext-pill {
        flex-shrink: 0;
        font-family: var(--font-mono);
        font-size: 0.625rem;
        font-weight: 700;
        letter-spacing: 0.02em;
        color: var(--fd-paper, var(--card, #f7f7f5));
        background: var(--fd-slate, var(--foreground));
        padding: 2px 5px;
        border-radius: 4px;
      }
      .state-chip {
        flex-shrink: 0;
        font-family: var(--font-mono);
        font-size: 0.5rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        color: var(--muted-foreground);
        border: 1px solid var(--border);
        padding: 1px 5px;
        border-radius: 3px;
      }
      .state-chip.warn {
        color: var(--fd-warn, #e8710a);
        border-color: var(--fd-warn, #e8710a);
      }
      .row-sub {
        display: none;
        align-items: center;
        gap: 8px;
        min-width: 0;
        font-family: var(--font-mono);
        font-size: 0.5625rem;
        letter-spacing: 0.02em;
        color: var(--muted-foreground);
      }
      .sub-left {
        flex: 1;
        min-width: 0;
        display: flex;
        align-items: baseline;
        gap: 6px;
        white-space: nowrap;
        overflow: hidden;
      }
      .sub-right {
        flex-shrink: 0;
        margin-left: auto;
        display: inline-flex;
        align-items: center;
        gap: 5px;
      }
      /* The pill anchors the right end of whichever meta line exists; only the
         single-line badge height keeps it inline with the name. */
      @container fitted-card (min-height: 50px) {
        .pill-inline,
        .chip-inline {
          display: none;
        }
      }
      .row-type {
        display: none;
        align-items: center;
        gap: 7px;
        min-width: 0;
      }
      .kind {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-family: var(--font-sans);
        font-size: 0.6875rem;
        font-weight: 500;
        letter-spacing: 0.01em;
        color: var(--foreground);
        opacity: 0.75;
      }
      .type-right {
        flex-shrink: 0;
        margin-left: auto;
        display: inline-flex;
        align-items: center;
        gap: 5px;
      }
      .row-facts {
        display: none;
        min-width: 0;
        font-family: var(--font-mono);
        font-size: 0.5625rem;
        letter-spacing: 0.02em;
        color: var(--muted-foreground);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .row-badges {
        display: none;
        gap: 5px;
        flex-wrap: wrap;
      }
      .badge {
        font-family: var(--font-mono);
        font-size: 0.5rem;
        font-weight: 600;
        letter-spacing: 0.07em;
        text-transform: uppercase;
        padding: 2px 6px;
        border-radius: 3px;
        border: 1px solid var(--border);
        color: var(--muted-foreground);
      }

      /* Badge height: identity only, stage hidden. */
      @container fitted-card (max-height: 129px) {
        .fit {
          grid-template-rows: auto;
        }
        .fit-stage {
          display: none;
        }
        .strip {
          justify-content: center;
          height: 100%;
        }
      }
      /* Short strip: identity + hero fact + modified. */
      @container fitted-card (min-height: 50px) and (max-height: 79px) {
        .row-sub {
          display: flex;
        }
      }
      /* Taller strip: add the type line and the facts line. */
      @container fitted-card (min-height: 80px) {
        .row-type {
          display: flex;
        }
        .row-facts {
          display: block;
        }
      }
      /* Wide short strips (list view): an explicit thumbnail column with the
         metadata rail beside it. Every family shares this composition — auto
         placement would drop the text below the thumbnail instead. */
      @container fitted-card (min-height: 50px) and (max-height: 129px) and (min-width: 380px) {
        .fit {
          grid-template-columns: auto minmax(0, 1fr);
          grid-template-rows: minmax(0, 1fr);
          grid-template-areas: 'thumbnail metadata';
        }
        .fit-thumb {
          display: flex;
          grid-area: thumbnail;
          min-width: 0;
        }
        .strip {
          grid-area: metadata;
          justify-content: center;
          width: 100%;
          max-height: 100%;
        }
      }
      /* Tiles and cards: the name earns two lines, and the stage takes over
         announcing state. */
      @container fitted-card (min-height: 130px) {
        .row-id {
          align-items: flex-start;
        }
        .id-name-1l {
          display: none;
        }
        .id-name-2l {
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
          line-clamp: 2;
          overflow: hidden;
          line-height: 1.25;
          overflow-wrap: anywhere;
        }
        .state-chip {
          display: none;
        }
      }
      /* Room for badges. */
      @container fitted-card (min-height: 200px) and (min-width: 224px) {
        .row-badges {
          display: flex;
        }
      }
      /* Narrow columns: badges yield; the facts line ellipsizes on its own. */
      @container fitted-card (max-width: 170px) {
        .row-badges {
          display: none;
        }
      }
    </style>
  </template>
}
