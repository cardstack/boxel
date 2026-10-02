// Pretui — QueuedMessage: a message waiting to be sent while the agent is busy.
import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { Button } from './button';

export interface QueuedMessageSignature {
  Args: {
    text: string;
    mode?: 'steer' | 'now';
    onSendNow?: () => void;
    onEdit?: () => void;
  };
  Element: HTMLDivElement;
}

// Per-message delivery semantics, stated in the UI: Send now interrupts;
// Steer is delivered at the next checkpoint.
export class QueuedMessage extends Component<QueuedMessageSignature> {
  get mode() {
    return this.args.mode ?? 'steer';
  }
  get modeLabel() {
    return this.mode === 'now' ? 'send now' : 'steer';
  }
  get semantics() {
    return this.mode === 'now' ? 'interrupts the run' : 'delivered at next checkpoint';
  }
  get canSendNow() {
    return this.mode !== 'now' && this.args.onSendNow;
  }
  edit = () => this.args.onEdit?.();
  sendNow = () => this.args.onSendNow?.();
  <template>
    <div class='pretui-queued' data-test-pretui-queued-message ...attributes>
      <span class='pretui-queued-mode'>{{this.modeLabel}}</span>
      <span class='pretui-queued-text'>{{@text}}</span>
      <span class='pretui-queued-note'>{{this.semantics}}</span>
      {{#if @onEdit}}<Button @variant='ghost' class='pretui-queued-btn' {{on 'click' this.edit}}>Edit</Button>{{/if}}
      {{#if this.canSendNow}}<Button @variant='ghost' class='pretui-queued-btn' {{on 'click' this.sendNow}}>Send now</Button>{{/if}}
    </div>
    <style scoped>
      /* above Button's layer, so these win by layer order, not file order */
      @layer PretComponent, PretComposite;
      @layer PretComposite {
        .pretui-queued {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 7px 10px;
          border-radius: 8px;
          background: var(--field, var(--boxel-light));
          box-shadow: 0 0 0 1px var(--border);
          font-size: var(--text-ui-md, 12.5px);
        }
        .pretui-queued-mode {
          font-family: var(--font-mono);
          font-size: 9.5px;
          font-weight: 600;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--pretui-primary-ink, var(--primary));
          flex: none;
        }
        .pretui-queued-text {
          flex: 1;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .pretui-queued-note {
          font-size: var(--text-ui-xs, 11px);
          color: var(--ink-3, var(--boxel-400));
          flex: none;
        }
        :deep(.pretui-queued-btn) {
          height: 22px;
          padding: 0 7px;
        }
      }
    </style>
  </template>
}
