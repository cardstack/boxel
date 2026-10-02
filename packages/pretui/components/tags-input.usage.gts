// Pretui — TagsInput usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { TagsInput } from './tags-input';

export class TagsInputUsage extends Component {
  @tracked tags: string[] = ['Washed', 'Huila'];
  @tracked max: number | null = null;
  @tracked duplicates = false;
  setTags = (v: string[]) => (this.tags = v);
  setMax = (v: number | null) => (this.max = v);
  setDuplicates = (v: boolean) => (this.duplicates = v);
  get maxArg() {
    return this.max ?? undefined;
  }
  get usage() {
    let bits = ['@value={{this.tags}}', '@onChange={{this.setTags}}', "@label='Lot tags'"];
    if (this.max) bits.push(`@max={{${this.max}}}`);
    if (this.duplicates) bits.push('@duplicates={{true}}');
    return `<TagsInput ${bits.join(' ')} />`;
  }
  <template>
    <FreestyleUsage
      @name='TagsInput'
      @description='TokenInput under the Mantine name: type a string, commit it to a chip, keep typing. Enter or a separator commits, Backspace in an empty field removes the last tag, pasting a list commits each piece, and refusals are announced. The value is string[]. Import it when a port already says TagsInput; the component and its writeup are TokenInput.'
      @source={{this.usage}}
    >
      <:example>
        <TagsInput @value={{this.tags}} @onChange={{this.setTags}} @label='Lot tags' @placeholder='Add a tag' @max={{this.maxArg}} @duplicates={{this.duplicates}} />
        <p class='ti-demo-value'>Value: {{#each this.tags as |t|}}<code>{{t}}</code> {{/each}}</p>
      </:example>
      <:api as |Args|>
        <Args.Object @name='value' @description='Controlled string[]. defaultValue seeds the uncontrolled form.' />
        <Args.Action @name='onChange' @description='Fires with the next array on every add and remove. onValueChange is an alias.' />
        <Args.String @name='label' @description='The input accessible name.' />
        <Args.String @name='placeholder' @description='Shown while there are no tags.' />
        <Args.Number @name='max' @value={{this.max}} @onInput={{this.setMax}} @description='No more tags than this.' />
        <Args.Bool @name='duplicates' @value={{this.duplicates}} @defaultValue={{false}} @onInput={{this.setDuplicates}} />
        <Args.Object @name='separators' @description="Characters that commit besides Enter (default [',']). A newline or tab always does." />
        <Args.Bool @name='disabled' @defaultValue={{false}} />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .ti-demo-value {
        margin: var(--space-2, 0.375rem) 0 0;
        font-size: var(--text-ui-sm, 0.72rem);
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export const DEMOS_TAGS_INPUT: Record<string, unknown> = {
  TagsInput: TagsInputUsage,
};
