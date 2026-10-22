// Pretui — Editable usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Editable } from './editable';

export class EditableUsage extends Component {
  @tracked value = 'Ada Lovelace';
  @tracked label = 'Name';
  @tracked placeholder = 'Add a name';
  @tracked submitOnBlur = true;
  @tracked disabled = false;
  @tracked lastSubmitted = '';
  setValue = (v: string) => (this.value = v);
  setLabel = (v: string) => (this.label = v);
  setPlaceholder = (v: string) => (this.placeholder = v);
  setSubmitOnBlur = (v: boolean) => (this.submitOnBlur = v);
  setDisabled = (v: boolean) => (this.disabled = v);
  submitted = (v: string) => (this.lastSubmitted = v);
  get usage() {
    let bits = [`@label='${this.label}'`, `@value='${this.value}'`];
    if (this.placeholder) bits.push(`@placeholder='${this.placeholder}'`);
    if (!this.submitOnBlur) bits.push('@submitOnBlur={{false}}');
    if (this.disabled) bits.push('@disabled={{true}}');
    bits.push('@onChange={{this.setValue}}', '@onSubmit={{this.submitted}}');
    return `<Editable ${bits.join(' ')} />`;
  }
  <template>
    <FreestyleUsage
      @name='Editable'
      @description='Text that reads as a value until it is a field. The preview is a button named after the label and the current value; activating it swaps in an Input in place. Enter commits, Escape restores, and leaving the field commits unless told otherwise. For a whole record of these with a batched save and undo, use RecordDetail.'
      @source={{this.usage}}
    >
      <:example>
        <Editable
          @label={{this.label}}
          @value={{this.value}}
          @placeholder={{this.placeholder}}
          @submitOnBlur={{this.submitOnBlur}}
          @disabled={{this.disabled}}
          @onChange={{this.setValue}}
          @onSubmit={{this.submitted}}
        />
        <p class='pretui-demo-readout'>
          {{#if this.lastSubmitted}}Last submitted: {{this.lastSubmitted}}{{else}}Nothing submitted yet — click the name, edit, press Enter.{{/if}}
        </p>
      </:example>
      <:api as |Args|>
        <Args.String @name='value' @value={{this.value}} @onInput={{this.setValue}} @description='The committed text. Omit it and use @defaultValue for the uncontrolled half.' />
        <Args.String @name='label' @value={{this.label}} @onInput={{this.setLabel}} @description='What the value is; spoken in the trigger name as "Edit Name, currently Ada Lovelace".' />
        <Args.String @name='placeholder' @value={{this.placeholder}} @onInput={{this.setPlaceholder}} @description='Shown muted in the preview while the value is empty, and inside the field.' />
        <Args.Bool @name='submitOnBlur' @value={{this.submitOnBlur}} @onInput={{this.setSubmitOnBlur}} @defaultValue={{true}} @description='Leaving the field commits the draft; off, it restores the old value.' />
        <Args.Bool @name='disabled' @value={{this.disabled}} @onInput={{this.setDisabled}} @defaultValue={{false}} />
        <Args.Bool @name='defaultEditing' @defaultValue={{false}} @description='Start open. @startWithEditView is the Chakra spelling.' />
        <Args.Bool @name='selectOnFocus' @defaultValue={{true}} @description='Select the whole value when the field opens.' />
        <Args.Action @name='onSubmit' @description='Every commit, with the committed string — Enter or blur, changed or not.' />
        <Args.Action @name='onChange' @description='Only when the committed value differs from the previous one. @onValueChange is the alias.' />
        <Args.Action @name='onCancel' @description='Escape, or blur with @submitOnBlur off.' />
        <Args.Action @name='onEditingChange' @description='Every open and close, with the next state.' />
        <Args.Yield @name='preview' @description='Replaces the plain text inside the trigger; receives the value.' />
      </:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_EDITABLE: Record<string, unknown> = {
  Editable: EditableUsage,
};
