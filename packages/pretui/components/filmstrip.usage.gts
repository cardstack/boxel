// Pretui — Filmstrip usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Filmstrip, evenFrames } from './filmstrip';
import type { FilmstripFrame } from './filmstrip';
import {
  TONE_SECONDS,
  platePoster,
} from '../media-examples';
import { Token } from './token';

// ── Filmstrip ────────────────────────────────────────────────────────────
const STRIP_FRAMES: FilmstripFrame[] = evenFrames(
  TONE_SECONDS,
  12,
  (_time, index) => platePoster(`reel-shot-${index}`, '16 / 9'),
  (_time, index) => `Shot ${index + 1}`,
);

class FilmstripUsage extends Component {
  frames = STRIP_FRAMES;
  duration = TONE_SECONDS;

  @tracked current = 0;
  @tracked thumbWidth = 96;
  @tracked showTimes = true;

  setThumbWidth = (v: number | null) => (this.thumbWidth = v ?? 96);
  setShowTimes = (v: boolean) => (this.showTimes = v);
  scrub = (seconds: number) => (this.current = seconds);

  get readout(): string {
    return `${this.current.toFixed(2)}s`;
  }
  get usage(): string {
    return [
      '<Filmstrip',
      '  @frames={{this.frames}}',
      `  @duration={{${this.duration}}}`,
      '  @current={{this.current}}',
      "  @label='Estate reel'",
      '  @onScrub={{this.scrub}}',
      '/>',
    ].join('\n');
  }

  <template>
    <FreestyleUsage
      @name='Filmstrip'
      @description="A thumbnail scrub strip over a time axis, with no library behind it — a filmstrip is thumbnails, a time axis and a keyboard contract, and none of those is worth 40 KB of somebody else's opinion. The decision to notice is that the strip is ONE tab stop, not twelve: a row of focusable thumbnails takes twelve presses of Tab to get past, which is why every carousel that ships that way is unusable. Tab once, then arrows move frame to frame, Shift jumps a page, Home and End go to the ends, and the active frame scrolls itself into view — smoothly, unless the reader asked for reduced motion, in which case it lands on the end state. A frame's identity is its TIME, not its index, so the same component is a chapter rail when the frames are irregular."
      @source={{this.usage}}
    >
      <:example>
        <Filmstrip
          @frames={{this.frames}}
          @duration={{this.duration}}
          @current={{this.current}}
          @label='Estate reel — scrub'
          @thumbWidth={{this.thumbWidth}}
          @showTimes={{this.showTimes}}
          @onScrub={{this.scrub}}
        />
        <p class='dm-readout'>
          <span class='dm-readoutLabel'>@onScrub</span>
          <Token @value={{this.readout}} />
        </p>
      </:example>

      <:api as |Args|>
        <Args.Object
          @name='frames'
          @value={{this.frames}}
          @description='{time, src, label?}[] in time order. Build the even case with evenFrames(duration, count, src, label) — a helper rather than a loop every caller rewrites, and deterministic, so the same strip survives a reindex.'
        />
        <Args.Number
          @name='duration'
          @value={{this.duration}}
          @description="Length of the time axis. Defaults to the last frame's time, which is right for a chapter rail and wrong for a scrub strip, so pass it when you know it."
          @hideControls={{true}}
        />
        <Args.Number
          @name='current'
          @value={{this.current}}
          @description='Playhead position in seconds. Omit it and the strip keeps its own — the usual controlled/uncontrolled pair.'
          @hideControls={{true}}
        />
        <Args.Number
          @name='thumbWidth'
          @value={{this.thumbWidth}}
          @min={{48}}
          @max={{200}}
          @defaultValue={{96}}
          @description='Tile width in px. The height comes from @ratio, reserved before the thumbnails land so the row does not shuffle sideways under the pointer as they arrive.'
          @onInput={{this.setThumbWidth}}
        />
        <Args.Bool
          @name='showTimes'
          @value={{this.showTimes}}
          @defaultValue={{true}}
          @description='Print each frame’s time beneath it. The current frame also carries a filled bar glyph and a weight change, so it survives greyscale.'
          @onInput={{this.setShowTimes}}
        />
        <Args.Action
          @name='onScrub'
          @description='(seconds, frame) from a click or a key press — one setter, two input paths.'
        />
      </:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_FILMSTRIP: Record<string, unknown> = {
  Filmstrip: FilmstripUsage,
};
