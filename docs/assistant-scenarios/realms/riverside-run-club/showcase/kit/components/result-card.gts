// Pretui — ResultCard: the settled outcome of an agent run.
import Component from '@glimmer/component';
import DotsIcon from '@cardstack/boxel-icons/dots';
import { on } from '@ember/modifier';

export interface ResultCardSignature {
  Args: { eyebrow?: string; title: string; lines?: string[]; onMenu?: () => void };
  Element: HTMLDivElement;
}

// What you approve is card-shaped, never a JSON blob.
export class ResultCard extends Component<ResultCardSignature> {
  menu = () => this.args.onMenu?.();
  <template>
    <div class='pretui-resultcard' data-test-pretui-result-card ...attributes>
      <div class='pretui-resultcard-head'>
        {{#if @eyebrow}}<span class='pretui-eyebrow'>{{@eyebrow}}</span>{{/if}}
        <span class='pretui-resultcard-title'>{{@title}}</span>
        {{#if @onMenu}}
          <button type='button' class='pretui-resultcard-menu' aria-label='More' {{on 'click' this.menu}}><DotsIcon width='14' height='14' aria-hidden='true' /></button>
        {{/if}}
      </div>
      {{#each @lines as |line|}}<div class='pretui-resultcard-line'>{{line}}</div>{{/each}}
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-resultcard {
          background: var(--card, var(--background));
          color: var(--card-foreground, var(--foreground));
          border-radius: var(--round-row, 8px);
          box-shadow: var(--pretui-shadow-hairline, 0 0 0 1px var(--border));
          padding: var(--step-8, 8px) var(--step-12, 12px);
          display: flex;
          flex-direction: column;
          gap: var(--step-4, 4px);
        }
        .pretui-resultcard-head {
          display: flex;
          align-items: baseline;
          gap: var(--step-8, 8px);
        }
        .pretui-resultcard-title {
          font-weight: 600;
          font-size: var(--type-ui, 12.5px);
          line-height: var(--leading-ui, 18px);
          color: var(--foreground);
        }
        /* a label, not a kicker: sans caption, no tracking, no caps */
        .pretui-eyebrow {
          font-size: var(--type-caption, 11px);
          line-height: var(--leading-caption, 16px);
          font-weight: 400;
          color: var(--ink-3, var(--muted-foreground));
        }
        .pretui-resultcard-menu {
          margin-left: auto;
          color: var(--ink-3, var(--boxel-400));
          cursor: pointer;
          border: 0;
          background: none;
          font: inherit;
        }
        .pretui-resultcard-line {
          font-size: var(--type-ui, 12.5px);
          line-height: var(--leading-ui, 18px);
          color: var(--ink-2, var(--muted-foreground));
        }
      }
    </style>
  </template>
}
