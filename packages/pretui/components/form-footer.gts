// Pretui — FormFooter: the docked footer that saves or discards a batch of edits.
import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { guidFor } from '@ember/object/internals';
import { Button } from './button';
import { iconFor } from '../icon-registry';
import type { FormIssue } from '../internal/forms-core';
import { blockingCount, plural } from '../internal/forms-record';

// ── FormFooter ───────────────────────────────────────────────────────────
//
// Ported from SLDS `docked-form-footer/base` (`.slds-docked-form-footer`).
//
// BETTER THAN THE INSPIRATION:
//   • SLDS is `position: fixed; bottom: 0; left: 0; width: 100%` at an
//     overlay z-index. Inside a Boxel card that is a bug, not a style: the
//     bar escapes the card's bounding box and floats over the whole host
//     app, and `position: fixed` is lint-flagged in this codebase for
//     exactly that reason. Ours is `position: sticky; bottom: 0` — it docks
//     to the bottom of the form's own scroll container and stays inside the
//     card. Callers who want normal flow pass @dock='static'.
//   • SLDS shows no count of what is pending. A batched save that will not
//     say how much it is about to write is asking for blind trust. Ours
//     states the count in an `aria-live='polite'` region, so the number is
//     announced as fields are edited and undone.
//   • SLDS's error state is a bare icon button plus a hand-positioned
//     Popover at a hardcoded z-index. Ours states the blocking-error count
//     as text, disables Save, and points Save's `aria-describedby` at that
//     text — so the reason a control is disabled is actually reachable.
//   • SLDS's buttons are `slds-button_neutral` / `_brand` literals; ours are
//     the kit's Button, so tone/appearance travel with the theme.
//
// DROPPED FROM UPSTREAM (and why): the error Popover. Popover
// is the right tool and the footer should not grow a second one — a caller
// who wants a click-to-jump error list puts it in the <:status> block.
export interface FormFooterSignature {
  Args: {
    /** How many fields carry a committed-but-unsaved edit. Drives the live
     *  status line and whether Save is enabled. @default 0 */
    count?: number;
    /** Already-computed issues for the whole form. Blocking ones (severity
     *  'error', or anything unrecognised) disable Save and are counted in
     *  the status line. Never evaluated here. */
    issues?: FormIssue[];
    /** Save is in flight: the button goes busy and both actions lock. */
    saving?: boolean;
    /** Hard-disable Save regardless of count (a permission gate, say). */
    disabled?: boolean;
    /** Label for the commit action. @default 'Save' */
    saveLabel?: string;
    /** Label for the discard action. @default 'Cancel' */
    cancelLabel?: string;
    /** 'sticky' docks the bar to the bottom of the nearest scroll container
     *  — the SLDS behaviour minus the escaped bounding box. 'static' leaves
     *  it in normal flow. @default 'sticky' */
    dock?: 'sticky' | 'static';
    /** Invoked when the user commits the batch. */
    onSave?: () => void;
    /** Invoked when the user discards the batch. */
    onCancel?: () => void;
  };
  Blocks: {
    /** Replaces the generated status line entirely — yours to write when
     *  the count sentence is wrong for the domain. */
    status: [];
    /** Extra actions rendered before Cancel/Save (a "Save & New", say). */
    actions: [];
  };
  Element: HTMLDivElement;
}

export class FormFooter extends Component<FormFooterSignature> {
  statusId = `${guidFor(this)}-status`;

  get count(): number {
    return this.args.count ?? 0;
  }
  get dock(): string {
    return this.args.dock === 'static' ? 'static' : 'sticky';
  }
  get errorCount(): number {
    return blockingCount(this.args.issues);
  }
  get hasErrors(): boolean {
    return this.errorCount > 0;
  }
  get saveDisabled(): boolean {
    return (
      Boolean(this.args.disabled) ||
      Boolean(this.args.saving) ||
      this.hasErrors ||
      this.count === 0
    );
  }
  get statusText(): string {
    if (this.hasErrors) {
      let n = this.errorCount;
      return `${n} ${plural(n, 'error', 'errors')} to resolve before saving`;
    }
    if (this.count === 0) {
      return 'No unsaved changes';
    }
    return `${this.count} unsaved ${plural(this.count, 'change', 'changes')}`;
  }
  get statusTone(): string {
    if (this.hasErrors) {
      return 'error';
    }
    return this.count === 0 ? 'clean' : 'dirty';
  }

  save = (_event: Event) => {
    this.args.onSave?.();
  };
  cancel = (_event: Event) => {
    this.args.onCancel?.();
  };

  <template>
    <div
      class='pretui-formfooter'
      data-dock={{this.dock}}
      data-state={{this.statusTone}}
      data-test-pretui-form-footer
      ...attributes
    >
      <div class='pretui-formfooter-row'>
        <div
          class='pretui-formfooter-status'
          id={{this.statusId}}
          role='status'
          aria-live='polite'
          data-test-pretui-form-footer-status
        >
          {{#if (has-block 'status')}}
            {{yield to='status'}}
          {{else}}
            {{#if this.hasErrors}}
              {{#let (iconFor 'circle-alert') as |ErrorIcon|}}
                {{#if ErrorIcon}}
                  <ErrorIcon class='pretui-formfooter-icon' aria-hidden='true' />
                {{/if}}
              {{/let}}
            {{/if}}
            <span>{{this.statusText}}</span>
          {{/if}}
        </div>
        <div class='pretui-formfooter-actions'>
          {{#if (has-block 'actions')}}{{yield to='actions'}}{{/if}}
          <Button
            @tone='neutral'
            @appearance='outlined'
            @disabled={{@saving}}
            {{on 'click' this.cancel}}
            data-test-pretui-form-footer-cancel
          >{{if @cancelLabel @cancelLabel 'Cancel'}}</Button>
          <Button
            @tone='primary'
            @appearance='accent'
            @busy={{@saving}}
            @disabled={{this.saveDisabled}}
            aria-describedby={{this.statusId}}
            {{on 'click' this.save}}
            data-test-pretui-form-footer-save
          >{{if @saveLabel @saveLabel 'Save'}}</Button>
        </div>
      </div>
    </div>
    <style scoped>
      @layer PretComponent {
        /* container-type on the ROOT, the query on the inner row — an unnamed
           container query resolves against the nearest ANCESTOR container, so
           a rule can never match the container element itself. */
        .pretui-formfooter {
          container-type: inline-size;
          background: var(--card);
          border-radius: 0 0 var(--radius-surface, 10px)
            var(--radius-surface, 10px);
          box-shadow: var(
            --pretui-shadow-raised,
            0 -1px 0 var(--border),
            0 -6px 16px var(--shadow-ink-soft, rgb(16 24 40 / 0.06))
          );
        }
        /* sticky, never fixed: the bar docks to the bottom of the form's own
           scroll container and cannot leave the card's bounding box. */
        .pretui-formfooter[data-dock='sticky'] {
          position: sticky;
          bottom: 0;
          z-index: 2;
        }
        .pretui-formfooter[data-dock='static'] {
          position: static;
        }
        .pretui-formfooter-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--space-4, 11px);
          padding: var(--space-3, 8px) var(--space-5, 14px);
        }
        .pretui-formfooter-status {
          display: flex;
          align-items: center;
          gap: 6px;
          min-width: 0;
          font-size: var(--text-ui, 12px);
          color: var(--muted-foreground);
        }
        .pretui-formfooter[data-state='dirty'] .pretui-formfooter-status {
          color: color-mix(
            in oklch,
            var(--foreground) 30%,
            var(--warning, var(--boxel-warning))
          );
          font-weight: 500;
        }
        .pretui-formfooter[data-state='error'] .pretui-formfooter-status {
          color: var(--pretui-destructive-ink, var(--boxel-danger));
          font-weight: 500;
        }
        .pretui-formfooter-icon {
          width: 13px;
          height: 13px;
          flex: none;
        }
        .pretui-formfooter-actions {
          display: flex;
          align-items: center;
          gap: var(--space-3, 8px);
          flex: none;
        }
        @container (max-width: 26rem) {
          .pretui-formfooter-row {
            flex-direction: column;
            align-items: stretch;
            gap: var(--space-3, 8px);
          }
          .pretui-formfooter-actions {
            justify-content: flex-end;
          }
        }
      }
    </style>
  </template>
}
