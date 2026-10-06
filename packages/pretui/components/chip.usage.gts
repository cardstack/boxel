// Pretui — Chip usage page.
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Chip } from './chip';
import { HUE_OPTIONS } from '../demo-ink-feedback';

// ── Chip ← pill/usage.gts + tag/usage.gts ────────────────────────────────
// Dropped knobs: kind (Chip is never a button), variant + size (one hue in,
// complete treatment out — no variant/size matrix), pillBorderColor /
// pillFontColor / borderColor / fontColor (the single @hue derives fill,
// ring, and ink), ellipsize (chips never wrap or truncate), htmlTag (Chip is
// always a span).
class ChipUsage extends GlimmerComponent {
  @tracked label = 'Meeting Minutes';
  @tracked hue = '';
  @tracked dot = true;
  setLabel = (v: string) => (this.label = v);
  setHue = (v: string) => (this.hue = v);
  toggleDot = (v: boolean) => (this.dot = v);
  get hueVal() {
    return this.hue || undefined;
  }
  get usage() {
    let bits = [`@label='${this.label}'`];
    if (this.hue) {
      bits.push(`@hue='${this.hue}'`);
    }
    if (!this.dot) {
      bits.push('@dot={{false}}');
    }
    return `<Chip ${bits.join(' ')} />`;
  }
  <template>
    <FreestyleUsage
      @name='Chip'
      @description='Pills are used to display information in a compact and visually appealing manner. Similar to a tag, badge or label.'
      @source={{this.usage}}
    >
      <:example>
        <Chip @label={{this.label}} @hue={{this.hueVal}} @dot={{this.dot}} />
        <Chip @label='Gelato' @hue='var(--chart-3)' />
        <Chip @label='Catering' @hue='var(--chart-4)' />
        <Chip @label='Seasonal' @hue='var(--chart-1)' />
        <Chip @label='draft' />
      </:example>
      <:api as |Args|>
        <Args.String
          @name='label'
          @description='title of the tag'
          @value={{this.label}}
          @onInput={{this.setLabel}}
        />
        <Args.String
          @name='hue'
          @description='Background color of the pill — in Pretui the one hue drives fill, ring, and ink together (Law 2); empty derives no hue.'
          @options={{HUE_OPTIONS}}
          @value={{this.hue}}
          @onInput={{this.setHue}}
        />
        <Args.Bool
          @name='dot'
          @description='Leading status dot (Pretui addition).'
          @defaultValue={{true}}
          @value={{this.dot}}
          @onInput={{this.toggleDot}}
        />
      </:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_CHIP: Record<string, unknown> = {
  Chip: ChipUsage,
};
