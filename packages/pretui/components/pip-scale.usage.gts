// Pretui — PipScale usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { PipScale } from './pip-scale';
import type { PipMode } from './pip-scale';
import { Slider } from './slider';

const MODES: string[] = ['none', 'ticks', 'labels'];

const money = (v: number) => '$' + String(v);
const decade = (v: number) => String(v) + 's';

// ── PipScale, standalone ─────────────────────────────────────────────────
class PipScaleUsage extends Component {
  modeOptions = MODES;
  @tracked mode = 'ticks';
  @tracked ends = 'labels';
  @tracked targetPips = 20;
  @tracked maxLabels = 6;
  @tracked picked = 50;

  setMode = (v: string) => (this.mode = v);
  setEnds = (v: string) => (this.ends = v);
  setTargetPips = (v: number) => (this.targetPips = v);
  setMaxLabels = (v: number) => (this.maxLabels = v);
  pick = (v: number) => (this.picked = v);

  get modeVal() {
    return this.mode as PipMode;
  }
  get endsVal() {
    return this.ends as PipMode;
  }
  get values() {
    return [this.picked];
  }
  get usage() {
    return [
      '<PipScale',
      "  @min={{0}} @max={{100}} @step={{1}}",
      "  @pips='" + this.mode + "' @first='" + this.ends + "' @last='" + this.ends + "'",
      '  @targetPips={{' + String(this.targetPips) + '}}',
      '  @maxLabels={{' + String(this.maxLabels) + '}}',
      '  @values={{this.values}} @span=\'min\'',
      '  @label=\'Pick a value\' @onPick={{this.pick}}',
      '/>',
    ].join('\n');
  }

  <template>
    <FreestyleUsage
      @name='PipScale'
      @description='A labelled value scale. Pips are drawn at the values they name, they light up as a selection sweeps across them, and each one is a real button in a roving-tabindex group — one tab stop for the whole scale, arrows to move, Enter or Space to pick. That last part is the capability a slider thumb does not have: it jumps straight to a named stop rather than arrowing through every step to reach it. Drop the onPick callback and the scale becomes pure decoration, with no buttons and no place in the tab order.'
      @source={{this.usage}}
    >
      <:example>
        <PipScale
          @min={{0}}
          @max={{100}}
          @step={{1}}
          @pips={{this.modeVal}}
          @first={{this.endsVal}}
          @last={{this.endsVal}}
          @targetPips={{this.targetPips}}
          @maxLabels={{this.maxLabels}}
          @values={{this.values}}
          @span='min'
          @label='Pick a value'
          @onPick={{this.pick}}
        />
      </:example>
      <:api as |Args|>
        <Args.String
          @name='pips'
          @optional={{true}}
          @defaultValue='ticks'
          @value={{this.mode}}
          @options={{this.modeOptions}}
          @description='Base mode for every pip. The first, rest and last args each override it for their own position, which is the labelling grammar the affordance is built on.'
          @onInput={{this.setMode}}
        />
        <Args.String
          @name='first'
          @optional={{true}}
          @value={{this.ends}}
          @options={{this.modeOptions}}
          @description='Mode for the first end pip; the last arg is its twin. Setting these to labels and leaving the base on ticks gives the most common shape by far — a dense hairline scale anchored by two numbers.'
          @onInput={{this.setEnds}}
        />
        <Args.Number
          @name='targetPips'
          @optional={{true}}
          @defaultValue={{20}}
          @value={{this.targetPips}}
          @description='Roughly how many pips to derive when pipStep is omitted. The ratio is taken over the STEP count, not the numeric width of the rail, so it holds for any step size.'
          @onInput={{this.setTargetPips}}
        />
        <Args.Number
          @name='maxLabels'
          @optional={{true}}
          @defaultValue={{8}}
          @value={{this.maxLabels}}
          @description='Ceiling on pips that carry a label. Tick density and label density are separate governors, which is what stops twenty labels overlapping on a narrow rail.'
          @onInput={{this.setMaxLabels}}
        />
        <Args.Number
          @name='pipStep'
          @optional={{true}}
          @description='Steps per pip, set by hand. Still passes through the maxPips ceiling, so a hand-set 1 on a ten-thousand-step rail cannot draw ten thousand elements.'
        />
        <Args.Number
          @name='maxPips'
          @optional={{true}}
          @defaultValue={{120}}
          @description='Hard ceiling on pips drawn; the span doubles until the count fits.'
        />
        <Args.Array
          @name='values'
          @value={{this.values}}
          @description='The selected value, or the lower and upper pair of a range. A pip that sits on one of them reports itself as selected.'
        />
        <Args.String
          @name='span'
          @optional={{true}}
          @description="Paint the pips between the two values (true), below a single value (min), or above it (max). This is what makes a range read as a band across a scale rather than as two unrelated numbers."
        />
        <Args.Array
          @name='limits'
          @optional={{true}}
          @description='The selectable window. Pips outside it are still drawn, so the reader sees the whole scale, but they draw quiet and take no clicks.'
        />
        <Args.Action
          @name='formatValue'
          @optional={{true}}
          @description='Renders the value a reader sees and hears. Pairs with prefix and suffix, which wrap it on both the visible label and the accessible name so the two never diverge.'
        />
        <Args.Action
          @name='onPick'
          @optional={{true}}
          @description='Fires with the picked value. Omitting it is the documented way to get a decorative scale.'
        />
        <Args.String
          @name='label'
          @optional={{true}}
          @defaultValue='Value scale'
          @description='Accessible name for the group of pip buttons.'
        />
      </:api>
    </FreestyleUsage>
  </template>
}

// ── Slider + PipScale, single value ──────────────────────────────────────
class SliderWithPipsUsage extends Component {
  @tracked price = 400;
  setPrice = (v: number) => (this.price = v);
  format = money;
  get values() {
    return [this.price];
  }
  get usage() {
    return [
      '<Slider @label=\'Budget\' @min={{0}} @max={{1000}} @step={{50}}',
      '  @value={{this.price}} @onValueChange={{this.setPrice}}',
      '  @formatValue={{this.format}} />',
      '<PipScale @min={{0}} @max={{1000}} @step={{50}}',
      "  @pips='ticks' @first='labels' @rest='labels' @last='labels'",
      '  @values={{this.values}} @span=\'min\'',
      '  @formatValue={{this.format}} @label=\'Budget scale\'',
      '  @onPick={{this.setPrice}} />',
    ].join('\n');
  }

  <template>
    <FreestyleUsage
      @name='Slider with PipScale'
      @description='The scale composed under a single-value Slider over one piece of state. The pip band is inset by half a thumb on each side, because a native range input moves its thumb centre between thumb/2 and width minus thumb/2 — a pip at a true 0 percent of the full width would sit half a thumb outside the position the slider can actually reach. Selection is carried by tick height and colour, never by font weight, so nothing reflows as the thumb moves.'
      @source={{this.usage}}
    >
      <:example>
        <Slider
          @label='Budget'
          @min={{0}}
          @max={{1000}}
          @step={{50}}
          @value={{this.price}}
          @onValueChange={{this.setPrice}}
          @formatValue={{this.format}}
        />
        <PipScale
          @min={{0}}
          @max={{1000}}
          @step={{50}}
          @pips='ticks'
          @first='labels'
          @rest='labels'
          @last='labels'
          @maxLabels={{6}}
          @values={{this.values}}
          @span='min'
          @formatValue={{this.format}}
          @label='Budget scale'
          @onPick={{this.setPrice}}
        />
      </:example>
      <:api as |Args|>
        <Args.Number
          @name='value'
          @value={{this.price}}
          @description='Shared by both components. The Slider owns the drag; the scale owns the jump-to-a-named-stop.'
          @onInput={{this.setPrice}}
        />
        <Args.Base
          @name='composition'
          @description='The scale takes nothing from inside the Slider — only the same min, max, step and value. That is why it is a component rather than an argument, and why it can sit under a histogram or a meter just as well.'
        />
      </:api>
    </FreestyleUsage>
  </template>
}

// ── Slider + PipScale, two-thumb range with a restricted window ──────────
class RangeWithPipsUsage extends Component {
  @tracked from = 1950;
  @tracked to = 1990;
  format = decade;
  limits: [number, number] = [1930, 2010];
  setValues = (next: [number, number]) => {
    this.from = next[0];
    this.to = next[1];
  };
  get values(): number[] {
    return [this.from, this.to];
  }
  get pair(): [number, number] {
    return [this.from, this.to];
  }
  /** A pip click moves whichever thumb is nearer — the same rule the pointer
   * uses on the rail itself, so the two affordances never disagree. */
  pick = (v: number) => {
    if (Math.abs(v - this.from) <= Math.abs(v - this.to)) {
      this.setValues([Math.min(v, this.to), this.to]);
    } else {
      this.setValues([this.from, Math.max(v, this.from)]);
    }
  };
  get usage() {
    return [
      '<Slider @label=\'Decade\' @min={{1900}} @max={{2020}} @step={{10}}',
      '  @range={{true}} @values={{this.pair}} @onValuesChange={{this.setValues}}',
      '  @formatValue={{this.format}} />',
      '<PipScale @min={{1900}} @max={{2020}} @step={{10}}',
      "  @pips='ticks' @rest='labels' @first='labels' @last='labels'",
      '  @values={{this.values}} @span={{true}} @limits={{this.limits}}',
      '  @formatValue={{this.format}} @onPick={{this.pick}} />',
    ].join('\n');
  }

  <template>
    <FreestyleUsage
      @name='Range with PipScale'
      @description='A two-thumb range read as a band across a labelled scale. The pips between the thumbs report themselves as in-span and grow, which is the single best idea in the library this vocabulary came from — the scale itself renders the selection, so the range is legible without reading either number. The limits arg draws the window outside 1930 to 2010 quiet and inert while still showing it, so the reader sees the whole scale and learns what is unavailable rather than what merely does not exist.'
      @source={{this.usage}}
    >
      <:example>
        <Slider
          @label='Decade'
          @min={{1900}}
          @max={{2020}}
          @step={{10}}
          @range={{true}}
          @values={{this.pair}}
          @onValuesChange={{this.setValues}}
          @formatValue={{this.format}}
        />
        <PipScale
          @min={{1900}}
          @max={{2020}}
          @step={{10}}
          @pips='ticks'
          @first='labels'
          @rest='labels'
          @last='labels'
          @maxLabels={{7}}
          @values={{this.values}}
          @span={{true}}
          @limits={{this.limits}}
          @formatValue={{this.format}}
          @label='Decade scale'
          @onPick={{this.pick}}
        />
      </:example>
      <:api as |Args|>
        <Args.Array
          @name='values'
          @value={{this.values}}
          @description='The lower and upper pair. Pips strictly between them report the span state.'
        />
        <Args.Array
          @name='limits'
          @value={{this.limits}}
          @description='Selectable window inside the rail. Pips outside it draw quiet, take no clicks, and their buttons stay focusable so a keyboard reader can still discover the boundary.'
        />
        <Args.Action
          @name='onPick'
          @description='Here it moves whichever thumb is nearer, which is the same rule the pointer already follows on the rail.'
        />
      </:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_PIP_SCALE: Record<string, unknown> = {
  PipScale: PipScaleUsage,
  SliderWithPips: SliderWithPipsUsage,
  RangeWithPips: RangeWithPipsUsage,
};
