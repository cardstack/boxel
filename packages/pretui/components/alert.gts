// Pretui — Alert: an inline message with a tone, a title and an optional action.
import Component from '@glimmer/component';
import { htmlSafe } from '@ember/template';
import { resolveTone } from '../pretui-primitives';
import type { PretuiToneArg } from '../pretui-primitives';

type AlertTone = 'info' | 'success' | 'warning' | 'danger';
const ALERT_TONES: readonly AlertTone[] = [
  'info',
  'success',
  'warning',
  'danger',
];
// shadcn's Alert has one `variant` enum rather than a tone. Both of its
// values map onto tones this component already paints.
const ALERT_VARIANTS: Record<string, AlertTone> = {
  default: 'info',
  destructive: 'danger',
};
const ALERT_HUES: Record<AlertTone, string> = {
  info: 'var(--pretui-info)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--destructive)',
};
const ALERT_GLYPHS: Record<AlertTone, string> = {
  info: 'i',
  success: '✓',
  warning: '!',
  danger: '✕',
};

export interface AlertSignature {
  Args: {
    /** accepts the React tone spellings — `destructive`/`error` → danger,
     * `positive` → success, `notice` → warning. Tones outside the four an
     * Alert paints fall back to `info` rather than emitting a dead
     * `data-tone`. */
    tone?: AlertTone | PretuiToneArg;
    title?: string;
    /** alias — shadcn's one-enum Alert API (`default` | `destructive`) */
    variant?: 'default' | 'destructive';
  };
  Blocks: { default: []; action: [] };
  Element: HTMLDivElement;
}

export class Alert extends Component<AlertSignature> {
  get tone(): AlertTone {
    let fromVariant = this.args.variant
      ? ALERT_VARIANTS[this.args.variant]
      : undefined;
    return resolveTone(this.args.tone, ALERT_TONES, fromVariant ?? 'info');
  }
  get role() {
    return this.tone === 'danger' ? 'alert' : 'status';
  }
  get hueStyle() {
    return htmlSafe(`--pretui-alert-hue: ${ALERT_HUES[this.tone]}`);
  }
  get glyph() {
    return ALERT_GLYPHS[this.tone];
  }
  <template>
    <div class='pretui-alert' role={{this.role}} style={{this.hueStyle}} data-test-pretui-alert ...attributes>
      <span class='pretui-alert-glyph'>{{this.glyph}}</span>
      <div class='pretui-alert-body'>
        {{#if @title}}<div class='pretui-alert-title'>{{@title}}</div>{{/if}}
        {{#if (has-block)}}<div>{{yield}}</div>{{/if}}
        {{#if (has-block 'action')}}<div class='pretui-alert-action'>{{yield to='action'}}</div>{{/if}}
      </div>
    </div>
    <style scoped>
      .pretui-alert {
        display: flex;
        gap: 9px;
        padding: 8px 10px;
        border-radius: 10px;
        background: color-mix(in oklch, var(--pretui-alert-hue, var(--chart-1)) var(--pretui-chip-mix, 20%), var(--card));
        color: color-mix(in oklch, var(--foreground) 40%, var(--pretui-alert-hue, var(--chart-1)));
        box-shadow: 0 0 0 1px color-mix(in oklch, var(--pretui-alert-hue, var(--chart-1)) 25%, var(--border));
        font-size: var(--text-ui-md, 12.5px);
      }
      .pretui-alert-glyph {
        width: 16px;
        height: 16px;
        border-radius: 50%;
        flex: none;
        display: grid;
        place-items: center;
        font-size: 9px;
        font-weight: 700;
        background: var(--pretui-alert-hue, var(--chart-1));
        color: var(--pretui-on-neutral, var(--boxel-light));
        margin-top: 1px;
      }
      .pretui-alert-body {
        display: grid;
        gap: 2px;
        min-width: 0;
      }
      .pretui-alert-title {
        font-weight: 600;
        color: color-mix(in oklch, var(--foreground) 55%, var(--pretui-alert-hue, var(--chart-1)));
      }
      .pretui-alert-action {
        margin-top: 4px;
      }
    </style>
  </template>
}
