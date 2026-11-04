// Pretui — Logo: an app or brand mark. An image of any aspect ratio (never
// cropped) when there is one; the name as a wordmark, or its initials in a
// square mark, when there is not. It is a mark, not an identity disc: use
// Avatar for a person.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { resolveSize } from '../pretui-primitives';
import type { PretuiSizeArg } from '../pretui-primitives';

export const LOGO_VARIANTS = ['auto', 'mark', 'wordmark'] as const;
export type LogoVariant = (typeof LOGO_VARIANTS)[number];

// An image wider than this ratio reads as a wordmark, anything else as a mark.
const WORDMARK_RATIO = 1.25;
const STARTS_WITH_WORD_CHAR = new RegExp('^[\\p{L}\\p{N}]', 'u');

export interface LogoSignature {
  Args: {
    /** Image URL (svg, png, jpg, webp), drawn whole with `object-fit: contain`. */
    src?: string;
    /** The wordmark when there is no image or it fails to load, the initials
     * in a mark, and the accessible name. */
    name?: string;
    /** `mark` is a square, `wordmark` is as wide as its content, `auto` (the
     * default) picks from the loaded image's aspect ratio; with no image it is
     * `wordmark`. */
    variant?: LogoVariant;
    /** The height: 'xs' | 's' | 'm' | 'l' | 'xl' (default 'm'). The width follows. */
    size?: PretuiSizeArg;
    /** True when text beside the logo already says the name: the logo is
     * hidden from assistive tech instead of repeating it. */
    decorative?: boolean;
  };
  Element: HTMLSpanElement;
}

export class Logo extends Component<LogoSignature> {
  @tracked failedSrc: string | undefined;
  @tracked measured: { src: string; ratio: number } | undefined;

  get showImage(): boolean {
    return Boolean(this.args.src) && this.args.src !== this.failedSrc;
  }
  get size() {
    return resolveSize(this.args.size, 'm');
  }
  get variant(): 'mark' | 'wordmark' {
    let { variant } = this.args;
    if (variant === 'mark' || variant === 'wordmark') return variant;
    // auto: the image's own ratio once it has loaded; the text is a wordmark
    let { measured } = this;
    if (this.showImage && measured?.src === this.args.src) {
      return measured.ratio > WORDMARK_RATIO ? 'wordmark' : 'mark';
    }
    return this.showImage ? 'mark' : 'wordmark';
  }
  get initials(): string {
    return (this.args.name ?? '')
      .split(/\s+/)
      .filter((w) => STARTS_WITH_WORD_CHAR.test(w))
      .map((w) => w[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
  }
  get showInitials(): boolean {
    return !this.showImage && this.variant === 'mark';
  }
  // An image carries its name as alt text. Text is its own name as a
  // wordmark; initials need a role and label to say the whole name.
  get alt(): string {
    return this.args.decorative ? '' : (this.args.name ?? '');
  }
  get initialsRole(): string | undefined {
    return this.args.decorative ? undefined : 'img';
  }
  get initialsLabel(): string | undefined {
    return this.args.decorative ? undefined : this.args.name;
  }
  imageLoad = (event: Event) => {
    let img = event.target as HTMLImageElement;
    if (img.naturalWidth && img.naturalHeight && this.args.src) {
      this.measured = {
        src: this.args.src,
        ratio: img.naturalWidth / img.naturalHeight,
      };
    }
  };
  imageError = () => {
    this.failedSrc = this.args.src;
  };

  <template>
    <span
      class='pretui-logo'
      data-size={{this.size}}
      data-variant={{this.variant}}
      data-has-image={{if this.showImage 'true'}}
      data-state={{if this.failedSrc 'fallback'}}
      aria-hidden={{if @decorative 'true'}}
      data-test-pretui-logo
      ...attributes
    >
      {{#if this.showImage}}
        <img
          class='pretui-logo-img'
          src={{@src}}
          alt={{this.alt}}
          {{on 'load' this.imageLoad}}
          {{on 'error' this.imageError}}
        />
      {{else if this.showInitials}}
        <span
          class='pretui-logo-text'
          role={{this.initialsRole}}
          aria-label={{this.initialsLabel}}
        >{{this.initials}}</span>
      {{else}}
        <span class='pretui-logo-text'>{{@name}}</span>
      {{/if}}
    </span>
    <style scoped>
      @layer PretComponent {
        .pretui-logo {
          /* the height, declared once; every metric below is em of the size */
          --_logo-h: var(--pretui-logo-h, 2em);

          display: inline-flex;
          align-items: center;
          justify-content: center;
          box-sizing: border-box;
          block-size: var(--_logo-h);
          max-inline-size: 100%;
          min-inline-size: 0;
          flex: none;
          font-size: var(--pretui-size-m, var(--text-ui-md, 0.78rem));
          color: var(--foreground);
        }
        .pretui-logo[data-size='xs'] {
          font-size: var(--pretui-size-xs, var(--text-ui-xs, 0.66rem));
        }
        .pretui-logo[data-size='s'] {
          font-size: var(--pretui-size-s, var(--text-ui-sm, 0.72rem));
        }
        .pretui-logo[data-size='l'] {
          font-size: var(--pretui-size-l, var(--text-ui-lg, 0.875rem));
        }
        .pretui-logo[data-size='xl'] {
          font-size: var(--pretui-size-xl, var(--text-ui-xl, 1rem));
        }
        /* a mark is square: the height is also the width */
        .pretui-logo[data-variant='mark'] {
          inline-size: var(--_logo-h);
        }
        .pretui-logo-img {
          display: block;
          block-size: 100%;
          inline-size: auto;
          max-inline-size: 100%;
          object-fit: contain;
        }
        .pretui-logo[data-variant='mark'] .pretui-logo-img {
          inline-size: 100%;
        }
        .pretui-logo-text {
          min-inline-size: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: calc(var(--_logo-h) * 0.5);
          font-weight: 600;
          line-height: 1;
        }
        /* initials sit in a quiet tile, a wordmark is bare text */
        .pretui-logo[data-variant='mark']:not([data-has-image]) {
          border-radius: var(--pretui-logo-radius, calc(var(--radius) / 2));
          background: var(--muted);
          color: var(--foreground);
          outline: 1px solid var(--border);
          outline-offset: -1px;
        }
      }
    </style>
  </template>
}
