// Pretui — ink territory: labels & values.
// Translated from pretui-design-system (components/ink + css/ink.css).
// Laws in force: 2 (one hue in, complete treatment out), 3 (machine values
// as jewelry), 4 (discrete beats continuous — Meter always ships a label).
// Consumes the SS26 theme tokens; fallbacks declared once per component root.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { htmlSafe } from '@ember/template';
import { cssDeclaration, cssStyle, cssStyleFrom } from './pretui-css';

// Stable hash: same status value → same chart hue on every card (Law 2 corollary).
export function statusHue(value: string): string {
  let h = 0;
  let s = String(value);
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return `var(--chart-${(h % 5) + 1})`;
}

// `@hue` is a caller string, so it goes through the kit-wide allowlist before
// it reaches htmlSafe — an unvalidated one could carry its own declarations.
// A rejected hue drops the override and the stylesheet's own fallback paints.
function hueStyle(prop: string, hue: string | undefined) {
  return cssStyle(prop, hue);
}

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

export interface StatusChipSignature {
  Args: { value: string; hue?: string };
  Element: HTMLSpanElement;
}

// A chip whose hue derives from the status VALUE — caller override is the exception.
export class StatusChip extends Component<StatusChipSignature> {
  get hue() {
    return this.args.hue ?? statusHue(this.args.value);
  }
  <template>
    <Chip @label={{@value}} @hue={{this.hue}} data-test-pretui-status-chip ...attributes />
  </template>
}

export interface TokenSignature {
  Args: { value?: string; hue?: string };
  Blocks: { default: [] };
  Element: HTMLElement;
}

// Law 3 — a machine value set like jewelry: mono pill, inline in prose.
// Carries .35ch side margins; flush (margin 0) as a direct cell/dd child.
export class Token extends Component<TokenSignature> {
  get style() {
    return hueStyle('--pretui-token-hue', this.args.hue);
  }
  <template>
    <code class='pretui-token' style={{this.style}} data-test-pretui-token ...attributes>
      {{#if @value}}{{@value}}{{else}}{{yield}}{{/if}}
    </code>
    <style scoped>
      .pretui-token {
        --_th: var(--pretui-token-hue, var(--pretui-primary-ink, var(--primary)));
        display: inline-block;
        margin-inline: 0.35ch;
        vertical-align: baseline;
        font-family: var(--font-mono);
        font-size: calc(var(--text-body, 15px) - 3.5px);
        line-height: 1.5;
        padding: 0 5px;
        border-radius: 4px;
        background: color-mix(in oklch, var(--_th) 8%, var(--card));
        color: color-mix(in oklch, var(--foreground) 26%, var(--_th));
        box-shadow: 0 0 0 1px color-mix(in oklch, var(--_th) 30%, var(--border));
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
      }
      :where(td, dd) > .pretui-token {
        margin-inline: 0;
      }
    </style>
  </template>
}

export interface DeltaSignature {
  Args: { value: number | string; format?: (n: number) => string };
  Element: HTMLSpanElement;
}

// Signed delta — the pill-less Token variant: bare mono, colored by sign.
export class Delta extends Component<DeltaSignature> {
  get n() {
    return Number(this.args.value);
  }
  get sign() {
    return this.n > 0 ? 'up' : this.n < 0 ? 'down' : 'flat';
  }
  get text() {
    if (this.args.format) {
      return this.args.format(this.n);
    }
    return (this.n > 0 ? '+' : '') + this.n;
  }
  <template>
    <span class='pretui-delta' data-sign={{this.sign}} data-test-pretui-delta ...attributes>{{this.text}}</span>
    <style scoped>
      .pretui-delta {
        font-family: var(--font-mono);
        font-size: var(--text-ui-sm, 11.5px);
        font-variant-numeric: tabular-nums;
        font-weight: 500;
      }
      .pretui-delta[data-sign='up'] {
        color: var(--success, var(--boxel-success));
      }
      .pretui-delta[data-sign='down'] {
        color: var(--pretui-destructive-ink, var(--boxel-danger));
      }
      .pretui-delta[data-sign='flat'] {
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export interface MeterSignature {
  Args: {
    level: number;
    segments?: number;
    label: string; // Law 4: segments always ship a text label
    hue?: string;
    heights?: number[];
  };
  Element: HTMLSpanElement;
}

export class Meter extends Component<MeterSignature> {
  get bars(): { on: boolean; style: ReturnType<typeof htmlSafe> }[] {
    let segments = this.args.segments ?? 3;
    let heights = this.args.heights ?? [6, 10, 14];
    let out = [];
    for (let i = 0; i < segments; i++) {
      let h = heights[i] ?? heights[heights.length - 1];
      out.push({ on: i < this.args.level, style: htmlSafe(`height: ${h}px`) });
    }
    return out;
  }
  get segmentsCount() {
    return this.args.segments ?? 3;
  }
  get style() {
    return hueStyle('--pretui-meter-hue', this.args.hue);
  }
  /**
   * A FALLBACK ROLE LIST, which `role` has always accepted: the first token
   * the engine understands wins.
   *
   * Firefox does not implement `role='meter'` at all, so a bare `role='meter'`
   * announces there as an unnamed group and the level is simply lost. React
   * Aria ships exactly this pair for the same reason. Meter-aware engines
   * still get `meter`; Firefox falls back to `progressbar`, which reads the
   * same `aria-valuenow`/`valuemin`/`valuemax` already present.
   *
   * Held in a getter rather than written inline because ember-template-lint's
   * `no-invalid-role` validates the whole attribute as a single role name and
   * rejects the (valid) two-token form.
   */
  meterRole = 'meter progressbar';
  <template>
    <span
      class='pretui-meter'
      style={{this.style}}
      role={{this.meterRole}}
      aria-valuenow={{@level}}
      aria-valuemin='0'
      aria-valuemax={{this.segmentsCount}}
      aria-label={{@label}}
      data-test-pretui-meter
      ...attributes
    >
      <span class='pretui-meter-bars'>
        {{#each this.bars as |bar|}}
          <span class='pretui-meter-bar' data-on={{if bar.on 'true'}} style={{bar.style}}></span>
        {{/each}}
      </span>
      {{#if @label}}<span class='pretui-meter-label'>{{@label}}</span>{{/if}}
    </span>
    <style scoped>
      .pretui-meter {
        display: inline-flex;
        align-items: flex-end;
        gap: 8px;
      }
      .pretui-meter-bars {
        display: inline-flex;
        align-items: flex-end;
        gap: 2px;
        height: 14px;
      }
      .pretui-meter-bar {
        width: 4px;
        border-radius: 2px;
        background: var(--line-strong, var(--boxel-400));
      }
      .pretui-meter-bar[data-on] {
        background: var(--pretui-meter-hue, var(--primary));
      }
      .pretui-meter-label {
        font-size: var(--text-ui-md, 12.5px);
        font-weight: 500;
        color: var(--muted-foreground);
        line-height: 1;
      }
    </style>
  </template>
}

export interface AvatarSignature {
  Args: { name: string; src?: string; hue?: string; size?: number };
  Element: HTMLSpanElement;
}

export class Avatar extends Component<AvatarSignature> {
  @tracked failedSrc: string | undefined;

  get initials() {
    return (this.args.name ?? '')
      .split(/\s+/)
      .map((w) => w[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
  }
  get showImage(): boolean {
    return Boolean(this.args.src) && this.args.src !== this.failedSrc;
  }
  imageError = () => {
    this.failedSrc = this.args.src;
  };
  get style() {
    let size = Number(this.args.size ?? 24) || 24;
    let hue = this.args.hue ?? statusHue(this.args.name ?? '');
    // Sizes are numbers we formatted ourselves; the hue is a caller string
    // and is validated (see hueStyle above).
    return cssStyleFrom([
      `width: ${size}px`,
      `height: ${size}px`,
      `font-size: ${Math.round(size * 0.42)}px`,
      cssDeclaration('--pretui-chip-hue', hue),
    ]);
  }
  <template>
    <span class='pretui-avatar' title={{@name}} aria-label={{@name}} style={{this.style}} data-test-pretui-avatar ...attributes>
      {{#if this.showImage}}<img src={{@src}} alt={{@name}} {{on 'error' this.imageError}} />{{else}}{{this.initials}}{{/if}}
    </span>
    <style scoped>
      .pretui-avatar {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        font-family: var(--font-mono);
        font-weight: 600;
        background: color-mix(in oklch, var(--pretui-chip-hue, var(--primary)) 16%, var(--card));
        color: color-mix(in oklch, var(--foreground) 20%, var(--pretui-chip-hue, var(--primary)));
        box-shadow: 0 0 0 1px color-mix(in oklch, var(--pretui-chip-hue, var(--primary)) 28%, var(--border));
        overflow: hidden;
        flex: none;
      }
      .pretui-avatar img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
    </style>
  </template>
}

export interface AvatarGroupSignature {
  Blocks: { default: [] };
  Element: HTMLSpanElement;
}

// Overlapping avatar row; the card-colored ring separates neighbors.
export const AvatarGroup: TemplateOnlyComponent<AvatarGroupSignature> = <template>
  <span class='pretui-avatar-group' data-test-pretui-avatar-group ...attributes>
    {{yield}}
  </span>
  <style scoped>
    .pretui-avatar-group {
      display: inline-flex;
    }
    .pretui-avatar-group > :deep(.pretui-avatar) {
      margin-left: -6px;
      box-shadow: 0 0 0 2px var(--card);
    }
    .pretui-avatar-group > :deep(.pretui-avatar:first-child) {
      margin-left: 0;
    }
  </style>
</template>;
