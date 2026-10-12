// Pretui — Chip usage page.
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Chip } from './chip';
import { HUE_OPTIONS } from '../demo-ink-feedback';
import { PRETUI_TONES, type PretuiTone } from '../pretui-primitives';

const TONE_OPTIONS = [...PRETUI_TONES];

// ── Chip ← pill/usage.gts + tag/usage.gts ────────────────────────────────
// Dropped knobs: kind (Chip is never a button), variant + size (no
// variant/size matrix), pillBorderColor / pillFontColor / borderColor /
// fontColor (@tone picks the pill's treatment; @hue colors the dot),
// ellipsize (chips never wrap or truncate), htmlTag (Chip is always a span).
class ChipUsage extends GlimmerComponent {
  @tracked label = 'Meeting Minutes';
  @tracked hue = '';
  @tracked tone: PretuiTone = 'neutral';
  @tracked dot = true;
  setLabel = (v: string) => (this.label = v);
  setHue = (v: string) => (this.hue = v);
  setTone = (v: string) => (this.tone = v as PretuiTone);
  toggleDot = (v: boolean) => (this.dot = v);
  get hueVal() {
    return this.hue || undefined;
  }
  get usage() {
    let bits = [`@label='${this.label}'`];
    if (this.tone !== 'neutral') {
      bits.push(`@tone='${this.tone}'`);
    }
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
        <Chip
          @label={{this.label}}
          @tone={{this.tone}}
          @hue={{this.hueVal}}
          @dot={{this.dot}}
        />
        <Chip @label='Gelato' @hue='var(--chart-3)' />
        <Chip @label='Catering' @hue='var(--chart-4)' />
        <Chip @label='Seasonal' @hue='var(--chart-1)' />
        <Chip @label='draft' />
        <Chip @label='live' @tone='success' />
        <Chip @label='blocked' @tone='danger' />
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
          @description='Color of the dot; empty uses the tone, or the muted ink when neutral.'
          @options={{HUE_OPTIONS}}
          @value={{this.hue}}
          @onInput={{this.setHue}}
        />
        <Args.String
          @name='tone'
          @description='Neutral is the muted pill; any other tone outlines it in that tone.'
          @options={{TONE_OPTIONS}}
          @defaultValue='neutral'
          @value={{this.tone}}
          @onInput={{this.setTone}}
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
