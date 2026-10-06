// Pretui — AnimatedImage usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { AnimatedImage } from './animated-image';

// ── AnimatedImage ────────────────────────────────────────────────────────
function animatedSvg(): string {
  let svg = [
    "<svg xmlns='http://www.w3.org/2000/svg' width='320' height='200' viewBox='0 0 320 200'>",
    "<rect width='320' height='200' fill='#17161c'/>",
    '<style>',
    '@keyframes rise { 0% { transform: scaleY(0.15) } 50% { transform: scaleY(1) } 100% { transform: scaleY(0.15) } }',
    '.b { transform-origin: 0 160px; animation: rise 1.6s ease-in-out infinite }',
    '.b2 { animation-delay: -0.2s } .b3 { animation-delay: -0.4s }',
    '.b4 { animation-delay: -0.6s } .b5 { animation-delay: -0.8s }',
    '</style>',
    "<g fill='#10b981'>",
    "<rect class='b b1' x='40' y='40' width='34' height='120'/>",
    "<rect class='b b2' x='92' y='40' width='34' height='120'/>",
    "<rect class='b b3' x='144' y='40' width='34' height='120'/>",
    "<rect class='b b4' x='196' y='40' width='34' height='120'/>",
    "<rect class='b b5' x='248' y='40' width='34' height='120'/>",
    '</g>',
    "<rect x='40' y='160' width='242' height='2' fill='#6b7280'/>",
    '</svg>',
  ].join('');
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

const ANIMATED_SRC = animatedSvg();

export class AnimatedImageUsage extends Component {
  @tracked playing = true;
  @tracked hideControl = false;

  src = ANIMATED_SRC;

  setPlaying = (v: boolean) => {
    this.playing = v;
  };
  setHideControl = (v: boolean) => {
    this.hideControl = v;
  };
  onPlayingChange = (v: boolean) => {
    this.playing = v;
  };

  get usage(): string {
    return [
      '<AnimatedImage',
      '  @src={{this.loopUrl}}',
      "  @alt='The kettle coming to boil'",
      '/>',
    ].join('\n');
  }

  <template>
    <FreestyleUsage
      @name='AnimatedImage'
      @description='An animated image that can actually be stopped. Pausing paints the current frame onto a canvas and lays it over the image, so resuming is frame-accurate rather than a rewind — browsers expose no pause API, and both common workarounds (reassigning src, display:none) lose the reader’s place. It starts PAUSED when the reader has asked for reduced motion, which is the WCAG 2.2.2 behaviour the upstream component skips.'
      @source={{this.usage}}
    >
      <:example>
        <div class='animated-stage'>
          <AnimatedImage
            @src={{this.src}}
            @alt='Five bars rising and falling in sequence'
            @playing={{this.playing}}
            @onPlayingChange={{this.onPlayingChange}}
            @hideControl={{this.hideControl}}
          />
          <p class='animated-note'>Pause and resume: the bars pick up exactly
            where the eye left them. The fixture is a self-contained animated
            SVG — no network, no licence, and byte-identical on every
            machine.</p>
        </div>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='src'
          @description='Source of the animated image — GIF, animated WEBP, animated PNG, or an animated SVG.'
        />
        <Args.String
          @name='alt'
          @description='Alternative text. Required, and required to describe the CONTENT — “an animation of…” is what the control beside it already says.'
        />
        <Args.Bool
          @name='playing'
          @description='Controlled playback. Omit for uncontrolled; the uncontrolled default is false under prefers-reduced-motion and true otherwise.'
          @defaultValue={{true}}
          @value={{this.playing}}
          @onInput={{this.setPlaying}}
        />
        <Args.Action
          @name='onPlayingChange'
          @description='Fires with the next playback state on every change.'
        />
        <Args.Bool
          @name='hideControl'
          @description='Hide the built-in control. Only do this when the caller supplies its own — an animation with no pause fails WCAG 2.2.2.'
          @defaultValue={{false}}
          @value={{this.hideControl}}
          @onInput={{this.setHideControl}}
        />
      </:api>
    </FreestyleUsage>

    <style scoped>
      .animated-stage {
        display: grid;
        gap: var(--space-3, 8px);
        justify-items: start;
      }
      .animated-note {
        margin: 0;
        max-inline-size: 52ch;
        font-size: var(--text-ui-xs, 11px);
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export const DEMOS_ANIMATED_IMAGE: Record<string, unknown> = {
  AnimatedImage: AnimatedImageUsage,
};
