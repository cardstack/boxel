import Component from '@glimmer/component';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { fn, concat } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import { gt, eq, not } from '@cardstack/boxel-ui/helpers';

import { parseCssColorSafe, rgbaToHex } from '../util/color-utils';

interface RecentColorsSignature {
  Args: {
    model: string | null;
    recentColors: string[];
    onSelectColor: (color: string) => void;
    canEdit?: boolean;
  };
}

export default class RecentColorsAddon extends Component<RecentColorsSignature> {
  get currentColor(): string | null {
    return this.normalizeColor(this.args.model);
  }

  normalizeColor(color: string | null | undefined): string | null {
    if (!color) return null;
    const { rgba, valid } = parseCssColorSafe(color);
    if (!valid) return null;
    return rgbaToHex(rgba, rgba.a < 1).toUpperCase();
  }

  @action
  selectRecentColor(color: string) {
    this.args.onSelectColor(color);
  }

  <template>
    <div class='recent-colors-addon'>
      <label class='addon-label'>Recent Colors</label>
      {{#if (gt @recentColors.length 0)}}
        <div class='recent-colors-grid'>
          {{#each @recentColors as |color|}}
            <button
              type='button'
              class='recent-color-swatch
                {{if (eq color this.currentColor) "active"}}'
              style={{htmlSafe (concat 'background-color:' color)}}
              title={{color}}
              {{on 'click' (fn this.selectRecentColor color)}}
              disabled={{not @canEdit}}
            >
            </button>
          {{/each}}
        </div>
      {{else}}
        <div class='empty-history'>
          <p>No recent colors yet</p>
        </div>
      {{/if}}
    </div>

    <style scoped>
      .recent-colors-addon {
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

      .recent-colors-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(2.5rem, 1fr));
        gap: 0.375rem;
      }

      .recent-color-swatch {
        width: 100%;
        aspect-ratio: 1;
        border: 2px solid transparent;
        border-radius: 0.375rem;
        cursor: pointer;
        transition: all 0.15s ease;
        position: relative;
        box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.1);
      }

      .recent-color-swatch:hover:not(:disabled):not(.active) {
        transform: translateY(-2px);
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
        z-index: 1;
      }

      .recent-color-swatch.active:hover:not(:disabled) {
        transform: translateY(-2px);
      }

      .recent-color-swatch.active {
        border-color: var(--ring, #3b82f6);
        border-width: 2px;
        box-shadow:
          0 0 0 1px rgba(0, 0, 0, 0.1),
          0 0 0 2px var(--ring, #3b82f6);
        z-index: 2;
      }

      .recent-color-swatch:disabled {
        cursor: not-allowed;
        opacity: 0.5;
      }

      .empty-history {
        padding: 1rem;
        text-align: center;
        color: var(--muted-foreground, #9ca3af);
        font-size: 0.75rem;
        background: var(--muted, #f8fafc);
        border: 1px solid var(--border, #e2e8f0);
        border-radius: var(--radius, 0.375rem);
      }

      .empty-history p {
        margin: 0;
      }
    </style>
  </template>
}
