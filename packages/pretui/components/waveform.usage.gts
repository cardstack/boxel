// Pretui — Waveform usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Waveform } from './waveform';
import { TONE_WAV } from '../media-examples';
import { Token } from './token';

// ── Waveform ─────────────────────────────────────────────────────────────
class WaveformUsage extends Component {
  src = TONE_WAV;

  @tracked height = 128;
  @tracked barWidth = 3;
  @tracked normalize = true;
  @tracked step = 1;
  @tracked bare = false;
  @tracked lastSeek = '—';

  setHeight = (v: number | null) => (this.height = v ?? 128);
  setBarWidth = (v: number | null) => (this.barWidth = v ?? 3);
  setNormalize = (v: boolean) => (this.normalize = v);
  setStep = (v: number | null) => (this.step = v ?? 1);
  setBare = (v: boolean) => (this.bare = v);
  noteSeek = (seconds: number) => (this.lastSeek = `${seconds.toFixed(2)}s`);

  get usage(): string {
    return [
      '<Waveform',
      '  @src={{this.src}}',
      "  @label='Lot B-1180 — desk note'",
      `  @height={{${this.height}}}`,
      '  @onSeek={{this.noteSeek}}',
      '/>',
    ].join('\n');
  }

  <template>
    <FreestyleUsage
      @name='Waveform'
      @description="wavesurfer.js 7.12.11 (BSD-3-Clause, vendored at ./wavesurfer) decodes the audio and paints the peaks; everything you can reach with a keyboard is Pretui's. Click the wave, then try ← → to seek by a second, Shift for five, PageUp/PageDown for a tenth of the track, Home and End, and Space to play. That is the whole point of the component: wavesurfer gives pointer seeking and nothing else — no tab stop, no arrow keys, no announced position — and every waveform example on the web ships exactly that. Note also what happens when a decode fails: `phase` goes to `error` and the component says so in words, because a headless browser has no real media pipeline and neither does a machine that is offline."
      @source={{this.usage}}
    >
      <:example>
        <Waveform
          @src={{this.src}}
          @label='Lot B-1180 — desk note'
          @height={{this.height}}
          @barWidth={{this.barWidth}}
          @barGap={{2}}
          @normalize={{this.normalize}}
          @step={{this.step}}
          @bare={{this.bare}}
          @onSeek={{this.noteSeek}}
        />
        <p class='dm-readout'>
          <span class='dm-readoutLabel'>@onSeek</span>
          <Token @value={{this.lastSeek}} />
        </p>
      </:example>

      <:api as |Args|>
        <Args.String
          @name='src'
          @value={{this.src}}
          @description='URL of the audio. Passed through untouched — the component never creates or revokes an object URL, so a blob URL stays yours to revoke. Here it is a data:audio/wav URL of a speech-shaped desk note over a twelve-note bed, so this page works on a plane and the peaks look like a voice memo rather than twelve bricks.'
          @hideControls={{true}}
        />
        <Args.String
          @name='label'
          @value='Lot B-1180 — desk note'
          @description="Accessible name of the scrubber. Not optional in practice: a role='slider' with no name is the most common failure in this whole category."
          @hideControls={{true}}
        />
        <Args.Number
          @name='height'
          @value={{this.height}}
          @min={{48}}
          @max={{240}}
          @defaultValue={{128}}
          @description='Drawing height in px. Reserved before the audio lands, so the decode never reflows the page around it.'
          @onInput={{this.setHeight}}
        />
        <Args.Number
          @name='barWidth'
          @value={{this.barWidth}}
          @min={{0}}
          @max={{8}}
          @defaultValue={{3}}
          @description='Bar width in px, or 0 for a continuous waveform.'
          @onInput={{this.setBarWidth}}
        />
        <Args.Bool
          @name='normalize'
          @value={{this.normalize}}
          @defaultValue={{true}}
          @description='Scale peaks to the loudest sample. Off shows true amplitude, which is right when several clips must be compared.'
          @onInput={{this.setNormalize}}
        />
        <Args.Number
          @name='step'
          @value={{this.step}}
          @min={{0.1}}
          @max={{5}}
          @defaultValue={{1}}
          @description='Seconds moved by one arrow press. Shift is five times this; PageUp/PageDown is a tenth of the track.'
          @onInput={{this.setStep}}
        />
        <Args.Bool
          @name='bare'
          @value={{this.bare}}
          @defaultValue={{false}}
          @description='Drop the transport row and the readout, leaving only the wave — for when the surrounding surface already has a play button.'
          @onInput={{this.setBare}}
        />
        <Args.Action
          @name='onSeek'
          @description='(seconds) on every scrub, keyboard or pointer.'
        />
        <Args.Action
          @name='onReady'
          @description='(duration) once the audio has decoded.'
        />
      </:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_WAVEFORM: Record<string, unknown> = {
  Waveform: WaveformUsage,
};
