// Pretui — Sparkline usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Sparkline } from './sparkline';
import type { SparklineKind } from './sparkline';
import type { PretuiToneArg } from '../pretui-primitives';

const ORDERS = [12, 18, 14, 22, 19, 27, 31, 29, 34, 30, 38, 41];
const KINDS = ['line', 'area', 'bar'];
const TONES = ['primary', 'success', 'warning', 'danger', 'info', 'neutral'];

export class SparklineUsage extends Component {
  orders = ORDERS;
  kinds = KINDS;
  tones = TONES;
  @tracked kind = 'area';
  @tracked tone = 'primary';
  @tracked showLast = true;
  setKind = (v: string) => (this.kind = v);
  setTone = (v: string) => (this.tone = v);
  setShowLast = (v: boolean) => (this.showLast = v);
  get toneArg(): PretuiToneArg {
    return this.tone as PretuiToneArg;
  }
  get kindArg() {
    return this.kind as SparklineKind;
  }
  get usage() {
    return `<Sparkline @values={{this.orders}} @label='Orders, last 12 weeks' @kind='${this.kind}' @tone='${this.tone}'${this.showLast ? ' @showLast={{true}}' : ''} />`;
  }
  <template>
    <FreestyleUsage
      @name='Sparkline'
      @description='An inline micro-chart at the size of a word, next to the number it explains: line, area or bars, in plain SVG with no engine and no animation. It is an image named by its label and a spoken summary, so the shape reaches a screen reader as words. Chart is the full plot.'
      @source={{this.usage}}
    >
      <:example>
        <p class='sp-demo'>
          <span class='sp-demo-num'>41</span> orders this week
          <Sparkline @values={{this.orders}} @label='Orders, last 12 weeks' @kind={{this.kindArg}} @tone={{this.toneArg}} @showLast={{this.showLast}} />
        </p>
      </:example>
      <:api as |Args|>
        <Args.Object @name='values' @required={{true}} @description='number[]; non-numbers are dropped.' />
        <Args.String @name='label' @required={{true}} @description='What the series is. The summary is appended.' />
        <Args.String @name='kind' @value={{this.kind}} @options={{this.kinds}} @defaultValue='line' @onInput={{this.setKind}} />
        <Args.String @name='tone' @value={{this.tone}} @options={{this.tones}} @defaultValue='primary' @onInput={{this.setTone}} />
        <Args.Bool @name='showLast' @value={{this.showLast}} @defaultValue={{false}} @onInput={{this.setShowLast}} />
        <Args.Bool @name='zeroBased' @defaultValue={{false}} @description='Start the scale at zero.' />
        <Args.Number @name='width' @defaultValue={{96}} />
        <Args.Number @name='height' @defaultValue={{24}} />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .sp-demo {
        display: flex;
        align-items: center;
        gap: var(--space-3, 0.5rem);
        margin: 0;
        font-size: var(--text-ui-md, 0.78rem);
      }
      .sp-demo-num {
        font-family: var(--font-serif);
        font-size: var(--text-heading, 1.1875rem);
        font-variant-numeric: tabular-nums;
      }
    </style>
  </template>
}

export const DEMOS_SPARKLINE: Record<string, unknown> = {
  Sparkline: SparklineUsage,
};
