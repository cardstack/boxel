// Pretui — HoverVideoPlayer usage page.
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { HoverVideoPlayer } from './hover-video-player';

// ── HoverVideoPlayer ─────────────────────────────────────────────────────
// A generated poster rather than a fetched thumbnail, so the frame is filled
// even with no network — and deterministic, because it is a literal.
const POSTER =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180">' +
      '<rect width="320" height="180" fill="#1d2a26"/>' +
      '<rect y="118" width="320" height="62" fill="#00a884" opacity="0.28"/>' +
      '<circle cx="96" cy="118" r="26" fill="#00a884" opacity="0.8"/>' +
      '<rect y="117" width="320" height="1.5" fill="#00a884"/>' +
      '</svg>',
  );

/** Public test clip used by Media Chrome's own documentation; offline, the
 * frame simply keeps its poster and the toggle reports back that playback
 * was refused. */

const CLIP =
  'https://stream.mux.com/A3VXy02VoUinw01pwyomEO3bHnG4P32xzV7u1j1FSzjNg/high.mp4';

const RATIOS = ['16 / 9', '4 / 3', '1 / 1'];

class HoverVideoPlayerUsage extends GlimmerComponent {
  @tracked playing = false;
  @tracked ratio = '16 / 9';
  @tracked playOnIntent = true;

  setRatio = (ratio: string) => (this.ratio = ratio);
  setIntent = (on_: boolean) => (this.playOnIntent = on_);
  changed = (playing: boolean) => (this.playing = playing);

  get statusText(): string {
    return this.playing ? 'previewing' : 'at rest';
  }

  <template>
    <FreestyleUsage
      @name='HoverVideoPlayer'
      @description='A thumbnail that becomes a moving preview when you show interest in it, and stops when you stop. Four things the genre routinely gets wrong, fixed here. Touch: upstream binds mouseenter/mouseleave and is simply dead on a phone, so there is always a real play/pause button — fading in on hover or focus for a fine pointer, permanently visible at 44px on a coarse one. Keyboard: focusin/focusout drive the same path as the pointer, so tabbing to the card previews it. Motion preference: prefers-reduced-motion disables hover- and focus-autoplay outright, because a moving image is exactly what that preference is about — the explicit button still works, since the preference is about ambient motion and not about consent. Layout: @ratio reserves the box before the poster loads, so a grid of these does not reflow as they arrive. Playback follows ONE tracked boolean through a modifier — no timer, no rAF, no listener that outlives the element — and a refused play() is routed back to the component so the control never keeps claiming it is playing.'
    >
      <:example>
        <div class='demo-shelf'>
          <HoverVideoPlayer
            @src={{CLIP}}
            @poster={{POSTER}}
            @label='Repricing the Kandy catalogue'
            @caption='Repricing the Kandy catalogue'
            @ratio={{this.ratio}}
            @playOnIntent={{this.playOnIntent}}
            @onPlayingChange={{this.changed}}
          >
            <:overlay>
              <span class='demo-badge'>0:42</span>
            </:overlay>
          </HoverVideoPlayer>
          <HoverVideoPlayer
            @src={{CLIP}}
            @poster={{POSTER}}
            @label='Drafting the buying note'
            @caption='Drafting the buying note'
            @ratio={{this.ratio}}
            @playOnIntent={{this.playOnIntent}}
          />
        </div>
        <p class='demo-log'>first frame:
          <strong>{{this.statusText}}</strong></p>
        <p class='demo-hint'>Hover it, then Tab to it — both start the
          preview. The button works either way, and is the only path when the
          reader has asked for reduced motion.</p>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='ratio'
          @description='Aspect ratio reserving the frame before anything loads. A caller string, so it goes through the kit-wide cssValue allowlist.'
          @value={{this.ratio}}
          @options={{RATIOS}}
          @onInput={{this.setRatio}}
          @defaultValue='16 / 9'
        />
        <Args.Bool
          @name='playOnIntent'
          @description='Preview on hover and focus (default true). Off, the button is the only path — which is also what reduced motion collapses to.'
          @value={{this.playOnIntent}}
          @onInput={{this.setIntent}}
          @defaultValue={{true}}
        />
        <Args.Base
          @name='src / poster / label / caption'
          @description='The @label arg is REQUIRED: it names the play control and the figure, and an unlabelled video is an unlabelled control. @caption renders under the frame; without one the label is still present, visually hidden.'
          @hideControls={{true}}
        />
        <Args.Base
          @name='muted / loop / rewind / onPlayingChange'
          @description='Muted and looping by default (an unmuted hover preview is hostile), rewinding to the first frame when the preview stops, and reporting every start and stop so a caller can coordinate a shelf where only one plays at a time.'
          @hideControls={{true}}
        />
        <Args.Yield
          @name='overlay'
          @description='Content laid over the frame — a duration chip, a title, a live badge. It is pointer-transparent, so it never steals the hover the preview depends on.'
          @hideControls={{true}}
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .demo-shelf {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
        max-width: 34rem;
      }
      .demo-badge {
        display: inline-flex;
        align-items: center;
        height: 20px;
        padding: 0 7px;
        border-radius: 5px;
        background: color-mix(in oklch, var(--boxel-dark) 60%, transparent);
        color: var(--boxel-light);
        font-family: var(--font-mono);
        font-size: 10.5px;
        font-variant-numeric: tabular-nums;
      }
      .demo-log {
        margin: var(--space-4, 11px) 0 0;
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--muted-foreground);
      }
      .demo-log strong {
        color: var(--foreground);
        font-weight: 600;
      }
      .demo-hint {
        margin: var(--space-3, 7px) 0 0;
        max-width: 62ch;
        font-size: var(--text-ui-sm, 11.5px);
        line-height: 1.6;
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export const DEMOS_HOVER_VIDEO_PLAYER: Record<string, unknown> = {
  HoverVideoPlayer: HoverVideoPlayerUsage,
};
