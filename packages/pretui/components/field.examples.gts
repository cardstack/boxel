// Pretui — Field example gallery.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import type { ExampleSpec } from '../examples-kit';
import { Field } from './field';
import { Switch } from './switch';
import { Select } from './select';
import { MultiSelect } from './multi-select';
import { NativeSelect } from './native-select';
import { TreeSelect } from './tree-select';
import { Combobox } from './combobox';
import { Lookup } from './lookup';
import type { TreeNode } from './tree';
import type { PickerRecord } from '../internal/forms-picker';
import { ACCOUNTS } from '../internal/forms-picker-fixtures';

const GRADES = ['FTGFOP1', 'TGFOP', 'GFOP', 'FOP'].map((g) => ({
  value: g,
  label: g,
}));
const TEAS: TreeNode[] = [
  {
    id: 'green',
    label: 'Green',
    children: [
      { id: 'sencha', label: 'Sencha' },
      { id: 'matcha', label: 'Matcha' },
    ],
  },
  { id: 'puer', label: 'Pu-erh' },
];
const ERROR = 'Choose one the buyer accepts.';
const MULTI = ['GFOP'];
const TREE = ['sencha'];
const LOOKUP = [ACCOUNTS[0] as PickerRecord];
const RECORDS = ACCOUNTS as PickerRecord[];

// ── Each select-type control in a Field ─────────────────────────────────
class SelectControls extends Component {
  @tracked invalid = false;
  setInvalid = (v: boolean) => (this.invalid = v);
  get error() {
    return this.invalid ? ERROR : undefined;
  }
  <template>
    <div class='pretui-field-example'>
      <label class='pretui-field-example-toggle'>
        <Switch @checked={{this.invalid}} @onCheckedChange={{this.setInvalid}} />
        Invalid
      </label>
      <div class='pretui-field-example-grid'>
        <Field @label='Select' @error={{this.error}} as |controlId|>
          <Select @controlId={{controlId}} @options={{GRADES}} @value='TGFOP' />
        </Field>
        <Field @label='MultiSelect' @error={{this.error}}>
          <MultiSelect @label='MultiSelect' @options={{GRADES}} @value={{MULTI}} />
        </Field>
        <Field @label='NativeSelect' @error={{this.error}} as |controlId|>
          <NativeSelect @controlId={{controlId}} @options={{GRADES}} @value='FOP' />
        </Field>
        <Field @label='TreeSelect' @error={{this.error}}>
          <TreeSelect @label='TreeSelect' @nodes={{TEAS}} @value={{TREE}} />
        </Field>
        <Field @label='Combobox' @error={{this.error}}>
          <Combobox @label='Combobox' @options={{GRADES}} @value='FTGFOP1' />
        </Field>
        <Field @label='Lookup' @error={{this.error}}>
          <Lookup @label='Lookup' @records={{RECORDS}} @selected={{LOOKUP}} />
        </Field>
      </div>
    </div>
    <style scoped>
      .pretui-field-example {
        display: grid;
        gap: var(--boxel-sp);
        width: 100%;
      }
      .pretui-field-example-toggle {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        justify-self: start;
      }
      .pretui-field-example-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
        gap: var(--boxel-sp);
      }
    </style>
  </template>
}

export const EXAMPLES_FIELD: Record<string, ExampleSpec[]> = {
  Field: [
    {
      title: 'Each select-type control',
      note: 'Turn on Invalid and every trigger takes the --destructive-ink edge from the Field.',
      component: SelectControls,
    },
  ],
};
