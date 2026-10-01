// Pretui — ResultCard: the settled outcome of an agent run.
import Component from '@glimmer/component';
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
          <button type='button' class='pretui-resultcard-menu' aria-label='More' {{on 'click' this.menu}}>⋯</button>
        {{/if}}
      </div>
      {{#each @lines as |line|}}<div class='pretui-resultcard-line'>{{line}}</div>{{/each}}
    </div>
    <style scoped>
      .pretui-resultcard {
        background: var(--field, var(--boxel-light));
        border-radius: 8px;
        box-shadow: var(--pretui-shadow-hairline, 0 0 0 1px var(--border));
        padding: 9px 11px;
        display: flex;
        flex-direction: column;
        gap: 3px;
      }
      .pretui-resultcard-head {
        display: flex;
        align-items: baseline;
        gap: 8px;
      }
      .pretui-resultcard-title {
        font-weight: 600;
        font-size: var(--text-ui-md, 12.5px);
      }
      .pretui-eyebrow {
        font-family: var(--font-mono);
        font-size: var(--text-ui-xs, 11px);
        font-weight: 500;
        letter-spacing: var(--track-eyebrow, 0.08em);
        text-transform: uppercase;
        color: var(--muted-foreground);
      }
      .pretui-resultcard-menu {
        margin-left: auto;
        color: var(--ink-3, var(--boxel-400));
        cursor: pointer;
        letter-spacing: 0.1em;
        border: 0;
        background: none;
        font: inherit;
      }
      .pretui-resultcard-line {
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--muted-foreground);
      }
    </style>
  </template>
}
