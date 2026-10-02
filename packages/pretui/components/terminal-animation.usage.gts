// Pretui — TerminalAnimation usage page.
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { FreestyleUsage } from './freestyle-usage';
import { Button } from './button';
import { TerminalAnimation } from './terminal-animation';
import type { TerminalLine } from './terminal-animation';

// ── TerminalAnimation ────────────────────────────────────────────────────
const SESSION: TerminalLine[] = [
  { id: 'l1', kind: 'comment', text: '# reprice the Kandy catalogue' },
  { id: 'l2', kind: 'command', text: 'boxel lots pull --auction kandy-2025-11' },
  { id: 'l3', text: 'pulled 18 lots · 4 unsold' },
  { id: 'l4', kind: 'command', text: 'boxel price --rule pricing.gts --mean 2025' },
  { id: 'l5', text: 'lot 104  84.1  −2.8% netted' },
  { id: 'l6', text: 'lot 118  88.6  +9.4% netted' },
  { id: 'l7', kind: 'error', text: 'warn: freight quote for colombo expires in 6 days' },
  { id: 'l8', kind: 'command', text: 'boxel receipt changeset-m3k1' },
  { id: 'l9', text: 'immutable · 2 files · +24 −7' },
];

class TerminalAnimationUsage extends GlimmerComponent {
  @tracked replay = 1;
  @tracked charRate = 26;
  @tracked lineDelay = 0.45;
  @tracked typing = true;

  setCharRate = (rate: number) => (this.charRate = rate);
  setLineDelay = (delay: number) => (this.lineDelay = delay);
  setTyping = (typing: boolean) => (this.typing = typing);
  again = () => (this.replay = this.replay + 1);

  get replayToken(): string {
    return 'run-' + this.replay;
  }

  <template>
    <FreestyleUsage
      @name='TerminalAnimation'
      @description='A command-line session, replayed. The genre’s appeal is the sense of something happening in order; the genre’s implementation problem is that everyone reaches for a timer to get it. There is none here, and no JavaScript timing of any kind: the schedule is computed once, as arithmetic, into two custom properties per line — when it appears, and how long its characters take — so the entrance is one animation-delay and the typing is a width sweep whose steps() count is that line’s own character count. Replay is identity rather than a clock: change @replayToken and the rows are re-created, so their animations start over. Typing and reading are separate rates because they read differently. The animated transcript is aria-hidden with a complete visually-hidden mirror — the StreamingText contract — so a screen reader gets the whole session at once instead of a text that appears to still be arriving, and prefers-reduced-motion lands on the finished transcript, never on a frozen midpoint.'
    >
      <:example>
        <TerminalAnimation
          @lines={{SESSION}}
          @title='sourcing-desk — boxel'
          @charRate={{this.charRate}}
          @lineDelay={{this.lineDelay}}
          @typing={{this.typing}}
          @replayToken={{this.replayToken}}
          @label='Repricing the Kandy catalogue'
        />
        <Button
          @tone='neutral'
          @appearance='outlined'
          @size='s'
          {{on 'click' this.again}}
        >Replay</Button>
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='lines'
          @description='The session in the order it ran: { id, kind?: command | output | error | comment, text, prompt? }. Only command lines type; everything else appears whole, which is what a real terminal does.'
          @value={{SESSION}}
        />
        <Args.Number
          @name='charRate'
          @description='Characters per second while a command types. Separate knob from @lineDelay on purpose — most libraries ship one "speed" and stop.'
          @value={{this.charRate}}
          @onInput={{this.setCharRate}}
          @defaultValue={{26}}
          @min={{6}}
          @max={{80}}
        />
        <Args.Number
          @name='lineDelay'
          @description='Seconds a non-command line holds the stage before the next one starts.'
          @value={{this.lineDelay}}
          @onInput={{this.setLineDelay}}
          @defaultValue={{0.45}}
          @min={{0}}
          @max={{2}}
          @step={{0.05}}
        />
        <Args.Bool
          @name='typing'
          @description='Type commands out character by character. Off, every line simply appears on schedule — which is also what reduced motion collapses to, minus the schedule.'
          @value={{this.typing}}
          @onInput={{this.setTyping}}
          @defaultValue={{true}}
        />
        <Args.String
          @name='replayToken'
          @description='Change it to replay. Every row key includes it, so a new value re-creates the rows and their CSS animations restart — no timer, no imperative restart, no ref.'
          @value={{this.replayToken}}
          @hideControls={{true}}
        />
        <Args.Base
          @name='title / label / startDelay / caret'
          @description='The window title, the accessible name for the transcript, the pause before the first line, and whether the blinking caret trails the last line.'
          @hideControls={{true}}
        />
      </:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_TERMINAL_ANIMATION: Record<string, unknown> = {
  TerminalAnimation: TerminalAnimationUsage,
};
