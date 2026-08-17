import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { Pill } from '@cardstack/boxel-ui/components';

// The one place the fulfilment blocks decide how a lifecycle hue is allowed to
// render. A status hue arrives as data (a value on an options table, not a
// literal in a stylesheet) and is consumed three ways, all derived from that
// single hue so they can never come apart:
//
//   fill   — 14% of the hue, so it tints rather than shouts
//   border — 32% of the hue
//   text   — the hue mixed toward the theme's own --foreground, which is what
//            keeps it legible in both light and dark: --foreground flips, so
//            the mix flips with it. A raw hue as text would be near-invisible
//            on one of the two grounds.
//
// Every mix is `in oklch` and every mix targets a token, never a literal.

export type StatusStyle = {
  value: string;
  label: string;
  hue: string;
};

const fill = (hue: string) =>
  `color-mix(in oklch, ${hue} 14%, transparent)`;
const edge = (hue: string) =>
  `color-mix(in oklch, ${hue} 32%, transparent)`;
const ink = (hue: string) =>
  `color-mix(in oklch, ${hue} 58%, var(--foreground, var(--boxel-dark)))`;

interface StatusChipSignature {
  Args: {
    hue?: string;
    label?: string;
    size?: 'small' | 'base';
  };
  Element: HTMLElement;
}

// Renders a lifecycle value as a boxel-ui Pill, tinted by its hue. Consumers
// pass the hue; this component owns how a hue becomes colour.
const StatusChip: TemplateOnlyComponent<StatusChipSignature> = <template>
  {{#if @label}}
    <Pill
      @tag='span'
      @size={{if @size @size 'small'}}
      @pillBackgroundColor={{fill (statusHue @hue)}}
      @pillBorderColor={{edge (statusHue @hue)}}
      @pillFontColor={{ink (statusHue @hue)}}
      class='status-chip'
      data-test-status-chip={{@label}}
      ...attributes
    >{{@label}}</Pill>
  {{/if}}

  <style scoped>
    .status-chip {
      font-weight: 600;
      letter-spacing: 0.01em;
      white-space: nowrap;
    }
  </style>
</template>;

// With no hue in the data the chip degrades to a neutral that still follows
// the theme, rather than to a hardcoded grey.
function statusHue(hue: string | undefined) {
  return hue && hue.length ? hue : 'var(--muted-foreground, var(--boxel-500))';
}

export default StatusChip;
export { StatusChip };
