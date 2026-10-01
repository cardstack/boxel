// Pretui — ApprovalFooter: the approve / reject bar for a change that needs a human decision.
import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { Button } from './button';

export interface ApprovalFooterSignature {
  Args: {
    count?: number;
    message?: string;
    destructive?: boolean;
    onKeep?: () => void;
    onRevert?: () => void;
    onAcceptAll?: () => void;
  };
  Element: HTMLDivElement;
}

// Destructive operations always ask, regardless of autonomy level.
export class ApprovalFooter extends Component<ApprovalFooterSignature> {
  get message() {
    if (this.args.message) {
      return this.args.message;
    }
    let n = this.args.count ?? 1;
    return `${n} change${n === 1 ? '' : 's'} await${n === 1 ? 's' : ''} your approval`;
  }
  get keepLabel() {
    return this.args.destructive ? 'Keep anyway' : 'Keep';
  }
  get keepVariant(): 'destructive' | 'primary' {
    return this.args.destructive ? 'destructive' : 'primary';
  }
  keep = () => this.args.onKeep?.();
  revert = () => this.args.onRevert?.();
  acceptAll = () => this.args.onAcceptAll?.();
  <template>
    <div class='pretui-approval' data-test-pretui-approval-footer ...attributes>
      <span class='pretui-approval-msg'>{{this.message}}</span>
      <span class='pretui-approval-actions'>
        {{#if @onAcceptAll}}<Button @variant='ghost' {{on 'click' this.acceptAll}}>Accept all</Button>{{/if}}
        <Button @variant='secondary' {{on 'click' this.revert}}>Revert</Button>
        <Button @variant={{this.keepVariant}} {{on 'click' this.keep}}>{{this.keepLabel}}</Button>
      </span>
    </div>
    <style scoped>
      .pretui-approval {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 8px 11px;
        border-radius: 0 0 10px 10px;
        box-shadow: 0 -1px 0 var(--border);
        background: color-mix(in oklch, var(--pretui-attention, var(--boxel-fuschia)) 7%, var(--card));
      }
      .pretui-approval-msg {
        font-size: var(--text-ui, 12px);
        color: var(--foreground);
        font-weight: 500;
      }
      .pretui-approval-actions {
        display: flex;
        gap: 7px;
      }
    </style>
  </template>
}
