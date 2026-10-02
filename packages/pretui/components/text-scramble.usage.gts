// Pretui — TextScramble usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { FreestyleUsage } from './freestyle-usage';
import { Button } from './button';
import { TextScramble } from './text-scramble';

// ── TextScramble — fresh page (no upstream knob rig) ─────────────────────
class TextScrambleUsage extends Component {
  @tracked text = 'Batch B-1181 · Wuyishan curing room';
  @tracked duration = 1.2;
  @tracked run = 0;
  setText = (v: string) => (this.text = v);
  setDuration = (v: number | null) => (this.duration = v ?? 1.2);
  replay = () => (this.run = this.run + 1);
  get runKey(): number[] {
    return [this.run];
  }
  get usage() {
    let bits = [`@text='${this.text}'`];
    if (this.duration !== 1.2) bits.push(`@duration={{${this.duration}}}`);
    return `<TextScramble ${bits.join(' ')} />`;
  }
  <template>
    <FreestyleUsage
      @name='TextScramble'
      @description='Letters resolve out of noise, left to right — a CSS approximation of the RAF-driven original: instead of re-randomizing every frame, each character stacks two seeded noise glyphs that hand off and blur out as the real character blurs in, on staggered delays. Same text, same noise, every render.'
      @source={{this.usage}}
    >
      <:example>
        {{#each this.runKey key='@identity' as |run|}}
          <span class='pretui-scramble-demo-line' data-run={{run}}>
            <TextScramble @text={{this.text}} @duration={{this.duration}} />
          </span>
        {{/each}}
        <div class='pretui-demo-replay'>
          <Button
            @size='xs'
            @appearance='outlined'
            {{on 'click' this.replay}}
          >Replay</Button>
        </div>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='text'
          @required={{true}}
          @value={{this.text}}
          @description='The string that resolves out of noise. Full text mirrored sr-only; the glyph stack is aria-hidden.'
          @onInput={{this.setText}}
        />
        <Args.Number
          @name='duration'
          @defaultValue={{0.8}}
          @value={{this.duration}}
          @min={{0.4}}
          @max={{4}}
          @step={{0.2}}
          @description='Total seconds from first noise to last resolved character — half stagger sweep, half per-char resolve window.'
          @onInput={{this.setDuration}}
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .pretui-scramble-demo-line {
        font-family: var(--font-mono);
        font-size: var(--text-ui-lg, 15px);
        color: var(--foreground);
      }
      .pretui-demo-replay {
        margin-top: 12px;
      }
    </style>
  </template>
}

export const DEMOS_TEXT_SCRAMBLE: Record<string, unknown> = {
  TextScramble: TextScrambleUsage,
};
