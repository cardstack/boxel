// Pretui — ColorField usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { ColorField } from './color-field';
import { FreestyleUsage } from './freestyle-usage';

const PRESETS = [
  '#0f172a',
  '#dc2626',
  '#f59e0b',
  '#059669',
  '#2563eb',
  '#7c3aed',
];

// ── ColorField ───────────────────────────────────────────────────────────
class ColorFieldUsage extends Component {
  @tracked value = '#2563eb';
  @tracked labelText = 'Brand colour';
  @tracked description = 'Used for primary buttons and links.';
  @tracked required = false;
  presets = PRESETS;
  setValue = (v: string) => (this.value = v);
  setLabel = (v: string) => (this.labelText = v);
  setDescription = (v: string) => (this.description = v);
  setRequired = (v: boolean) => (this.required = v);
  get usage() {
    return "<ColorField @label='Brand colour' @value={{this.value}} @presets={{this.presets}} @onValueChange={{this.setValue}} />";
  }
  <template>
    <FreestyleUsage
      @name='ColorField'
      @description='The small surface that opens the picker: a labelled form field whose control is a swatch trigger plus the hex, with the full picker in a popover. Composed, not rebuilt — FormField owns the label, description, required marking and issue routing; Popover owns placement, Escape and focus return.'
      @source={{this.usage}}
    >
      <:example>
        <ColorField
          @label={{this.labelText}}
          @value={{this.value}}
          @description={{this.description}}
          @required={{this.required}}
          @presets={{this.presets}}
          @onValueChange={{this.setValue}}
        />
      </:example>
      <:api as |Args|>
        <Args.String
          @name='label'
          @description='Field label.'
          @value={{this.labelText}}
          @onInput={{this.setLabel}}
        />
        <Args.String
          @name='value'
          @description='Any CSS colour string.'
          @value={{this.value}}
          @onInput={{this.setValue}}
        />
        <Args.String
          @name='description'
          @description='Helper prose under the control.'
          @value={{this.description}}
          @onInput={{this.setDescription}}
        />
        <Args.Bool
          @name='required'
          @defaultValue={{false}}
          @value={{this.required}}
          @onInput={{this.setRequired}}
        />
        <Args.Object
          @name='presets'
          @description='Quick-pick swatches shown above the picker in the popover.'
          @value={{this.presets}}
        />
        <Args.Action
          @name='onValueChange'
          @description='Receives the chosen colour string.'
        />
      </:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_COLOR_FIELD: Record<string, unknown> = {
  ColorField: ColorFieldUsage,
};
