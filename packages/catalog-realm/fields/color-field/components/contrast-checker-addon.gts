import Component from '@glimmer/component';
import { concat } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import { gte } from '@cardstack/boxel-ui/helpers';

import { hexToRgba } from '../util/color-utils';
import type { ColorFieldSignature } from '../util/color-field-signature';

export default class ContrastCheckerAddon extends Component<ColorFieldSignature> {
  get contrastRatio(): number | null {
    if (!this.args.model) return null;
    const ratio = this.calculateContrast(this.args.model, '#ffffff');
    return parseFloat(ratio);
  }

  get contrastLevel(): string | null {
    if (!this.contrastRatio) return null;

    if (this.contrastRatio >= 7) return 'AAA';
    if (this.contrastRatio >= 4.5) return 'AA';
    return 'Fails WCAG';
  }

  calculateContrast(color1: string, color2: string): string {
    const getLuminance = (hex: string) => {
      const rgb = hexToRgba(hex);
      const [r, g, b] = [rgb.r, rgb.g, rgb.b].map((val) => {
        val = val / 255;
        return val <= 0.03928
          ? val / 12.92
          : Math.pow((val + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };

    const lum1 = getLuminance(color1);
    const lum2 = getLuminance(color2);
    const lighter = Math.max(lum1, lum2);
    const darker = Math.min(lum1, lum2);
    return ((lighter + 0.05) / (darker + 0.05)).toFixed(2);
  }

  <template>
    <div class='contrast-checker-addon'>
      <label class='addon-label'>Accessibility Check</label>
      {{#if @model}}
        <div
          class='contrast-info
            {{if (gte this.contrastRatio 4.5) "pass" "fail"}}'
        >
          <div class='contrast-ratio'>
            <span class='ratio-label'>Contrast vs White:</span>
            <span class='ratio-value'>{{this.contrastRatio}}:1</span>
            <span class='level-badge'>{{this.contrastLevel}}</span>
          </div>
          <div class='preview-text' style={{htmlSafe (concat 'color:' @model)}}>
            Sample text on white background
          </div>
        </div>
      {{else}}
        <div class='no-color'>
          <p>Select a color to check contrast</p>
        </div>
      {{/if}}
    </div>

    <style scoped>
      .contrast-checker-addon {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }

      .addon-label {
        font-size: 0.75rem;
        font-weight: 600;
        color: var(--muted-foreground, #6b7280);
        text-transform: uppercase;
        letter-spacing: 0.025em;
      }

      .contrast-info {
        padding: 0.75rem;
        border: 1px solid var(--border, #e0e0e0);
        border-radius: var(--radius, 0.375rem);
        background: var(--background, #ffffff);
      }

      .contrast-info.pass {
        border-color: var(--success, #22c55e);
        background: color-mix(in srgb, var(--success, #22c55e) 5%, transparent);
      }

      .contrast-info.fail {
        border-color: var(--warning, #f59e0b);
        background: color-mix(in srgb, var(--warning, #f59e0b) 5%, transparent);
      }

      .contrast-ratio {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin-bottom: 0.5rem;
        flex-wrap: wrap;
      }

      .ratio-label {
        font-size: 0.75rem;
        color: var(--muted-foreground, #6b7280);
      }

      .ratio-value {
        font-family: var(--font-mono, monospace);
        font-size: 0.875rem;
        font-weight: 600;
        color: var(--foreground, #1a1a1a);
      }

      .level-badge {
        padding: 0.125rem 0.375rem;
        background: var(--muted, #f1f5f9);
        border-radius: 0.25rem;
        font-size: 0.625rem;
        font-weight: 700;
        color: var(--muted-foreground, #6b7280);
      }

      .contrast-info.pass .level-badge {
        background: var(--success, #22c55e);
        color: var(--success-foreground, #ffffff);
      }

      .contrast-info.fail .level-badge {
        background: var(--warning, #f59e0b);
        color: var(--warning-foreground, #ffffff);
      }

      .preview-text {
        padding: 0.5rem;
        background: var(--background, #ffffff);
        border: 1px solid var(--border, #e0e0e0);
        border-radius: var(--radius, 0.25rem);
        font-size: 0.75rem;
        font-weight: 500;
        text-align: center;
      }

      .no-color {
        padding: 1rem;
        text-align: center;
        color: var(--muted-foreground, #9ca3af);
        font-size: 0.75rem;
        background: var(--muted, #f8fafc);
        border: 1px solid var(--border, #e2e8f0);
        border-radius: var(--radius, 0.375rem);
      }

      .no-color p {
        margin: 0;
      }
    </style>
  </template>
}
