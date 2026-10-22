// Pretui — RecordPill: a removable chip for a picked record.
import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { RecordFace } from './record-face';
import type { PickerRecord } from '../internal/forms-picker';

// ── RecordPill ───────────────────────────────────────────────────────────
// A selected record as a removable capsule. Built as its own primitive (not
// buried in Lookup) because every record-valued form control needs it.
//
// Chip is the kit's capsule, but it is an 18px status marker with
// no room for a 16px hit target; MultiSelect already set the precedent of a
// purpose-built chip for removable selections. This one carries the FilterChips
// capsule dress at 24px with a real, individually-named remove button.
export interface RecordPillSignature {
  Args: {
    /** The record shown in the pill. */
    record: PickerRecord;
    /** Render the remove button — true by default. */
    removable?: boolean;
    /** Suppresses the remove button and dims the capsule. */
    disabled?: boolean;
    /** Called with the record when the remove button is pressed. */
    onRemove?: (record: PickerRecord) => void;
  };
  Element: HTMLSpanElement;
}

export class RecordPill extends Component<RecordPillSignature> {
  get removable() {
    return (this.args.removable ?? true) && !this.args.disabled;
  }
  get removeLabel() {
    return `Remove ${this.args.record?.label ?? 'item'}`;
  }
  handleRemove = () => {
    if (this.args.record) {
      this.args.onRemove?.(this.args.record);
    }
  };
  <template>
    <span
      class='pretui-rpill'
      data-disabled={{if @disabled 'true'}}
      data-test-pretui-record-pill={{@record.id}}
      ...attributes
    >
      <RecordFace @record={{@record}} @size='sm' />
      {{#if this.removable}}
        <button
          type='button'
          class='pretui-rpill-x'
          aria-label={{this.removeLabel}}
          title={{this.removeLabel}}
          {{on 'click' this.handleRemove}}
        >
          <svg
            width='8'
            height='8'
            viewBox='0 0 8 8'
            aria-hidden='true'
          ><path
              d='M1.5 1.5 6.5 6.5 M6.5 1.5 1.5 6.5'
              fill='none'
              stroke='currentColor'
              stroke-width='1.4'
              stroke-linecap='round'
            /></svg>
        </button>
      {{/if}}
    </span>
    <style scoped>
      @layer PretComponent {
        .pretui-rpill {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          min-height: 24px;
          max-width: 100%;
          border-radius: 12px;
          padding: 2px 3px 2px 4px;
          background: var(--card);
          box-shadow: var(
            --pretui-shadow-control,
            0 0 0 1px var(--border)
          );
          color: var(--foreground);
        }
        .pretui-rpill[data-disabled] {
          opacity: 0.55;
        }
        .pretui-rpill-x {
          border: 0;
          background: none;
          padding: 0;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          display: inline-grid;
          place-content: center;
          color: var(--ink-3, var(--boxel-400));
          cursor: pointer;
          flex: none;
        }
        .pretui-rpill-x:hover {
          background: var(--hover, var(--boxel-100));
          color: var(--foreground);
        }
        .pretui-rpill-x:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 1px;
        }
      }
    </style>
  </template>
}
