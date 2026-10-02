// Pretui — TextMorph usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { FreestyleUsage } from './freestyle-usage';
import { Button } from './button';
import { TextMorph } from './text-morph';

// ── TextMorph ───────────────────────────────────────────────────────────
const MORPH_LOTS = [
  'Da Hong Pao',
  'Da Yu Ling',
  'Silver Needle',
  'Jasmine Dragon Pearls',
  'Aged Shou Pu-erh',
];

class TextMorphUsage extends Component {
  @tracked step = 0;
  @tracked duration = 0.32;
  @tracked stagger = 0.012;

  setDuration = (v: number | null) => (this.duration = v ?? 0.32);
  setStagger = (v: number | null) => (this.stagger = v ?? 0.012);

  get current(): string {
    return MORPH_LOTS[this.step % MORPH_LOTS.length] as string;
  }
  advance = () => (this.step = this.step + 1);

  get usage(): string {
    return (
      '<TextMorph @text={{this.lotName}} @duration={{' +
      this.duration +
      '}} @stagger={{' +
      this.stagger +
      '}} />'
    );
  }

  <template>
    <FreestyleUsage
      @name='TextMorph'
      @description='One string changing INTO another, with the shared letters kept. A longest-common-subsequence diff decides which glyphs survive, so Da Hong Pao to Da Yu Ling visibly keeps its Da and its o — the reader sees the two strings are relatives. This is the clearest Law 5 case in the kit: the transition IS the information, and the cross-fade every other library ships throws it away. Departing glyphs collapse their font-size, which takes their advance width with them exactly, so the survivors close the gap with nothing measured.'
      @source={{this.usage}}
    >
      <:example>
        <div class='pretui-morph-demo'>
          <p class='pretui-morph-demo-line'>
            <TextMorph
              @text={{this.current}}
              @duration={{this.duration}}
              @stagger={{this.stagger}}
            />
          </p>
          <Button
            @size='xs'
            @appearance='outlined'
            {{on 'click' this.advance}}
          >Next lot</Button>
        </div>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='text'
          @required={{true}}
          @value={{this.current}}
          @hideControls={{true}}
          @description='The CURRENT string. Changing it is what triggers a morph — the component remembers what it was showing, so a caller never has to pass both halves.'
        />
        <Args.String
          @name='from'
          @description='The string being morphed FROM, stated explicitly. Supply it and the render is a pure function of the arguments with no memory involved.'
        />
        <Args.Number
          @name='duration'
          @value={{this.duration}}
          @defaultValue={{0.32}}
          @min={{0.1}}
          @max={{1.5}}
          @step={{0.02}}
          @description='Seconds one glyph takes to leave or arrive. Arrivals wait for the departures, so the line never overshoots its final width.'
          @onInput={{this.setDuration}}
        />
        <Args.Number
          @name='stagger'
          @value={{this.stagger}}
          @defaultValue={{0.012}}
          @min={{0}}
          @max={{0.12}}
          @step={{0.004}}
          @description='Seconds between consecutive glyphs. Set it to 0 for a single simultaneous swap.'
          @onInput={{this.setStagger}}
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .pretui-morph-demo {
        display: grid;
        gap: var(--space-3, 8px);
        justify-items: start;
      }
      .pretui-morph-demo-line {
        margin: 0;
        min-height: 1.6em;
        font-size: var(--text-heading, 19px);
        font-weight: var(--weight-heading, 700);
        letter-spacing: var(--track-heading, -0.02em);
        color: var(--foreground);
      }
    </style>
  </template>
}

export const DEMOS_TEXT_MORPH: Record<string, unknown> = {
  TextMorph: TextMorphUsage,
};
