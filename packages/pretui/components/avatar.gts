// Pretui — Avatar: an identity disc with a name-derived hue and initials.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { cssDeclaration, cssStyleFrom, cssValue } from '../pretui-css';
import { statusHue } from '../internal/ink';
import { keepStyle, type KeptProperty } from '../internal/keep-style';

export interface AvatarSignature {
  Args: {
    name: string;
    src?: string;
    hue?: string;
    /** diameter in px at a 16px root, written as rem; omitted, 24 (1.5rem) */
    size?: number;
  };
  Element: HTMLSpanElement;
}

const SIZE_PROPERTY = '--pretui-avatar-size';
const HUE_PROPERTY = '--pretui-chip-hue';

export class Avatar extends Component<AvatarSignature> {
  @tracked failedSrc: string | undefined;

  get initials() {
    return (this.args.name ?? '')
      .split(/\s+/)
      .map((w) => w[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
  }
  get showImage(): boolean {
    return Boolean(this.args.src) && this.args.src !== this.failedSrc;
  }
  imageError = () => {
    this.failedSrc = this.args.src;
  };
  // The diameter as rem, from a px figure at a 16px root. Omitted, nothing is
  // written and the stylesheet's 1.5rem (or a caller's --pretui-avatar-size,
  // from a class, a container query or an ancestor) applies.
  get size(): string | undefined {
    let size = Number(this.args.size) || undefined;
    return size === undefined ? undefined : `${size / 16}rem`;
  }
  get explicitHue(): string | undefined {
    return this.args.hue ?? undefined;
  }
  // An explicit @hue is validated; without one the hue is the name's hash.
  get hue(): string | undefined {
    let hue = this.explicitHue;
    return hue === undefined ? statusHue(this.args.name ?? '') : cssValue(hue);
  }
  get style() {
    return cssStyleFrom([
      cssDeclaration(SIZE_PROPERTY, this.size),
      cssDeclaration(HUE_PROPERTY, this.hue),
    ]);
  }
  // The same properties again, kept on top of a caller's `style`. @hue and
  // @size win over the caller's; the name-derived hue only fills in when the
  // caller's style sets no hue of its own.
  get keptStyle(): KeptProperty[] {
    return [
      { property: SIZE_PROPERTY, value: this.size, strength: 'arg' },
      {
        property: HUE_PROPERTY,
        value: this.hue,
        strength: this.explicitHue === undefined ? 'default' : 'arg',
      },
    ];
  }
  <template>
    <span
      class='pretui-avatar'
      title={{@name}}
      role={{unless this.showImage 'img'}}
      aria-label={{unless this.showImage @name}}
      data-has-image={{if this.showImage 'true'}}
      style={{this.style}}
      {{keepStyle this.keptStyle}}
      data-test-pretui-avatar
      ...attributes
    >
      {{#if this.showImage}}<img src={{@src}} alt={{@name}} {{on 'error' this.imageError}} />{{else}}{{this.initials}}{{/if}}
    </span>
    <style scoped>
      @layer PretComponent {
        .pretui-avatar {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          /* the default diameter, declared once */
          --_avatar-size: var(--pretui-avatar-size, 1.5rem);
          --_avatar-hue: var(--pretui-chip-hue, var(--primary));
          width: var(--_avatar-size);
          height: var(--_avatar-size);
          /* 0.42 of the diameter; rounded to the whole pixel below where
             round() is supported */
          font-size: calc(var(--_avatar-size) * 0.42);
          border-radius: 50%;
          font-family: var(--font-mono);
          font-weight: 600;
          background-color: color-mix(in oklch, var(--_avatar-hue) 16%, var(--card));
          color: var(--foreground);
          box-shadow: 0 0 0 1px color-mix(in oklch, var(--_avatar-hue) 28%, var(--border));
          overflow: hidden;
          flex: none;
        }
        /* Gated rather than declared after the calc() fallback: a value
           containing var() is accepted at parse time, so an engine without
           round() would keep it, fail at computed-value time, and inherit
           the parent's font size instead of using the fallback. */
        @supports (font-size: round(1px, 1px)) {
          .pretui-avatar {
            font-size: round(calc(var(--_avatar-size) * 0.42), 1px);
          }
        }
        /* A photo gets a neutral ring: the name's hue carries no meaning once
           the photo shows. The ring sits on the root, whose overflow: hidden
           circle would clip an outline on the square img. */
        .pretui-avatar[data-has-image] {
          box-shadow: 0 0 0 1px color-mix(in oklch, var(--foreground) 10%, transparent);
        }
        .pretui-avatar img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
      }
    </style>
  </template>
}
