import Component from '@glimmer/component';
import { and, gte, lt } from '@cardstack/boxel-ui/helpers';
import { concat } from '@ember/helper';
import { htmlSafe } from '@ember/template';

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
          class='contrast-card
            {{if (gte this.contrastRatio 7) "aaa"}}
            {{if
              (and (gte this.contrastRatio 4.5) (lt this.contrastRatio 7))
              "aa"
            }}
            {{if (lt this.contrastRatio 4.5) "fail"}}'
        >
          <div class='contrast-header'>
            <div class='contrast-ratio-group'>
              <span class='ratio-label'>Contrast Ratio</span>
              <span class='ratio-value'>{{this.contrastRatio}}:1</span>
            </div>
            <span class='level-badge level-{{this.contrastLevel}}'>
              {{this.contrastLevel}}
            </span>
          </div>

          <div class='contrast-details'>
            <div class='wcag-requirements'>
              <div class='requirement'>
                <span class='requirement-label'>AA (Normal Text):</span>
                <span
                  class='requirement-status
                    {{if (gte this.contrastRatio 4.5) "met" "unmet"}}'
                >
                  {{if (gte this.contrastRatio 4.5) '✓ Pass' '✗ Fail'}}
                </span>
              </div>
              <div class='requirement'>
                <span class='requirement-label'>AAA (Normal Text):</span>
                <span
                  class='requirement-status
                    {{if (gte this.contrastRatio 7) "met" "unmet"}}'
                >
                  {{if (gte this.contrastRatio 7) '✓ Pass' '✗ Fail'}}
                </span>
              </div>
            </div>

            <div class='preview-container'>
              <div class='preview-label'>Preview</div>
              <div
                class='preview-text'
                style={{htmlSafe (concat 'color:' @model)}}
              >
                Sample text on white background
              </div>
            </div>
          </div>
        </div>
      {{else}}
        <div class='no-color-state'>
          <p class='no-color-message'>Select a color to check contrast</p>
        </div>
      {{/if}}
    </div>

    <style scoped>
      .contrast-checker-addon {
        display: flex;
        flex-direction: column;
        gap: calc(var(--spacing, 0.25rem) * 3);
      }

      .addon-label {
        font-size: 0.75rem;
        font-weight: 600;
        color: var(--muted-foreground, #64748b);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .contrast-card {
        background: var(--card, #ffffff);
        border: 1px solid var(--border, #e2e8f0);
        border-radius: var(--radius, 0.5rem);
        padding: calc(var(--spacing, 0.25rem) * 4);
        transition: all 0.2s ease;
      }

      .contrast-card.aaa {
        border-color: var(--chart2, #10b981);
        background: color-mix(
          in srgb,
          var(--chart2, #10b981) 8%,
          var(--card, #ffffff)
        );
      }

      .contrast-card.aa {
        border-color: var(--chart3, #f59e0b);
        background: color-mix(
          in srgb,
          var(--chart3, #f59e0b) 8%,
          var(--card, #ffffff)
        );
      }

      .contrast-card.fail {
        border-color: var(--destructive, #ef4444);
        background: color-mix(
          in srgb,
          var(--destructive, #ef4444) 8%,
          var(--card, #ffffff)
        );
      }

      .contrast-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: calc(var(--spacing, 0.25rem) * 3);
        padding-bottom: calc(var(--spacing, 0.25rem) * 3);
        border-bottom: 1px solid var(--border, #e2e8f0);
      }

      .contrast-ratio-group {
        display: flex;
        flex-direction: column;
        gap: calc(var(--spacing, 0.25rem) * 1);
      }

      .ratio-label {
        font-size: 0.75rem;
        color: var(--muted-foreground, #64748b);
        font-weight: 500;
      }

      .ratio-value {
        font-family: var(
          --font-mono,
          'SF Mono',
          'Monaco',
          'Courier New',
          monospace
        );
        font-size: 1.25rem;
        font-weight: 700;
        color: var(--foreground, #0f172a);
        line-height: 1.2;
      }

      .level-badge {
        padding: calc(var(--spacing, 0.25rem) * 1.5)
          calc(var(--spacing, 0.25rem) * 3);
        border-radius: calc(var(--radius, 0.5rem) * 0.5);
        font-size: 0.6875rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        white-space: nowrap;
      }

      .level-badge.level-AAA {
        background: var(--chart2, #10b981);
        color: var(--background, #ffffff);
      }

      .level-badge.level-AA {
        background: var(--chart3, #f59e0b);
        color: var(--background, #ffffff);
      }

      .level-badge.level-Fails {
        background: var(--destructive, #ef4444);
        color: var(--destructive-foreground, #ffffff);
      }

      .contrast-details {
        display: flex;
        flex-direction: column;
        gap: calc(var(--spacing, 0.25rem) * 3);
      }

      .wcag-requirements {
        display: flex;
        flex-direction: column;
        gap: calc(var(--spacing, 0.25rem) * 2);
      }

      .requirement {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 0.8125rem;
      }

      .requirement-label {
        color: var(--foreground, #0f172a);
        font-weight: 500;
      }

      .requirement-status {
        font-weight: 600;
        font-family: var(--font-mono, monospace);
      }

      .requirement-status.met {
        color: var(--chart2, #10b981);
      }

      .requirement-status.unmet {
        color: var(--destructive, #ef4444);
      }

      .preview-container {
        display: flex;
        flex-direction: column;
        gap: calc(var(--spacing, 0.25rem) * 2);
      }

      .preview-label {
        font-size: 0.75rem;
        font-weight: 600;
        color: var(--muted-foreground, #64748b);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .preview-text {
        padding: calc(var(--spacing, 0.25rem) * 3);
        background: var(--background, #ffffff);
        border: 1px solid var(--border, #e2e8f0);
        border-radius: calc(var(--radius, 0.5rem) * 0.75);
        font-size: 0.875rem;
        font-weight: 500;
        text-align: center;
        min-height: 2.5rem;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .no-color-state {
        padding: calc(var(--spacing, 0.25rem) * 4);
        text-align: center;
        background: var(--muted, #f8fafc);
        border: 1px solid var(--border, #e2e8f0);
        border-radius: var(--radius, 0.5rem);
      }

      .no-color-message {
        margin: 0;
        color: var(--muted-foreground, #94a3b8);
        font-size: 0.8125rem;
      }
    </style>
  </template>
}
