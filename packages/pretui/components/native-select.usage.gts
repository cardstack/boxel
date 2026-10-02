// Pretui — NativeSelect usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { NativeSelect } from './native-select';
import type { PretuiSizeArg } from '../pretui-primitives';

const GRADE_NAMES = ['FTGFOP1', 'TGFOP', 'GFOP', 'FOP', 'Pekoe', 'Fannings'];
const GRADE_OPTIONS = GRADE_NAMES.map((g) => ({ value: g, label: g }));
const SIZES = ['xs', 's', 'm', 'l', 'xl'];

export class NativeSelectUsage extends Component {
  gradeNames = GRADE_NAMES;
  gradeOptions = GRADE_OPTIONS;
  sizes = SIZES;
  @tracked value = '';
  @tracked placeholder = 'Choose a leaf grade';
  @tracked size = 'm';
  @tracked disabled = false;
  @tracked required = false;
  @tracked invalid = false;
  setValue = (v: string) => (this.value = v);
  setPlaceholder = (v: string) => (this.placeholder = v);
  setSize = (v: string) => (this.size = v);
  get sizeArg() {
    return this.size as PretuiSizeArg;
  }
  setDisabled = (v: boolean) => (this.disabled = v);
  setRequired = (v: boolean) => (this.required = v);
  setInvalid = (v: boolean) => (this.invalid = v);
  get usage() {
    let bits = ['@options={{this.grades}}'];
    if (this.value) bits.push(`@value='${this.value}'`);
    if (this.placeholder) bits.push(`@placeholder='${this.placeholder}'`);
    if (this.size !== 'm') bits.push(`@size='${this.size}'`);
    if (this.disabled) bits.push('@disabled={{true}}');
    if (this.required) bits.push('@required={{true}}');
    if (this.invalid) bits.push('@invalid={{true}}');
    bits.push('@onChange={{this.setValue}}');
    return `<NativeSelect ${bits.join(' ')} />`;
  }
  <template>
    <FreestyleUsage
      @name='NativeSelect'
      @description='A styled closed face over a real <select>: the platform draws the open list, so a phone gets its own picker and the control posts in a form without a script. Reach for Select when the list needs typeahead, sections or rich items.'
      @source={{this.usage}}
    >
      <:example>
        <NativeSelect
          @label='Leaf grade'
          @options={{this.gradeOptions}}
          @value={{this.value}}
          @placeholder={{this.placeholder}}
          @size={{this.sizeArg}}
          @disabled={{this.disabled}}
          @required={{this.required}}
          @invalid={{this.invalid}}
          @onChange={{this.setValue}}
        />
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='options'
          @description='{value, label} pairs. @items is accepted as an alias; a default block of hand-written <option> / <optgroup> replaces both.'
          @value={{this.gradeOptions}}
        />
        <Args.String
          @name='value'
          @value={{this.value}}
          @options={{this.gradeNames}}
          @description='Controlled value. Omit it and seed with @defaultValue for the uncontrolled half.'
          @onInput={{this.setValue}}
        />
        <Args.Action
          @name='onChange'
          @description="Receives the chosen option's value as a string. @onValueChange is the same callback under the React Aria name."
        />
        <Args.String
          @name='placeholder'
          @value={{this.placeholder}}
          @description='Rendered as a disabled first option, selected while nothing is chosen.'
          @onInput={{this.setPlaceholder}}
        />
        <Args.String
          @name='size'
          @value={{this.size}}
          @options={{this.sizes}}
          @defaultValue='m'
          @onInput={{this.setSize}}
        />
        <Args.Bool @name='disabled' @defaultValue={{false}} @value={{this.disabled}} @onInput={{this.setDisabled}} />
        <Args.Bool @name='required' @defaultValue={{false}} @value={{this.required}} @onInput={{this.setRequired}} />
        <Args.Bool
          @name='invalid'
          @defaultValue={{false}}
          @value={{this.invalid}}
          @description='Paints the destructive hairline and sets aria-invalid on the select.'
          @onInput={{this.setInvalid}}
        />
        <Args.String @name='label' @value='Leaf grade' @description='Accessible name when no <label for> points at the select.' />
        <Args.String @name='controlId' @description='The id a <label for> points at.' />
      </:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_NATIVE_SELECT: Record<string, unknown> = {
  NativeSelect: NativeSelectUsage,
};
