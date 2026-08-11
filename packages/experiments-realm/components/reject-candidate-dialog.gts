import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { not } from '@cardstack/boxel-ui/helpers';
import {
  Modal,
  RadioInput,
  BoxelInput,
  Button,
} from '@cardstack/boxel-ui/components';

import { REJECTION_REASON_OPTIONS } from '../rejection-reason-field';

interface RejectCandidateDialogSignature {
  Args: {
    isOpen: boolean;
    candidateName?: string;
    onConfirm: (reason: string, note: string) => void;
    onCancel: () => void;
  };
  Element: HTMLElement;
}

// Plain Glimmer component (not a card/field) so the tracker can pop it once
// near the top of the template instead of per-candidate-card. Replaces the
// globalThis.prompt() flow that used to collect a free-text rejection reason.
export class RejectCandidateDialog extends GlimmerComponent<RejectCandidateDialogSignature> {
  reasonItems = REJECTION_REASON_OPTIONS.map((opt) => ({
    id: opt.value,
    text: opt.label,
  }));

  @tracked reason: string | undefined;
  @tracked note = '';

  private reset() {
    this.reason = undefined;
    this.note = '';
  }

  get showNoteField(): boolean {
    return this.reason === 'other';
  }

  get canConfirm(): boolean {
    if (!this.reason) {
      return false;
    }
    if (this.reason === 'other' && !this.note.trim()) {
      return false;
    }
    return true;
  }

  get title(): string {
    return this.args.candidateName
      ? `Reject ${this.args.candidateName}?`
      : 'Reject candidate?';
  }

  setReason = (id: string) => {
    this.reason = id;
  };

  setNote = (value: string) => {
    this.note = value;
  };

  confirm = () => {
    if (!this.canConfirm || !this.reason) {
      return;
    }
    let reason = this.reason;
    let note = this.note.trim();
    this.reset();
    this.args.onConfirm(reason, note);
  };

  // Reset happens on the way out (cancel or confirm), not on open — a getter
  // that mutates tracked state to react to a just-opened prop risks Ember's
  // "backtracking rerender" assertion. Resetting on close has the same
  // observable effect: the dialog can only reopen after one of these fires.
  cancel = () => {
    this.reset();
    this.args.onCancel();
  };

  <template>
    <Modal
      @isOpen={{@isOpen}}
      @onClose={{this.cancel}}
      @size='small'
      @centered={{true}}
    >
      <div class='reject-dialog' role='dialog' aria-label={{this.title}}>
        <h2 class='rd-title'>{{this.title}}</h2>
        <p class='rd-sub'>Choose a reason — it drives the rejection-reason
          breakdown on the Offers dashboard.</p>

        <RadioInput
          @items={{this.reasonItems}}
          @groupDescription='Rejection reason'
          @checkedId={{this.reason}}
          @orientation='vertical'
          @spacing='compact'
          as |item|
        >
          <item.component @onChange={{fn this.setReason item.data.id}}>
            {{item.data.text}}
          </item.component>
        </RadioInput>

        {{#if this.showNoteField}}
          <label class='rd-note-label' for='reject-dialog-note'>Details
            (required for "Other")</label>
          <BoxelInput
            id='reject-dialog-note'
            @type='textarea'
            @value={{this.note}}
            @onInput={{this.setNote}}
            placeholder='What happened?'
          />
        {{/if}}

        <div class='rd-actions'>
          <Button @kind='secondary' {{on 'click' this.cancel}}>Cancel</Button>
          <Button
            @kind='destructive'
            @disabled={{not this.canConfirm}}
            {{on 'click' this.confirm}}
          >Confirm rejection</Button>
        </div>
      </div>
    </Modal>
    <style scoped>
      .reject-dialog {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
        padding: var(--boxel-sp-lg);
        background: var(--card, var(--boxel-light));
        color: var(--card-foreground, var(--foreground, var(--boxel-dark)));
        border-radius: var(--boxel-border-radius);
      }
      .rd-title {
        margin: 0;
        font-size: var(--boxel-font-size-lg);
        font-weight: 700;
      }
      .rd-sub {
        margin: 0;
        font-size: var(--boxel-font-size-sm);
        color: var(--muted-foreground, var(--boxel-450));
      }
      .rd-note-label {
        font-size: var(--boxel-font-size-xs);
        font-weight: 600;
        color: var(--muted-foreground, var(--boxel-450));
      }
      .rd-actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--boxel-sp-xs);
        margin-top: var(--boxel-sp-xs);
      }
    </style>
  </template>
}
