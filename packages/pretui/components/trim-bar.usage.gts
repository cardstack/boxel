// Pretui — TrimBar usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { TrimBar } from './trim-bar';
import type { TrimRange } from './trim-bar';
import { TONE_WAV } from '../media-examples';
import { Token } from './token';

// ── TrimBar ──────────────────────────────────────────────────────────────
class TrimBarUsage extends Component {
  src = TONE_WAV;

  @tracked minGap = 0.2;
  @tracked step = 0.1;
  @tracked height = 72;
  @tracked range = '—';

  setMinGap = (v: number | null) => (this.minGap = v ?? 0.2);
  setStep = (v: number | null) => (this.step = v ?? 0.1);
  setHeight = (v: number | null) => (this.height = v ?? 72);
  noteChange = (r: TrimRange) =>
    (this.range = `${r.start.toFixed(2)} → ${r.end.toFixed(2)}`);

  get usage(): string {
    return [
      '<TrimBar',
      '  @src={{this.src}}',
      "  @label='Desk note'",
      '  @onChange={{this.noteChange}}',
      '  @onCommit={{this.save}}',
      '/>',
    ].join('\n');
  }

  <template>
    <FreestyleUsage
      @name='TrimBar'
      @description="An in/out selection over any time-based source, on wavesurfer's regions plugin. Tab to the in-point handle and hold ← or →: it moves by a tenth of a second, five times that with Shift, and it cannot cross the out-point — the two handles clamp against each other with a minimum gap rather than swapping. The design decision worth arguing with: the regions plugin's own handles are pointer-only divs inside wavesurfer's shadow root, unreachable by keyboard and unstylable from outside, so the region here is created with drag and resize OFF and the two handles are real focusable elements in the light DOM. One visual, one interaction model, and every trimmer in the wild fails this test."
      @source={{this.usage}}
    >
      <:example>
        <TrimBar
          @src={{this.src}}
          @label='Desk note'
          @minGap={{this.minGap}}
          @step={{this.step}}
          @height={{this.height}}
          @onChange={{this.noteChange}}
        />
        <p class='dm-readout'>
          <span class='dm-readoutLabel'>@onChange</span>
          <Token @value={{this.range}} />
        </p>
      </:example>

      <:api as |Args|>
        <Args.String
          @name='src'
          @value={{this.src}}
          @description='URL of the audio to trim over.'
          @hideControls={{true}}
        />
        <Args.String
          @name='label'
          @value='Desk note'
          @description="Accessible name of the trimmer. Each handle derives its own from it — 'Desk note — in point', 'Desk note — out point' — so a screen reader never has two identically named sliders."
          @hideControls={{true}}
        />
        <Args.Number
          @name='minGap'
          @value={{this.minGap}}
          @min={{0.05}}
          @max={{2}}
          @defaultValue={{0.1}}
          @description='Smallest selection the handles may leave, in seconds. This is what stops a keyboard user from collapsing the range to nothing and then being unable to prise the two handles apart again.'
          @onInput={{this.setMinGap}}
        />
        <Args.Number
          @name='step'
          @value={{this.step}}
          @min={{0.05}}
          @max={{1}}
          @defaultValue={{0.1}}
          @description='Seconds moved by one arrow press.'
          @onInput={{this.setStep}}
        />
        <Args.Number
          @name='height'
          @value={{this.height}}
          @min={{48}}
          @max={{200}}
          @defaultValue={{72}}
          @description='Drawing height in px.'
          @onInput={{this.setHeight}}
        />
        <Args.Action
          @name='onChange'
          @description='({start, end}) continuously while dragging and on every key press.'
        />
        <Args.Action
          @name='onCommit'
          @description='({start, end}) once, when a drag ends or a key settles — the one to persist on.'
        />
      </:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_TRIM_BAR: Record<string, unknown> = {
  TrimBar: TrimBarUsage,
};
