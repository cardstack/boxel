// Pretui — TextRotate usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { TextRotate } from './text-rotate';

// ── TextRotate — fresh page (no upstream knob rig) ───────────────────────
class TextRotateUsage extends Component {
  @tracked wordsCsv = 'Da Hong Pao, Silver Needle, Gyokuro, Milk Oolong';
  @tracked interval = 2;
  setWordsCsv = (v: string) => (this.wordsCsv = v);
  setInterval = (v: number | null) => (this.interval = v ?? 2);
  get words(): string[] {
    return this.wordsCsv
      .split(',')
      .map((w) => w.trim())
      .filter((w) => w.length > 0);
  }
  get usage() {
    let words = this.words.map((w) => `'${w}'`).join(' ');
    let bits = [`@words={{array ${words}}}`];
    if (this.interval !== 2) bits.push(`@interval={{${this.interval}}}`);
    return `<TextRotate ${bits.join(' ')} />`;
  }
  <template>
    <FreestyleUsage
      @name='TextRotate'
      @description='Rotating word slot — a clipped one-line window over a vertical reel of words, advanced by a steps() keyframe carousel that wraps seamlessly. Words swap discretely on the interval; reduced motion pins the slot to the first word.'
      @source={{this.usage}}
    >
      <:example>
        <p class='pretui-rotate-demo-line'>
          This season we are curing
          <strong><TextRotate
              @words={{this.words}}
              @interval={{this.interval}}
            /></strong>
          in the Wuyishan rooms.
        </p>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='words'
          @required={{true}}
          @value={{this.wordsCsv}}
          @description='string[] of words to cycle through (comma-separated here for the knob). Fewer than two words renders a static word, no animation. All words are mirrored for assistive tech.'
          @onInput={{this.setWordsCsv}}
        />
        <Args.Number
          @name='interval'
          @defaultValue={{2}}
          @value={{this.interval}}
          @min={{0.5}}
          @max={{6}}
          @step={{0.5}}
          @description='Seconds each word holds the slot before the reel steps.'
          @onInput={{this.setInterval}}
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .pretui-rotate-demo-line {
        margin: 0;
        font-size: var(--text-ui-lg, 15px);
        color: var(--foreground);
      }
    </style>
  </template>
}

export const DEMOS_TEXT_ROTATE: Record<string, unknown> = {
  TextRotate: TextRotateUsage,
};
