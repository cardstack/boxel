// Pretui — CollapsedTurn: a settled conversation turn folded to a one-line receipt.
import Component from '@glimmer/component';
import { on } from '@ember/modifier';

export interface CollapsedTurnSignature {
  Args: { summary: string; onExpand?: () => void };
  Element: HTMLButtonElement;
}

// Settled history earns its quiet: a receipt of counts, not content.
export class CollapsedTurn extends Component<CollapsedTurnSignature> {
  expand = () => this.args.onExpand?.();
  <template>
    <button type='button' class='pretui-collapsed' data-test-pretui-collapsed-turn {{on 'click' this.expand}} ...attributes>
      <span class='pretui-collapsed-check'>✓</span>{{@summary}}
    </button>
    <style scoped>
      @layer PretComponent {
        .pretui-collapsed {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          height: 24px;
          padding: 0 calc(5px * var(--pretui-capsule-base, 1.35) + 12px * var(--pretui-radius-encroach, 0.35));
          border-radius: 12px;
          border: 0;
          background: var(--inset, var(--boxel-100));
          box-shadow: var(--pretui-shadow-hairline, 0 0 0 1px var(--border));
          font: inherit;
          font-size: var(--text-ui-sm, 11.5px);
          color: var(--muted-foreground);
          cursor: pointer;
          font-variant-numeric: tabular-nums;
        }
        .pretui-collapsed:hover {
          background: var(--hover, var(--boxel-100));
        }
        .pretui-collapsed-check {
          color: var(--success, var(--boxel-success));
        }
      }
    </style>
  </template>
}
