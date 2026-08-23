// The preview slot the four format shells project into.
//
// A shell never knows how to draw a PDF, a waveform, or a 3D scene. It renders
// this stage, which owns the concerns every family shares — the current-render
// cache, the loading and failure panes, provenance and staleness signals — and
// hands the remaining space to the family's own renderer. A FileDef subclass
// supplies that renderer as `static previewComponent`; a file whose family has
// no renderer yet gets an honest generic pane rather than a broken one.
import GlimmerComponent from '@glimmer/component';

import { eq } from '@cardstack/boxel-ui/helpers';
// The boxel-ui icon barrel is a single module already in every card's
// dependency graph, so a glyph taken from it costs nothing extra.
import { Warning } from '@cardstack/boxel-ui/icons';

import { downloadNameFor, fileIconFor, humanSize } from './file-presentation';
import type {
  FileFormat,
  FileModelLike,
  FileViewModel,
} from './file-view-model';

import type { ComponentLike } from '@glint/template';

export interface FilePreviewSignature {
  Args: {
    model: FileViewModel;
    // Which shell is rendering: `fitted` is the budgeted collection cell,
    // `embedded` and `isolated` may show complete content.
    mode: FileFormat;
    // The host format component's `@fields`, so a family renderer can delegate
    // to a declared field's own component (a MarkdownField viewer, say) rather
    // than re-implementing its rendering.
    fields?: Record<string, any>;
  };
  Element: HTMLElement;
}

export type FilePreviewComponent = ComponentLike<FilePreviewSignature>;

// The content-only face of a family renderer, for the components the
// `file-formats/index` barrel exports (MarkdownPreview, ImagePreview,
// AudioPreview): just the file's content, none of the shell chrome — no file
// bar, no inspector, no Download/Copy-link. `model` is the FileDef instance
// itself in the common case (the component projects it through
// `fileViewModel`), or a prebuilt FileViewModel (what the shells pass). `mode`
// defaults to 'embedded', the complete-content rendition; 'fitted' selects the
// budgeted snippet a collection cell draws. A prebuilt view model must have
// been projected at the same format passed as `mode`: the fitted budgets are
// applied at projection time, so a complete-content projection rendered at
// 'fitted' would feed the whole file to the snippet branch. A consumer that
// varies `mode` should pass the instance and let the component re-project.
// These components render content
// only — the loading/failure/staleness panes are `FilePreviewStage`'s job
// inside the shells, so an embedding author owns those states.
export interface ContentPreviewSignature {
  Args: {
    model: FileViewModel | FileModelLike | undefined | null;
    mode?: FileFormat;
    fields?: Record<string, any>;
  };
  Element: HTMLElement;
}

// The renderer a file's own class declares, if its family has landed one. Read
// from the instance's constructor rather than the declared field class, since a
// `linksTo(FileDef)` is routinely populated with a subclass instance.
export function filePreviewComponentFor(
  model: object | undefined | null,
  cardOrField?: unknown,
): FilePreviewComponent | undefined {
  let klass = (model?.constructor ?? cardOrField) as
    | { previewComponent?: FilePreviewComponent }
    | undefined;
  return klass?.previewComponent;
}

interface StageSignature {
  Args: FilePreviewSignature['Args'] & {
    preview?: FilePreviewComponent;
  };
  Element: HTMLElement;
}

export class FilePreviewStage extends GlimmerComponent<StageSignature> {
  get model() {
    return this.args.model;
  }

  get state() {
    return this.model?.fileState ?? 'normal';
  }

  // `stale` and `malformed` still have real content worth showing; they get a
  // banner over the render rather than instead of it.
  get showReal() {
    return ['normal', 'stale', 'malformed'].includes(this.state);
  }

  // A fitted cell prefers a current extracted rendition over mounting a heavy
  // engine. A stale one is not usable: it was rendered from bytes the file no
  // longer has.
  get useThumbnail() {
    return (
      this.args.mode === 'fitted' &&
      Boolean(this.model?.thumbnailUrl) &&
      !this.model?.thumbnailStale
    );
  }

  get icon() {
    return fileIconFor(this.model);
  }

  // The generic pane stands in for a file whose family has no renderer — most
  // often a plain binary. Rather than an empty "No preview" void, the reading
  // formats present what the realm does know: name, kind, and size, plus a way
  // to get the bytes.
  get displayName() {
    return this.model?.name || this.model?.baseName || 'Untitled file';
  }

  get size() {
    return humanSize(this.model?.contentSize);
  }

  // The reading formats have room for a labeled fallback card; the budgeted
  // fitted cell stays a bare glyph so it never competes with the metadata strip
  // the fitted shell draws beside it.
  get showGenericDetail() {
    return this.args.mode === 'embedded' || this.args.mode === 'isolated';
  }

  // Embedded is the only reading format whose shell offers no download of its
  // own, so the fallback pane carries the affordance there. The isolated shell
  // already exposes Download and Copy link in its header.
  get showGenericDownload() {
    return this.args.mode === 'embedded' && Boolean(this.model?.url);
  }

  get genericIconSize() {
    return this.showGenericDetail ? '44' : '30';
  }

  <template>
    <div
      class='stage'
      data-mode={{@mode}}
      data-file-state={{this.state}}
      data-test-file-preview-stage
      ...attributes
    >
      {{#if this.useThumbnail}}
        <img
          class='generated-thumbnail'
          src={{this.model.thumbnailUrl}}
          alt=''
          loading='lazy'
        />
      {{else if this.showReal}}
        {{#if @preview}}
          <@preview @model={{@model}} @mode={{@mode}} @fields={{@fields}} />
        {{else}}
          <div class='generic-pane' data-test-file-no-preview>
            <this.icon
              class='gp-icon'
              width={{this.genericIconSize}}
              height={{this.genericIconSize}}
              aria-hidden='true'
            />
            {{#if this.showGenericDetail}}
              <div
                class='gp-name'
                title={{this.displayName}}
                data-test-file-generic-name
              >{{this.displayName}}</div>
              <div class='gp-facts'>
                {{#if @model.kind}}<span
                    data-test-file-generic-kind
                  >{{@model.kind}}</span>{{/if}}
                {{#if this.size}}<span
                    data-test-file-generic-size
                  >{{this.size}}</span>{{/if}}
              </div>
              {{#if this.showGenericDownload}}
                <a
                  class='gp-download'
                  href={{@model.url}}
                  download={{downloadNameFor @model}}
                  data-test-file-generic-download
                >Download</a>
              {{/if}}
            {{else}}
              <span class='pane-label'>No preview</span>
            {{/if}}
          </div>
        {{/if}}

        {{#if (eq this.state 'stale')}}
          <span class='stale-chip'>Stale</span>
        {{/if}}
        {{#if (eq this.state 'malformed')}}
          <div class='malformed-banner'>Partial · some content unreadable</div>
        {{/if}}
        {{! No provenance overlay: a tag floated over the render lands on
        whatever the family draws in that corner — a prose preview's title, an
        archive tree's first row — and provenance already has a home in the
        isolated shell's metadata chrome. }}
      {{else if (eq this.state 'loading')}}
        <div class='state-pane'>
          <div class='skeleton-bar'></div>
          <span class='pane-label'>Queued · waiting to render</span>
        </div>
      {{else if (eq this.state 'generating')}}
        <div class='state-pane'>
          <div class='progress-track'><div class='progress-fill'></div></div>
          <span class='pane-label'>Generating preview</span>
        </div>
      {{else if (eq this.state 'failed')}}
        <div class='state-pane'>
          <Warning
            class='warn-icon'
            width='24'
            height='24'
            aria-hidden='true'
          />
          <span class='pane-label'>Preview failed</span>
        </div>
      {{else if (eq this.state 'unsupported')}}
        <div class='state-pane'>
          <this.icon width='28' height='28' aria-hidden='true' />
          <span class='pane-label'>Unsupported · generic</span>
        </div>
      {{else if (eq this.state 'empty')}}
        <div class='state-pane'>
          <div class='empty-box'><span class='pane-label'>0 bytes · empty</span>
          </div>
        </div>
      {{/if}}
    </div>

    <style scoped>
      .stage {
        position: relative;
        height: 100%;
        min-height: 0;
        background: var(--fd-stage, var(--muted, #eceef1));
        overflow: hidden;
        display: grid;
        place-items: center;
        color: var(--foreground);
      }
      /* The extracted rendition is matted to fill, never stretched, and never
         re-rendered from source in a collection cell. */
      .generated-thumbnail {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
        object-position: center;
        background: var(--fd-stage, var(--muted, #eceef1));
      }
      .generic-pane,
      .state-pane {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 8px;
        color: var(--muted-foreground);
        padding: 10px;
      }
      .pane-label {
        font-family: var(--font-mono);
        font-size: 0.53125rem;
        letter-spacing: 0.1em;
        text-transform: uppercase;
      }
      .gp-icon {
        color: var(--muted-foreground);
      }
      .gp-name {
        max-width: min(100%, 22rem);
        font-family: var(--font-sans);
        font-size: 0.8125rem;
        font-weight: 600;
        color: var(--foreground);
        text-align: center;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .gp-facts {
        display: flex;
        align-items: center;
        gap: 8px;
        font-family: var(--font-mono);
        font-size: 0.5625rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--muted-foreground);
      }
      .gp-download {
        margin-top: 4px;
        font-family: var(--font-sans);
        font-size: 0.71875rem;
        font-weight: 600;
        text-decoration: none;
        color: var(--fd-paper, var(--card, #f7f7f5));
        background: var(--fd-slate, var(--foreground));
        border: 1px solid var(--fd-slate, var(--foreground));
        border-radius: 6px;
        padding: 5px 14px;
        line-height: 1.4;
      }
      /* The glyph paints with `fill`, so tint it rather than setting `color`. */
      .warn-icon {
        fill: var(--fd-warn, #e8710a);
      }
      .skeleton-bar {
        width: 62%;
        height: 8px;
        border-radius: 4px;
        background: linear-gradient(
          90deg,
          var(--fd-stage-deep, #e2e5ea) 30%,
          var(--card, #f4f6f8) 50%,
          var(--fd-stage-deep, #e2e5ea) 70%
        );
        background-size: 220% 100%;
        animation: fd-shimmer 1.5s linear infinite;
      }
      .progress-track {
        width: 74%;
        height: 4px;
        border-radius: 2px;
        background: var(--fd-stage-deep, #d7dae1);
        overflow: hidden;
      }
      .progress-fill {
        width: 64%;
        height: 100%;
        background: var(--fd-accent, var(--primary, #00ffba));
      }
      .empty-box {
        width: 80%;
        min-height: 56px;
        border: 1.5px dashed var(--border);
        border-radius: 6px;
        display: grid;
        place-items: center;
        padding: 8px;
      }
      .stale-chip {
        position: absolute;
        top: 8px;
        right: 8px;
        font-family: var(--font-mono);
        font-size: 0.5rem;
        font-weight: 700;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: #fff;
        background: var(--fd-warn, #e8710a);
        padding: 3px 6px;
        border-radius: 3px;
      }
      .malformed-banner {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgb(232 113 10 / 14%);
        border-top: 1px solid rgb(232 113 10 / 40%);
        padding: 4px 8px;
        font-family: var(--font-mono);
        font-size: 0.5rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--fd-warn, #e8710a);
        text-align: left;
      }
      @keyframes fd-shimmer {
        0% {
          background-position: -180% 0;
        }
        100% {
          background-position: 180% 0;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .skeleton-bar {
          animation: none;
        }
      }
    </style>
  </template>
}
