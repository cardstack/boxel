// Pretui — Avatar: an identity disc with a name-derived hue and initials.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { cssDeclaration, cssStyleFrom } from '../pretui-css';
import { statusHue } from '../internal/ink';

export interface AvatarSignature {
  Args: { name: string; src?: string; hue?: string; size?: number };
  Element: HTMLSpanElement;
}

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
  get style() {
    let size = Number(this.args.size ?? 24) || 24;
    let hue = this.args.hue ?? statusHue(this.args.name ?? '');
    // Sizes are numbers we formatted ourselves; the hue is a caller string
    // and is validated (see hueStyle above).
    return cssStyleFrom([
      `width: ${size}px`,
      `height: ${size}px`,
      `font-size: ${Math.round(size * 0.42)}px`,
      cssDeclaration('--pretui-chip-hue', hue),
    ]);
  }
  <template>
    <span class='pretui-avatar' title={{@name}} aria-label={{@name}} style={{this.style}} data-test-pretui-avatar ...attributes>
      {{#if this.showImage}}<img src={{@src}} alt={{@name}} {{on 'error' this.imageError}} />{{else}}{{this.initials}}{{/if}}
    </span>
    <style scoped>
      .pretui-avatar {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        font-family: var(--font-mono);
        font-weight: 600;
        background: color-mix(in oklch, var(--pretui-chip-hue, var(--primary)) 16%, var(--card));
        color: color-mix(in oklch, var(--foreground) 20%, var(--pretui-chip-hue, var(--primary)));
        box-shadow: 0 0 0 1px color-mix(in oklch, var(--pretui-chip-hue, var(--primary)) 28%, var(--border));
        overflow: hidden;
        flex: none;
      }
      .pretui-avatar img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
    </style>
  </template>
}
