// Pretui — CheckboxCard usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { CheckboxCard } from './checkbox-card';
import type { ChoiceCardOption } from '../internal/choice-cards';

const ADDONS: ChoiceCardOption[] = [
  {
    value: 'backups',
    title: 'Nightly backups',
    description: 'Thirty days of restore points.',
    meta: '+$4',
  },
  {
    value: 'sso',
    title: 'Single sign-on',
    description: 'SAML and OIDC against your identity provider.',
    meta: '+$8',
  },
  {
    value: 'audit',
    title: 'Audit log export',
    description: 'Stream every event to your SIEM.',
    meta: '+$6',
  },
  {
    value: 'legacy',
    title: 'Legacy API',
    description: 'No longer offered on new plans.',
    meta: '—',
    disabled: true,
  },
];

export class CheckboxCardUsage extends Component {
  addons = ADDONS;
  @tracked value: string[] = ['backups'];
  @tracked disabled = false;
  setValue = (v: string[]) => (this.value = v);
  setDisabled = (v: boolean) => (this.disabled = v);
  get usage() {
    let bits = ['@options={{this.addons}}', '@value={{this.value}}'];
    if (this.disabled) bits.push('@disabled={{true}}');
    bits.push('@onValueChange={{this.setValue}}');
    return `<CheckboxCard ${bits.join(' ')} />`;
  }
  <template>
    <FreestyleUsage
      @name='CheckboxCard'
      @description='Many-of-N where every option is a card: the card is the label and the hit target, a real checkbox sits inside it, and each chosen card wears the primary hairline. The value is the array of chosen values. Use Checkbox for a single yes/no; use this when each option carries a title, a description and a figure.'
      @source={{this.usage}}
    >
      <:example>
        <CheckboxCard
          @label='Add-ons'
          @options={{this.addons}}
          @value={{this.value}}
          @disabled={{this.disabled}}
          @onValueChange={{this.setValue}}
        />
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='options'
          @description='The cards. Each has a unique value, a title, and optionally description, meta (a short trailing figure) and disabled. @items is accepted as an alias.'
          @value={{this.addons}}
        />
        <Args.Array
          @name='value'
          @optional={{true}}
          @value={{this.value}}
          @description='The chosen values. Omit it and pass @defaultValue for an uncontrolled group.'
        />
        <Args.String
          @name='orientation'
          @optional={{true}}
          @defaultValue='vertical'
          @description='vertical stacks the cards; horizontal lays them side by side, with @columns fixing the count.'
        />
        <Args.String
          @name='label'
          @optional={{true}}
          @value='Add-ons'
          @description='The accessible name of the group when no label element points at it.'
        />
        <Args.Bool
          @name='disabled'
          @optional={{true}}
          @defaultValue='false'
          @value={{this.disabled}}
          @description='Disables every card. A single option is disabled through option.disabled.'
          @onInput={{this.setDisabled}}
        />
        <Args.Action
          @name='onValueChange'
          @description='Receives the full array of chosen values after the toggle. @onChange is an alias.'
        />
        <Args.Yield
          @name='default'
          @description='Replaces the generated title and description of every card. Yields the option and whether it is selected.'
        />
        <Args.Yield
          @name='media'
          @description="An icon or thumbnail on the card's start edge. Yields the option."
        />
      </:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_CHECKBOX_CARD: Record<string, unknown> = {
  CheckboxCard: CheckboxCardUsage,
};
