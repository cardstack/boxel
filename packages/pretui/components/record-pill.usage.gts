// Pretui — RecordPill usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { FreestyleUsage } from './freestyle-usage';
import { Button } from './button';
import { RecordPill } from './record-pill';
import type { PickerRecord } from '../internal/forms-picker';
import { ACCOUNTS } from '../internal/forms-picker-fixtures';

// ── RecordPill ───────────────────────────────────────────────────────────
// The removable capsule Lookup renders for each selection, exported on its
// own so every record-valued form control shows a selection identically.
// Where SLDS puts each pill in a role='option' with a remove <button> inside
// (option has children presentational — the button is never exposed), this is
// a plain span with a real, individually named button.
class RecordPillUsage extends Component {
  records = ACCOUNTS.slice(0, 3);
  @tracked removed: string[] = [];
  @tracked removable = true;
  @tracked disabled = false;

  get shown(): PickerRecord[] {
    return this.records.filter((r) => !this.removed.includes(r.id));
  }
  remove = (record: PickerRecord) => {
    this.removed = [...this.removed, record.id];
  };
  restore = () => (this.removed = []);
  setRemovable = (v: boolean) => (this.removable = v);
  setDisabled = (v: boolean) => (this.disabled = v);

  get usage() {
    let bits = ['@record={{record}}'];
    if (!this.removable) {
      bits.push('@removable={{false}}');
    }
    if (this.disabled) {
      bits.push('@disabled={{true}}');
    }
    bits.push('@onRemove={{this.remove}}');
    return `{{#each this.records as |record|}}\n  <RecordPill ${bits.join(' ')} />\n{{/each}}`;
  }

  <template>
    <FreestyleUsage
      @name='RecordPill'
      @description='A selected record as a removable capsule — the selection surface shared by Lookup and any sibling form control that holds record references. Composes RecordFace at sm size (icon or initials Avatar, then the label) and adds one real, individually named remove button, so a screen reader hears “Remove Wuyi Origins, button” rather than nothing at all. Use it wherever a chosen record has to be visible and revocable outside a dropdown.'
      @source={{this.usage}}
    >
      <:example>
        <div class='pillrow'>
          {{#each this.shown key='id' as |record|}}
            <RecordPill
              @record={{record}}
              @removable={{this.removable}}
              @disabled={{this.disabled}}
              @onRemove={{this.remove}}
            />
          {{/each}}
          {{#unless this.shown.length}}
            <Button @variant='secondary' {{on 'click' this.restore}}>
              Restore records
            </Button>
          {{/unless}}
        </div>
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='record'
          @required={{true}}
          @description='The record shown in the pill: {id, label, meta?, icon?}. Only the label and icon render at pill size.'
          @value={{this.records}}
        />
        <Args.Bool
          @name='removable'
          @defaultValue={{true}}
          @description='Render the remove button.'
          @value={{this.removable}}
          @onInput={{this.setRemovable}}
        />
        <Args.Bool
          @name='disabled'
          @defaultValue={{false}}
          @description='Dims the capsule and suppresses the remove button.'
          @value={{this.disabled}}
          @onInput={{this.setDisabled}}
        />
        <Args.Action
          @name='onRemove'
          @description='Fires with the record when the remove button is pressed.'
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .pillrow {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--space-2, 5px);
      }
    </style>
  </template>
}

export const DEMOS_RECORD_PILL: Record<string, unknown> = {
  RecordPill: RecordPillUsage,
};
