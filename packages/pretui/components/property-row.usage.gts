// Pretui — PropertyRow usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { PropertyRow } from './property-row';
import { ScrubInput } from './scrub-input';

// ── PropertyRow ──────────────────────────────────────────────────────────
const LAYOUTS = ['row', 'stack', 'split'];

class PropertyRowUsage extends Component {
  layoutOptions = LAYOUTS;

  @tracked layout = 'row';
  @tracked labelText = 'Opacity';
  @tracked hint = '';
  @tracked mixed = false;
  @tracked modified = true;
  @tracked disabled = false;
  @tracked value: number | null = 80;

  setLayout = (v: string) => (this.layout = v);
  setLabel = (v: string) => (this.labelText = v);
  setHint = (v: string) => (this.hint = v);
  setMixed = (v: boolean) => (this.mixed = v);
  setModified = (v: boolean) => (this.modified = v);
  setDisabled = (v: boolean) => (this.disabled = v);
  setValue = (v: number | null) => (this.value = v);
  reset = () => {
    this.value = 100;
    this.modified = false;
  };

  get layoutVal() {
    return this.layout as 'row' | 'stack' | 'split';
  }
  get usage() {
    return (
      "<PropertyRow @label='" +
      this.labelText +
      "' @modified={{this.modified}} @onReset={{this.reset}} as |controlId hintId|>\n" +
      '  <ScrubInput @controlId={{controlId}} @describedBy={{hintId}} … />\n' +
      '</PropertyRow>'
    );
  }
  <template>
    <FreestyleUsage
      @name='PropertyRow'
      @description='The inspector atom: a property name, its control, and the two states a property panel cannot work without — MIXED (multi-selection) and MODIFIED (differs from default, offering a reset). Ported from figui3 fig-field. Distinct from Field, which is the stacked FORM field with a reserved validation line; PropertyRow is dense, label-in-a-column, and carries reset/mixed.'
      @source={{this.usage}}
    >
      <:example>
        <div class='pretui-property-demo'>
          <PropertyRow
            @label={{this.labelText}}
            @layout={{this.layoutVal}}
            @hint={{this.hint}}
            @mixed={{this.mixed}}
            @modified={{this.modified}}
            @disabled={{this.disabled}}
            @onReset={{this.reset}}
            as |controlId hintId|
          >
            <ScrubInput
              @controlId={{controlId}}
              @describedBy={{hintId}}
              @label={{this.labelText}}
              @value={{this.value}}
              @min={{0}}
              @max={{100}}
              @unit='%'
              @precision={{0}}
              @mixed={{this.mixed}}
              @disabled={{this.disabled}}
              @onInput={{this.setValue}}
            />
          </PropertyRow>
        </div>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='label'
          @value={{this.labelText}}
          @description='Property name, wired to the yielded controlId with a real <label for>.'
          @onInput={{this.setLabel}}
        />
        <Args.String
          @name='layout'
          @defaultValue='row'
          @value={{this.layout}}
          @options={{this.layoutOptions}}
          @description="'row' is the dense inspector shape (fixed label column); 'stack' puts the label above; 'split' gives both halves. A pane under 240px folds to stack automatically via an unnamed container query."
          @onInput={{this.setLayout}}
        />
        <Args.String
          @name='hint'
          @value={{this.hint}}
          @description='Short explanation under the control; its id is the second yielded value, for aria-describedby.'
          @onInput={{this.setHint}}
        />
        <Args.Bool
          @name='mixed'
          @defaultValue={{false}}
          @value={{this.mixed}}
          @description='Multi-selection. Renders the word “Mixed” beside the label — a text channel, not a colour or a bare dash.'
          @onInput={{this.setMixed}}
        />
        <Args.Bool
          @name='modified'
          @defaultValue={{false}}
          @value={{this.modified}}
          @description='Differs from default. Reveals the reset control (or an accessible dot when no @onReset is given).'
          @onInput={{this.setModified}}
        />
        <Args.Bool
          @name='disabled'
          @defaultValue={{false}}
          @value={{this.disabled}}
          @description='Dims the row and marks it aria-disabled; the control itself is the caller’s to disable.'
          @onInput={{this.setDisabled}}
        />
        <Args.String
          @name='labelWidth'
          @description='Label column width in row layout. Validated against a length whitelist before it reaches CSS — a caller string can never become a declaration.'
        />
        <Args.Action
          @name='onReset'
          @description='Invoked by the reset control.'
        />
        <Args.Yield
          @description='Default block yields (controlId, hintId). Named blocks: label (replaces the text label with a control) and actions (trailing affordances).'
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .pretui-property-demo {
        max-width: 300px;
        container-type: inline-size;
      }
    </style>
  </template>
}

export const DEMOS_PROPERTY_ROW: Record<string, unknown> = {
  PropertyRow: PropertyRowUsage,
};
