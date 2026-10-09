// Pretui — Image: an image in a reserved frame, with a load state, a fallback and an optional preview.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
// type-only gap: 'ember-modifier' resolves at realm runtime; glint cannot see
// it here (accepted parse baseline, same as toaster.gts / focus.gts)
import { modifier } from 'ember-modifier';
import { AspectRatio } from './aspect-ratio';
import { Dialog } from './dialog';

export type ImageStatus = 'loading' | 'loaded' | 'error';

interface LoadAttempt {
  for: string | undefined;
  triedFallback: boolean;
  failed: boolean;
  loaded: boolean;
}

function freshAttempt(src: string | undefined): LoadAttempt {
  return { for: src, triedFallback: false, failed: false, loaded: false };
}

export interface ImageSignature {
  Args: {
    src?: string;
    /**
     * Responsive candidates (`url 480w, url 960w`) the browser chooses from
     * by `@sizes`, keeping `@src` as the fallback. Dropped once `@fallback`
     * is in use, so a failed set never shadows the fallback.
     */
    srcset?: string;
    /** How wide the image is drawn, for choosing from `@srcset`. Default
     * `100vw`, the browser's own default. */
    sizes?: string;
    /**
     * Required. The image's accessible name, or `''` for a decorative image.
     * There is no default: an omitted alt is a decision nobody made.
     */
    alt: string;
    /** The ratio to reserve, a number or `'16 / 9'`. Defaults to `@width / @height`, then 4 / 3. */
    ratio?: number | string;
    /** `cover` (default) crops to the frame; `contain` letterboxes. */
    fit?: 'cover' | 'contain';
    /** Intrinsic pixel size; also the ratio when `@ratio` is absent. */
    width?: number;
    height?: number;
    /** `lazy` (default) or `eager`. */
    loading?: 'lazy' | 'eager';
    /** A second source tried once when `@src` fails. */
    fallback?: string;
    /** Click or Enter opens the image larger in a dialog. */
    preview?: boolean;
    /** The preview button's name prefix (default 'View larger'). */
    previewLabel?: string;
    /** Corner radius, any kit-valid CSS length. */
    radius?: string;
    /** Draw the kit hairline around the frame. */
    bordered?: boolean;
    /** Fires whenever the load state changes. */
    onStatusChange?: (status: ImageStatus) => void;
  };
  Blocks: {
    /** What shows when every source has failed. Defaults to a glyph and the alt text. */
    fallback: [];
  };
  Element: HTMLDivElement;
}

/**
 * The public image agents reach for. AspectRatio is the frame it sits in:
 * the ratio is reserved before the bytes arrive, so nothing reflows (Law 8).
 * On top of that frame it adds what every React kit's Image adds — a load
 * state, a fallback source, a failure face that is not the browser's broken
 * icon, and a preview.
 *
 * ImageFrame is the media adapter MediaViewer renders a resolved asset with,
 * dimensions caption included. Image takes plain args and is the one to use
 * in a card.
 */
export class Image extends Component<ImageSignature> {
  // The load state belongs to one `@src`: a new source starts fresh.
  @tracked private attempt: LoadAttempt = freshAttempt(undefined);
  @tracked previewOpen = false;

  private get current(): LoadAttempt {
    return this.attempt.for === this.args.src ? this.attempt : freshAttempt(this.args.src);
  }
  private update(change: Partial<LoadAttempt>) {
    this.attempt = { ...this.current, ...change };
  }

  get currentSrc(): string | undefined {
    return this.current.triedFallback ? this.args.fallback : this.args.src;
  }
  get currentSrcset(): string | undefined {
    return this.current.triedFallback ? undefined : this.args.srcset;
  }
  get currentSizes(): string | undefined {
    return this.currentSrcset ? this.args.sizes : undefined;
  }
  get status(): ImageStatus {
    if (this.current.failed || !this.currentSrc) {
      return 'error';
    }
    return this.current.loaded ? 'loaded' : 'loading';
  }
  get errored(): boolean {
    return this.status === 'error';
  }
  get ratio(): number | string {
    if (this.args.ratio !== undefined) {
      return this.args.ratio;
    }
    let { width, height } = this.args;
    return width && height ? `${width} / ${height}` : '4 / 3';
  }
  get alt(): string {
    return (this.args.alt ?? '').trim();
  }
  get previewName(): string {
    let prefix = this.args.previewLabel ?? 'View larger';
    return this.alt ? `${prefix}: ${this.alt}` : prefix;
  }
  get canPreview(): boolean {
    return (this.args.preview ?? false) && this.status === 'loaded';
  }

  private report() {
    this.args.onStatusChange?.(this.status);
  }

  private settle(img: HTMLImageElement) {
    if (img.naturalWidth > 0) {
      if (!this.current.loaded) {
        this.update({ loaded: true });
        this.report();
      }
    } else {
      this.fail();
    }
  }

  private fail() {
    // a fallback identical to the source would never fire a second error
    let fallback = this.args.fallback;
    if (!this.current.triedFallback && fallback && fallback !== this.args.src) {
      this.update({ triedFallback: true, loaded: false });
    } else {
      this.update({ failed: true, loaded: false });
    }
    this.report();
  }

  onLoad = (event: Event) => {
    this.settle(event.currentTarget as HTMLImageElement);
  };
  onError = () => {
    this.fail();
  };

  /** A cached image can finish before the listeners exist; read its state once they do. */
  watchComplete = modifier((img: HTMLImageElement) => {
    if (img.complete && img.currentSrc) {
      queueMicrotask(() => this.settle(img));
    }
  });

  openPreview = () => {
    this.previewOpen = true;
  };
  closePreview = () => {
    this.previewOpen = false;
  };

  <template>
    <AspectRatio
      @ratio={{this.ratio}}
      @radius={{@radius}}
      @bordered={{@bordered}}
      class='pretui-image'
      data-status={{this.status}}
      data-fit={{if @fit @fit 'cover'}}
      data-test-pretui-image
      ...attributes
    >
      {{#if this.errored}}
        <div class='pretui-image-fallback' data-test-pretui-image-fallback>
          {{#if (has-block 'fallback')}}
            {{yield to='fallback'}}
          {{else}}
            <svg class='pretui-image-broken' width='20' height='20' viewBox='0 0 20 20' aria-hidden='true'><path
                d='M3 4h14v12H3zM3 13l4-4 3 3 2-2 5 5M13 7.5a1 1 0 1 0 0 .01'
                fill='none'
                stroke='currentColor'
                stroke-width='1.4'
                stroke-linejoin='round'
              /></svg>
            {{#if this.alt}}<span class='pretui-image-alt' role='img' aria-label={{this.alt}}>{{this.alt}}</span>{{/if}}
          {{/if}}
        </div>
      {{else if @preview}}
        <button
          type='button'
          class='pretui-image-trigger'
          aria-label={{this.previewName}}
          aria-haspopup='dialog'
          disabled={{if this.canPreview false true}}
          data-test-pretui-image-preview-trigger
          {{on 'click' this.openPreview}}
        >
          <img
            class='pretui-image-img'
            sizes={{this.currentSizes}}
            srcset={{this.currentSrcset}}
            src={{this.currentSrc}}
            alt=''
            width={{@width}}
            height={{@height}}
            loading={{if @loading @loading 'lazy'}}
            decoding='async'
            data-test-pretui-image-img
            {{on 'load' this.onLoad}}
            {{on 'error' this.onError}}
            {{this.watchComplete}}
          />
        </button>
      {{else}}
        <img
          class='pretui-image-img'
          sizes={{this.currentSizes}}
          srcset={{this.currentSrcset}}
          src={{this.currentSrc}}
          alt={{this.alt}}
          width={{@width}}
          height={{@height}}
          loading={{if @loading @loading 'lazy'}}
          decoding='async'
          data-test-pretui-image-img
          {{on 'load' this.onLoad}}
          {{on 'error' this.onError}}
          {{this.watchComplete}}
        />
      {{/if}}
    </AspectRatio>
    {{#if @preview}}
      <Dialog
        @open={{this.previewOpen}}
        @onClose={{this.closePreview}}
        @label={{if this.alt this.alt 'Image preview'}}
        @size='l'
        data-test-pretui-image-preview
      >
        <:default>
          {{#if this.previewOpen}}
            <img class='pretui-image-large' src={{this.currentSrc}} alt={{this.alt}} />
          {{/if}}
        </:default>
      </Dialog>
    {{/if}}
    <style scoped>
      /* above AspectRatio's layer, so these win by layer order, not file order */
      @layer PretComponent, PretComposite;
      @layer PretComposite {
        .pretui-image-img {
          display: block;
          inline-size: 100%;
          block-size: 100%;
          object-fit: cover;
          opacity: 1;
          transition: opacity var(--pretui-dur-enter, 220ms) var(--pretui-ease-enter, ease-out);
        }
        .pretui-image[data-fit='contain'] .pretui-image-img {
          object-fit: contain;
        }
        .pretui-image[data-status='loading'] .pretui-image-img {
          opacity: 0;
        }
        .pretui-image[data-status='loading'] {
          background-image: linear-gradient(
            100deg,
            transparent 30%,
            color-mix(in oklch, var(--card) 55%, transparent) 50%,
            transparent 70%
          );
          background-size: 200% 100%;
          animation: pretui-image-shimmer 1.4s linear infinite;
        }
        .pretui-image-trigger {
          display: block;
          inline-size: 100%;
          block-size: 100%;
          padding: 0;
          border: 0;
          background: none;
          cursor: zoom-in;
        }
        .pretui-image-trigger:disabled {
          cursor: default;
        }
        .pretui-image-trigger:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: -2px;
        }
        .pretui-image-fallback {
          display: grid;
          place-content: center;
          justify-items: center;
          gap: var(--space-2, 0.375rem);
          padding: var(--space-4, 0.6875rem);
          color: var(--muted-foreground);
          text-align: center;
        }
        .pretui-image-alt {
          font-size: var(--text-ui-sm, 0.72rem);
          max-inline-size: 28ch;
          overflow-wrap: anywhere;
        }
        .pretui-image-large {
          display: block;
          max-inline-size: 100%;
          max-block-size: 75vh;
          margin-inline: auto;
          object-fit: contain;
        }
        @keyframes pretui-image-shimmer {
          from {
            background-position: 150% 0;
          }
          to {
            background-position: -50% 0;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .pretui-image[data-status='loading'] {
            animation: none;
          }
          .pretui-image-img {
            transition: none;
          }
        }
      }
    </style>
  </template>
}
