// Pretui — FilterSet usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { FilterSet } from './filter-set';
import { newCondition } from '../internal/forms-expression';
import type { ExpressionCondition, ExpressionLogic } from '../internal/forms-expression';
import { LOGIC_KNOB, REQUEST_RESOURCES, condition } from '../demo-forms-expression';

// ── FilterSet ← SLDS expression/filters ──────────────────────────────────
//
// Dropped upstream knobs: `slds-is-new` / `slds-is-locked` item states (no
// consumer yet); `ExpressionNarrowGroup` (nested groups, same reason as the
// builder); the in-list `ExpressionOptions` combobox — this variant is the
// read-only face, and the joiner is changed in the builder beside it.
class FilterSetUsage extends Component {
  logicOptions = LOGIC_KNOB;
  resources = REQUEST_RESOURCES;

  @tracked conditions: ExpressionCondition[] = [
    condition('Supplier', '=', 'Wuyi Origins'),
    condition('Total', '>', '5000'),
    condition('Stage', '!=', 'Closed Lost'),
    condition('"Line Item"[SKU = "DHP-04"].Quantity', '>=', '12'),
  ];
  @tracked logic: ExpressionLogic = 'all';
  @tracked customLogic = '1 AND (2 OR 3)';
  @tracked activeId = '';
  @tracked lastAction = '—';
  @tracked titleText = 'Saved view filters';

  setLogic = (v: string) => (this.logic = v as ExpressionLogic);
  setCustomLogic = (v: string) => (this.customLogic = v);
  setTitle = (v: string) => (this.titleText = v);

  edit = (id: string) => {
    this.activeId = id;
    this.lastAction = `edit ${id}`;
  };
  remove = (id: string) => {
    this.conditions = this.conditions.filter((c) => c.id !== id);
    this.lastAction = `remove ${id}`;
  };
  add = () => {
    let created = newCondition();
    this.conditions = [...this.conditions, created];
    this.activeId = created.id;
    this.lastAction = 'add';
  };

  get usage() {
    return `<FilterSet\n  @conditions={{this.conditions}}\n  @logic='${this.logic}'\n  @customLogic='${this.customLogic}'\n  @resources={{this.resources}}\n  @activeId='${this.activeId}'\n  @onEdit={{this.edit}}\n  @onRemove={{this.remove}}\n  @onAdd={{this.add}}\n/>`;
  }

  <template>
    <FreestyleUsage
      @name='FilterSet'
      @description="The narrow, read-only face of the same condition model — SLDS's filters variant, the sidebar beside a list view where each condition collapses to one line of prose. Reach for it when the conditions are context rather than the task: a saved view's filters, a rule summary on a record page, a preview column beside the builder. Every entry is a real list item with a real button; the AND/OR joiner is aria-hidden chrome because the relationship is carried by the list's accessible name instead of being read out as a stray word. It renders — it never edits: the callbacks hand ids back to whoever owns the model."
      @source={{this.usage}}
    >
      <:example>
        <div class='fs-demo-frame'>
          <FilterSet
            @conditions={{this.conditions}}
            @logic={{this.logic}}
            @customLogic={{this.customLogic}}
            @resources={{this.resources}}
            @title={{this.titleText}}
            @activeId={{this.activeId}}
            @onEdit={{this.edit}}
            @onRemove={{this.remove}}
            @onAdd={{this.add}}
          />
        </div>
        <p class='pretui-demo-readout' data-test-fs-readout>
          last action → {{this.lastAction}}
        </p>
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='conditions'
          @value={{this.conditions}}
          @description='The rows to summarise. Same shape the builder edits; an incomplete row is rendered in the muted, italic state rather than being hidden.'
        />
        <Args.String
          @name='logic'
          @defaultValue='all'
          @value={{this.logic}}
          @options={{this.logicOptions}}
          @description='Which joiner word appears between entries, and what the list announces as its accessible name. custom echoes the logic string above the list verbatim; always replaces the list entirely.'
          @onInput={{this.setLogic}}
        />
        <Args.String
          @name='customLogic'
          @value={{this.customLogic}}
          @description='Echoed as a Token above the list when @logic is custom. Never re-derived here — this component summarises, it does not author.'
          @onInput={{this.setCustomLogic}}
        />
        <Args.Object
          @name='resources'
          @value={{this.resources}}
          @description='So the summaries read with field LABELS (“Line item DHP-04 · Quantity”) rather than raw BXL label paths.'
        />
        <Args.String
          @name='title'
          @defaultValue='Conditions'
          @value={{this.titleText}}
          @description='Heading beside the funnel icon, and the stem of the list’s accessible name.'
          @onInput={{this.setTitle}}
        />
        <Args.String
          @name='activeId'
          @value={{this.activeId}}
          @description='Highlights the row currently open in the editor beside this list. Ring only — it never changes what the row announces.'
        />
        <Args.Action
          @name='onEdit'
          @description='Supplying it reveals a per-row edit button, whose accessible name carries the row number AND its summary, so a screen-reader user knows which condition the button opens without leaving it.'
        />
        <Args.Action
          @name='onRemove'
          @description='Supplying it reveals a per-row remove button, named the same way.'
        />
        <Args.Action
          @name='onAdd'
          @description='Supplying it reveals the add button under the list.'
        />
        <Args.Yield
          @name=':footer'
          @description='Extra controls under the list, beside Add condition.'
        />
      </:api>
    </FreestyleUsage>

    <style scoped>
      .fs-demo-frame {
        max-width: 21rem;
      }
    </style>
  </template>
}

export const DEMOS_FILTER_SET: Record<string, unknown> = {
  FilterSet: FilterSetUsage,
};
