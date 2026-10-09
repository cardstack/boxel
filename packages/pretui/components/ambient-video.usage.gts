// Pretui — AmbientVideo usage page.
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { AmbientVideo, type AmbientVideoState } from './ambient-video';
import { SAMPLE_VIDEO_POSTER, SAMPLE_VIDEO_SRC } from '../media-examples';

// ── AmbientVideo ─────────────────────────────────────────────────────────
// The kit's one networked clip; offline, the frame keeps its poster and
// lands on `error` with a centred play button that retries.

const RATIOS = ['16 / 9', '4 / 3', '1 / 1', '21 / 9'];
const FITS = ['cover', 'contain'];
const LOADS = ['visible', 'eager'];

class AmbientVideoUsage extends GlimmerComponent {
  @tracked state: AmbientVideoState = 'idle';
  @tracked ratio = '16 / 9';
  @tracked fit: 'cover' | 'contain' = 'cover';
  @tracked load: 'visible' | 'eager' = 'visible';
  @tracked loop = true;
  @tracked label = 'The tea-trade reel';

  setRatio = (v: string) => (this.ratio = v);
  setFit = (v: string) => (this.fit = v === 'contain' ? 'contain' : 'cover');
  setLoad = (v: string) => (this.load = v === 'eager' ? 'eager' : 'visible');
  setLoop = (v: boolean) => (this.loop = v);
  setLabel = (v: string) => (this.label = v);
  changed = (state: AmbientVideoState) => (this.state = state);

  <template>
    <FreestyleUsage
      @name='AmbientVideo'
      @description='A muted, inline, looping video that starts on its own while it is on screen — the hero loop, the demo set into an article. Five things the one-tag version gets wrong, done here instead: it fetches nothing until the frame is near the viewport; it plays only while visible and while the tab is; a refused autoplay (Low Power Mode, Never Auto-Play) is detected from the NotAllowedError verdict and shows @fallback or a centred play button, while an AbortError is correctly ignored; there is always a named pause control (WCAG 2.2.2), a pause the reader asked for survives scrolling, and reduced motion or Save-Data start it paused; and under a controlling service worker — where Safari cannot play ranged media — the clip plays from a blob: URL.'
    >
      <:example>
        <div class='demo-frame'>
          <AmbientVideo
            @src={{SAMPLE_VIDEO_SRC}}
            @poster={{SAMPLE_VIDEO_POSTER}}
            @label={{this.label}}
            @ratio={{this.ratio}}
            @fit={{this.fit}}
            @load={{this.load}}
            @loop={{this.loop}}
            @onStateChange={{this.changed}}
          >
            <:overlay>
              <span class='demo-chip'>Ambient</span>
            </:overlay>
          </AmbientVideo>
        </div>
        <p class='demo-log'>state: <strong>{{this.state}}</strong></p>
        <p class='demo-hint'>Scroll it out of view and back: it pauses and
          resumes. Press pause, then scroll: it stays paused. Turn on reduced
          motion in your OS: it rests on the poster until pressed.</p>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='label'
          @description='What the video shows. Given, the video is informative: the figure is named by it and the control reads "Pause {label}". Omitted, it is decorative and the control reads "Pause background video".'
          @value={{this.label}}
          @onInput={{this.setLabel}}
        />
        <Args.String
          @name='ratio'
          @description='Aspect ratio reserving the box before anything loads.'
          @value={{this.ratio}}
          @options={{RATIOS}}
          @onInput={{this.setRatio}}
          @defaultValue='16 / 9'
        />
        <Args.String
          @name='fit'
          @description='cover (default) fills the frame; contain letterboxes.'
          @value={{this.fit}}
          @options={{FITS}}
          @onInput={{this.setFit}}
          @defaultValue='cover'
        />
        <Args.String
          @name='load'
          @description='visible (default) attaches the source within @loadMargin of the viewport; eager attaches it at once, for a hero above the fold.'
          @value={{this.load}}
          @options={{LOADS}}
          @onInput={{this.setLoad}}
          @defaultValue='visible'
        />
        <Args.Bool
          @name='loop'
          @description='Loop the clip (default true).'
          @value={{this.loop}}
          @onInput={{this.setLoop}}
          @defaultValue={{true}}
        />
        <Args.Base
          @name='src / poster / fallback'
          @description='The src is the clip (muted, so it should carry no audio worth hearing). The poster is the still before the first frame and while paused. The fallback is an animated image (WebP, GIF) shown when autoplay is refused; without it, a refused autoplay shows the poster and a centred play button.'
          @hideControls={{true}}
        />
        <Args.Base
          @name='loadMargin / threshold / respectReducedMotion / respectSaveData'
          @description="How far ahead to start loading (default '800px 0px'), the visible fraction at which it plays (default 0.25), and whether reduced motion and Save-Data start it paused (both default true)."
          @hideControls={{true}}
        />
        <Args.Action
          @name='onStateChange'
          @description='(state) on every change: idle, loading, playing, paused (the page’s pause), user-paused (the reader’s), reduced-motion, save-data, blocked, fallback, error. The same value is on the figure as data-state.'
        />
        <Args.Yield
          @name='overlay'
          @description='Content laid over the frame — a title, a credit. Pointer-transparent.'
          @hideControls={{true}}
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .demo-frame {
        max-width: 36rem;
      }
      .demo-chip {
        display: inline-flex;
        align-items: center;
        padding: 2px 8px;
        border-radius: 999px;
        background: rgb(12 12 14 / 0.56);
        color: #fff;
        font-size: var(--text-ui-xs, 10.5px);
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }
      .demo-log,
      .demo-hint {
        margin: 10px 0 0;
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export const DEMOS_AMBIENT_VIDEO: Record<string, unknown> = {
  AmbientVideo: AmbientVideoUsage,
};
