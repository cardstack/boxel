// Pretui — Fieldset usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Fieldset } from './fieldset';
import { Checkbox } from './checkbox';
import { RadioGroup } from './radio-group';

const ROAST_OPTIONS = [
  { value: 'light', label: 'Light' },
  { value: 'medium', label: 'Medium' },
  { value: 'dark', label: 'Dark' },
];
const ORIENTATIONS = ['vertical', 'horizontal'];

export class FieldsetUsage extends Component {
  roastOptions = ROAST_OPTIONS;
  orientations = ORIENTATIONS;
  @tracked legend = 'Roast profile';
  @tracked description = 'Applied to every lot in this batch.';
  @tracked disabled = false;
  @tracked hideLegend = false;
  @tracked orientation = 'vertical';
  @tracked roast = 'medium';
  @tracked notes = true;
  setLegend = (v: string) => (this.legend = v);
  setDescription = (v: string) => (this.description = v);
  setDisabled = (v: boolean) => (this.disabled = v);
  setHideLegend = (v: boolean) => (this.hideLegend = v);
  setOrientation = (v: string) => (this.orientation = v);
  setRoast = (v: string) => (this.roast = v);
  setNotes = (v: boolean) => (this.notes = v);
  get orientationArg() {
    return this.orientation as 'vertical' | 'horizontal';
  }
  get usage() {
    let bits = [`@legend='${this.legend}'`];
    if (this.description) bits.push(`@description='${this.description}'`);
    if (this.disabled) bits.push('@disabled={{true}}');
    if (this.hideLegend) bits.push('@hideLegend={{true}}');
    if (this.orientation !== 'vertical') bits.push(`@orientation='${this.orientation}'`);
    return `<Fieldset ${bits.join(' ')}>…</Fieldset>`;
  }
  <template>
    <FreestyleUsage
      @name='Fieldset'
      @description='A real <fieldset> with a <legend>: the legend names the group, and disabling the fieldset disables every control inside through the platform. FormSection is the form-aware region with issue counts and a disclosure; this is the thin primitive under it.'
      @source={{this.usage}}
    >
      <:example>
        <Fieldset
          @legend={{this.legend}}
          @description={{this.description}}
          @disabled={{this.disabled}}
          @hideLegend={{this.hideLegend}}
          @orientation={{this.orientationArg}}
        >
          <RadioGroup @options={{this.roastOptions}} @value={{this.roast}} @onValueChange={{this.setRoast}} />
          <Checkbox @label='Include cupping notes' @checked={{this.notes}} @onCheckedChange={{this.setNotes}} />
        </Fieldset>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='legend'
          @value={{this.legend}}
          @description="The group's accessible name. A <:legend> block wins when it needs markup."
          @onInput={{this.setLegend}}
        />
        <Args.String
          @name='description'
          @value={{this.description}}
          @description='Prose under the legend, wired to the group with aria-describedby.'
          @onInput={{this.setDescription}}
        />
        <Args.Bool
          @name='disabled'
          @defaultValue={{false}}
          @value={{this.disabled}}
          @description='Native fieldset disabling: every control inside goes inert without being told individually.'
          @onInput={{this.setDisabled}}
        />
        <Args.Bool
          @name='hideLegend'
          @defaultValue={{false}}
          @value={{this.hideLegend}}
          @description='Keeps the legend for assistive tech and stops painting it.'
          @onInput={{this.setHideLegend}}
        />
        <Args.String
          @name='orientation'
          @value={{this.orientation}}
          @options={{this.orientations}}
          @defaultValue='vertical'
          @onInput={{this.setOrientation}}
        />
        <Args.Yield @name='legend' @description='The legend, when it needs markup.' />
        <Args.Yield @name='default' @description='The controls.' />
      </:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_FIELDSET: Record<string, unknown> = {
  Fieldset: FieldsetUsage,
};
