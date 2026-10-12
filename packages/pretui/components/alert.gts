// Pretui — Alert: an inline message with a tone, a title and an optional action.
import Component from '@glimmer/component';
import { htmlSafe } from '@ember/template';
import AlertTriangleIcon from '@cardstack/boxel-icons/alert-triangle';
import CheckIcon from '@cardstack/boxel-icons/check';
import InfoIcon from '@cardstack/boxel-icons/info-small';
import XIcon from '@cardstack/boxel-icons/x';
import { keepStyle, type KeptProperty } from '../internal/keep-style';
import { resolveTone } from '../pretui-primitives';
import type { PretuiToneArg } from '../pretui-primitives';
import { VisuallyHidden } from './visually-hidden';

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
// Each tone names its fill and the fill's paired foreground (the ink that
// reads on the disc). The text is `--foreground`: the `-ink` tokens are only
// guaranteed on `--background`, `--card` and `--muted`, not on the tint.
const ALERT_COLORS: Record<AlertTone, { hue: string; onHue: string }> = {
  info: {
    hue: 'var(--info)',
    onHue: 'var(--info-foreground)',
  },
  success: {
    hue: 'var(--success)',
    onHue: 'var(--success-foreground)',
  },
  warning: {
    hue: 'var(--warning)',
    onHue: 'var(--warning-foreground)',
  },
  danger: {
    hue: 'var(--destructive)',
    onHue: 'var(--destructive-foreground)',
  },
};
const ALERT_ICONS = {
  info: InfoIcon,
  success: CheckIcon,
  warning: AlertTriangleIcon,
  danger: XIcon,
};
// The glyph is hidden from assistive technology, so the tone is spoken as a
// word instead. Without it, `info`, `success` and `warning` all share
// `role="status"` and are announced identically.
const ALERT_TONE_LABELS: Record<AlertTone, string> = {
  info: 'Info',
  success: 'Success',
  warning: 'Warning',
  danger: 'Error',
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
    /** the tone word a screen reader hears before the title, in place of the
     * hidden glyph. Defaults by tone: Info, Success, Warning, Error. */
    toneLabel?: string;
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
    let { hue, onHue } = ALERT_COLORS[this.tone];
    return htmlSafe(`--pretui-alert-hue: ${hue}; --pretui-alert-on-hue: ${onHue}`,
    );
  }
  // The same properties again, kept on top of a caller's `style`: a caller's
  // `style` attribute replaces the component's own, and the tint, hairline
  // and glyph disc all read these properties.
  get keptStyle(): KeptProperty[] {
    let { hue, onHue } = ALERT_COLORS[this.tone];
    return [
      { property: '--pretui-alert-hue', value: hue, strength: 'arg' },
      { property: '--pretui-alert-on-hue', value: onHue, strength: 'arg' },
    ];
  }
  get Glyph() {
    return ALERT_ICONS[this.tone];
  }
  get spokenTone(): string {
    return `${this.args.toneLabel ?? ALERT_TONE_LABELS[this.tone]}:`;
  }
  <template>
    <div class='pretui-alert' role={{this.role}} style={{this.hueStyle}} {{keepStyle this.keptStyle}} data-test-pretui-alert ...attributes>
      <span class='pretui-alert-glyph' aria-hidden='true'>
        <this.Glyph width='12' height='12' />
      </span>
      <VisuallyHidden>{{this.spokenTone}}</VisuallyHidden>
      <div class='pretui-alert-body'>
        {{#if @title}}<p class='pretui-alert-title'>{{@title}}</p>{{/if}}
        {{#if (has-block)}}<div>{{yield}}</div>{{/if}}
        {{#if (has-block 'action')}}<div class='pretui-alert-action'>{{yield to='action'}}</div>{{/if}}
      </div>
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-alert {
          --pretui-alert-mix: 20%;
          display: flex;
          gap: var(--boxel-sp-xs);
          padding: var(--boxel-sp-2xs) var(--boxel-sp-xs);
          border-radius: var(--boxel-border-radius);
          background-color: color-mix(in oklch, var(--pretui-alert-hue) var(--pretui-alert-mix), var(--card));
          color: var(--foreground);
          box-shadow: 0 0 0 1px color-mix(in oklch, var(--pretui-alert-hue) 25%, var(--border));
          font-size: var(--boxel-font-size-xs);
        }
        .pretui-alert-glyph {
          width: 1rem;
          height: 1rem;
          border-radius: 50%;
          flex: none;
          display: grid;
          place-items: center;
          background-color: var(--pretui-alert-hue);
          color: var(--pretui-alert-on-hue);
          margin-top: 1px;
        }
        .pretui-alert-body {
          display: grid;
          gap: var(--boxel-sp-6xs);
          min-width: 0;
        }
        .pretui-alert-title {
          margin: 0;
          font-weight: 600;
        }
        .pretui-alert-action {
          margin-top: var(--boxel-sp-3xs);
        }
      }
    </style>
  </template>
}
