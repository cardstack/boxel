// Pretui — TextEffects usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { FreestyleUsage } from './freestyle-usage';
import { Button } from './button';
import { TextEffects } from './text-effects';
import type { TextEffectOrder, TextEffectPer, TextEffectPreset } from './text-effects';

// ── TextEffects ─────────────────────────────────────────────────────────
class TextEffectsUsage extends Component {
  @tracked text =
    'The spring lots have cleared customs and are on the water.';
  @tracked effect: TextEffectPreset = 'blur';
  @tracked per: TextEffectPer = 'word';
  @tracked order: TextEffectOrder = 'forward';
  @tracked stagger = 0.05;
  @tracked duration = 0.6;
  @tracked delay = 0;
  @tracked distance = 14;
  @tracked blur = 8;
  @tracked run = 0;

  setText = (v: string) => (this.text = v);
  setEffect = (v: string) => (this.effect = v as TextEffectPreset);
  setPer = (v: string) => (this.per = v as TextEffectPer);
  setOrder = (v: string) => (this.order = v as TextEffectOrder);
  setStagger = (v: number | null) => (this.stagger = v ?? 0.05);
  setDuration = (v: number | null) => (this.duration = v ?? 0.6);
  setDelay = (v: number | null) => (this.delay = v ?? 0);
  setDistance = (v: number | null) => (this.distance = v ?? 14);
  setBlur = (v: number | null) => (this.blur = v ?? 8);
  replay = () => (this.run = this.run + 1);
  get runKey(): number[] {
    return [this.run];
  }

  get effectOptions(): string[] {
    return ['fade', 'blur', 'rise', 'fall', 'scale', 'slide', 'unmask'];
  }
  get perOptions(): string[] {
    return ['char', 'word', 'line'];
  }
  get orderOptions(): string[] {
    return ['forward', 'reverse', 'centre', 'edges', 'shuffle'];
  }

  get usage(): string {
    return (
      '<TextEffects @text=' + "'" + this.text + "'" +
      " @effect='" + this.effect + "'" +
      " @per='" + this.per + "'" +
      " @order='" + this.order + "'" +
      ' @stagger={{' + this.stagger + '}} @duration={{' + this.duration + '}} />'
    );
  }

  <template>
    <FreestyleUsage
      @name='TextEffects'
      @description='One entrance choreography with a preset knob — the consolidation of what upstream kits ship as a dozen near-identical components. Law 5 reading: it encodes ARRIVAL, so it belongs on an async result, a revealed panel or a streamed answer, and not on page furniture. Every schedule is a precomputed animation-delay per unit; there is no frame loop and no timer. With animation disabled the full text is simply there, because every base style IS the end state.'
      @source={{this.usage}}
    >
      <:example>
        <div class='pretui-fx-demo'>
          {{#each this.runKey key='@identity' as |run|}}
            <p class='pretui-fx-demo-line'>
              <TextEffects
                @text={{this.text}}
                @effect={{this.effect}}
                @per={{this.per}}
                @order={{this.order}}
                @stagger={{this.stagger}}
                @duration={{this.duration}}
                @delay={{this.delay}}
                @distance={{this.distance}}
                @blur={{this.blur}}
                data-run={{run}}
              />
            </p>
          {{/each}}
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
          @description='The string to reveal. Mirrored in full in an sr-only span, so the chopped-up animated copy stays aria-hidden — a per-glyph stack is not text to a screen reader.'
          @onInput={{this.setText}}
        />
        <Args.String
          @name='effect'
          @value={{this.effect}}
          @defaultValue='fade'
          @options={{this.effectOptions}}
          @description='Which entrance. unmask uncovers an already-opaque glyph rather than fading it in, so the text reads as revealed by something.'
          @onInput={{this.setEffect}}
        />
        <Args.String
          @name='per'
          @value={{this.per}}
          @defaultValue='word'
          @options={{this.perOptions}}
          @description='The unit that gets its own animation. word is the default because a per-character stagger on a paragraph reads as a novelty and takes forever.'
          @onInput={{this.setPer}}
        />
        <Args.String
          @name='order'
          @value={{this.order}}
          @defaultValue='forward'
          @options={{this.orderOptions}}
          @description='The sequence the stagger runs in. shuffle is SEEDED from the text, not random — random is forbidden in a realm and a seeded shuffle screenshots reproducibly anyway.'
          @onInput={{this.setOrder}}
        />
        <Args.Number
          @name='stagger'
          @value={{this.stagger}}
          @defaultValue={{0.04}}
          @min={{0}}
          @max={{0.3}}
          @step={{0.01}}
          @description='Seconds between one unit starting and the next.'
          @onInput={{this.setStagger}}
        />
        <Args.Number
          @name='duration'
          @value={{this.duration}}
          @defaultValue={{0.5}}
          @min={{0.1}}
          @max={{2}}
          @step={{0.1}}
          @description='Seconds one unit takes. Separate from stagger because they read differently — Law 7: every knob separately settable.'
          @onInput={{this.setDuration}}
        />
        <Args.Number
          @name='delay'
          @value={{this.delay}}
          @defaultValue={{0}}
          @min={{0}}
          @max={{2}}
          @step={{0.1}}
          @description='Seconds before the first unit moves.'
          @onInput={{this.setDelay}}
        />
        <Args.Number
          @name='distance'
          @value={{this.distance}}
          @defaultValue={{14}}
          @min={{0}}
          @max={{60}}
          @step={{2}}
          @description='Travel in px for rise, fall and slide.'
          @onInput={{this.setDistance}}
        />
        <Args.Number
          @name='blur'
          @value={{this.blur}}
          @defaultValue={{8}}
          @min={{0}}
          @max={{24}}
          @step={{1}}
          @description='Blur radius in px for the blur preset.'
          @onInput={{this.setBlur}}
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .pretui-fx-demo {
        display: grid;
        gap: var(--space-3, 8px);
        justify-items: start;
      }
      .pretui-fx-demo-line {
        margin: 0;
        max-width: 44ch;
        font-size: var(--text-ui-lg, 15px);
        line-height: 1.5;
        color: var(--foreground);
      }
    </style>
  </template>
}

export const DEMOS_TEXT_EFFECTS: Record<string, unknown> = {
  TextEffects: TextEffectsUsage,
};
