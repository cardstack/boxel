// Pretui — Fold: settled work folded to receipt counts; indentation encodes containment only.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';

export interface FoldSignature {
  Args: {
    receipt: string;
    defaultOpen?: boolean;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  };
  Blocks: { default: [] };
  Element: HTMLDivElement;
}

// THE FOLD — indentation encodes containment only, never importance.
// One step = 14px under a hairline rail; settled work folds to counts.
export class Fold extends Component<FoldSignature> {
  @tracked internal = this.args.defaultOpen ?? false;
  get open() {
    return this.args.open ?? this.internal;
  }
  toggle = () => {
    let next = !this.open;
    if (this.args.open === undefined) {
      this.internal = next;
    }
    this.args.onOpenChange?.(next);
  };
  <template>
    <div class='pretui-fold' data-fold={{if this.open 'open' 'folded'}} data-test-pretui-fold ...attributes>
      <button type='button' class='pretui-collapsed' aria-expanded={{if this.open 'true' 'false'}} {{on 'click' this.toggle}}>
        <span class='pretui-fold-mark' data-open={{if this.open 'true'}}>{{if this.open '▾' '✓'}}</span>{{@receipt}}
      </button>
      {{#if this.open}}
        <div class='pretui-fold-children'>{{yield}}</div>
      {{/if}}
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-fold {
          display: grid;
          gap: 0;
        }
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
          justify-self: start;
        }
        .pretui-collapsed:hover {
          background: var(--hover, var(--boxel-100));
        }
        .pretui-fold-mark {
          color: var(--success, var(--boxel-success));
        }
        .pretui-fold-mark[data-open] {
          color: var(--muted-foreground);
        }
        .pretui-fold-children {
          margin-left: 7px;
          margin-top: 6px;
          padding-left: 14px;
          box-shadow: inset 1px 0 0 var(--border);
          display: grid;
          gap: 6px;
        }
        .pretui-fold-children :deep(.pretui-fold-children) {
          box-shadow: inset 1px 0 0 var(--line-strong, var(--boxel-400));
        }
      }
    </style>
  </template>
}
