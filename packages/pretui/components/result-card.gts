// Pretui — ResultCard: the settled outcome of an agent run.
import Component from '@glimmer/component';
import DotsIcon from '@cardstack/boxel-icons/dots';
import { on } from '@ember/modifier';

export interface ResultCardSignature {
  Args: {
    eyebrow?: string;
    title: string;
    lines?: string[];
    onMenu?: () => void;
  };
  Element: HTMLDivElement;
}

// What you approve is card-shaped, never a JSON blob.
export class ResultCard extends Component<ResultCardSignature> {
  menu = () => this.args.onMenu?.();
  /** the menu button's name says whose actions it holds */
  get menuLabel(): string {
    return `More actions for ${this.args.title}`;
  }
  <template>
    <div class='pretui-resultcard' data-test-pretui-result-card ...attributes>
      <div class='pretui-resultcard-head'>
        {{#if @eyebrow}}<span class='pretui-eyebrow'>{{@eyebrow}}</span>{{/if}}
        <span class='pretui-resultcard-title'>{{@title}}</span>
        {{#if @onMenu}}
          <button
            type='button'
            class='pretui-resultcard-menu'
            aria-label={{this.menuLabel}}
            {{on 'click' this.menu}}
            data-test-pretui-result-card-menu
          ><DotsIcon width='14' height='14' aria-hidden='true' /></button>
        {{/if}}
      </div>
      {{#each @lines as |line|}}<div
          class='pretui-resultcard-line'
        >{{line}}</div>{{/each}}
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-resultcard {
          background-color: var(--card);
          color: var(--card-foreground);
          border-radius: var(--boxel-border-radius-sm);
          box-shadow: var(--pretui-shadow-hairline, 0 0 0 1px var(--border));
          padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-4xs);
        }
        .pretui-resultcard-head {
          display: flex;
          align-items: baseline;
          gap: var(--boxel-sp-xs);
        }
        .pretui-resultcard-title {
          font-weight: 600;
          font-size: var(--boxel-ui-label-font-size);
          line-height: var(--boxel-ui-label-line-height);
          color: var(--foreground);
        }
        /* a label, not a kicker: sans caption, no tracking, no caps */
        .pretui-eyebrow {
          font-size: var(--boxel-caption-font-size);
          line-height: var(--boxel-caption-line-height);
          font-weight: 400;
          color: var(--subtle-foreground);
        }
        /* 1.5rem square, the least a pointer target takes */
        .pretui-resultcard-menu {
          display: inline-grid;
          place-items: center;
          flex: none;
          align-self: center;
          width: 1.5rem;
          height: 1.5rem;
          margin-inline-start: auto;
          padding: 0;
          border: 0;
          border-radius: var(--boxel-border-radius-xs);
          background-color: transparent;
          color: var(--subtle-foreground);
          cursor: pointer;
        }
        .pretui-resultcard-menu:hover {
          background-color: var(--hover);
          color: var(--foreground);
        }
        .pretui-resultcard-menu:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 1px;
        }
        .pretui-resultcard-line {
          font-size: var(--boxel-ui-label-font-size);
          line-height: var(--boxel-ui-label-line-height);
          color: var(--muted-foreground);
        }
      }
    </style>
  </template>
}
