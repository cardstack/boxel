// Pretui — Chip: a compact label in one hue (Law 2: one hue in, complete treatment out).
import Component from '@glimmer/component';
import { hueStyle } from '../internal/ink';

export interface ChipSignature {
  Args: { label?: string; hue?: string; dot?: boolean };
  Blocks: { default: [] };
  Element: HTMLSpanElement;
}

export class Chip extends Component<ChipSignature> {
  get showDot() {
    return this.args.dot ?? true;
  }
  get style() {
    return hueStyle('--pretui-chip-hue', this.args.hue);
  }
  <template>
    <span class='pretui-chip' style={{this.style}} data-test-pretui-chip ...attributes>
      {{#if this.showDot}}<span class='pretui-chip-dot'></span>{{/if}}
      {{#if @label}}{{@label}}{{else}}{{yield}}{{/if}}
    </span>
    <style scoped>
      .pretui-chip {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        height: 18px;
        padding: 0 7px;
        border-radius: var(--radius-chip, 6px);
        font-size: var(--text-ui-xs, 11px);
        font-weight: 500;
        letter-spacing: var(--track-ui, 0.01em);
        white-space: nowrap;
        background: color-mix(in oklch, var(--pretui-chip-hue, var(--muted-foreground)) var(--pretui-chip-mix, 20%), var(--card));
        color: color-mix(in oklch, var(--foreground) var(--pretui-ink-mix, 34%), var(--pretui-chip-hue, var(--muted-foreground)));
        box-shadow: 0 0 0 1px color-mix(in oklch, var(--pretui-chip-hue, var(--muted-foreground)) 45%, var(--border));
      }
      .pretui-chip-dot {
        width: 5px;
        height: 5px;
        border-radius: 50%;
        background: var(--pretui-chip-hue, var(--muted-foreground));
        flex: none;
      }
    </style>
  </template>
}
