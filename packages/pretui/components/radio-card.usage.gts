// Pretui — RadioCard usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { iconFor } from '../icon-registry';
import { RadioCard } from './radio-card';
import type { ChoiceCardOption, ChoiceCardOrientation, ChoiceCardVariant } from '../internal/choice-cards';

const PLANS: ChoiceCardOption[] = [
  {
    value: 'starter',
    title: 'Starter',
    description: 'One workspace, community support.',
    meta: '$0 / mo',
  },
  {
    value: 'team',
    title: 'Team',
    description: 'Shared workspaces, roles, audit log.',
    meta: '$24 / mo',
  },
  {
    value: 'enterprise',
    title: 'Enterprise',
    description: 'SSO, dedicated region, custom retention.',
    meta: 'Contact us',
  },
];
const PLAN_VALUES = PLANS.map((p) => p.value);
const ORIENTATIONS = ['horizontal', 'vertical'];
const VARIANTS = ['cards', 'list'];
const PLAN_ICONS: Record<string, string> = {
  starter: 'rocket',
  team: 'radio-tower',
  enterprise: 'shield-check',
};

export class RadioCardUsage extends Component {
  plans = PLANS;
  planValues = PLAN_VALUES;
  orientations = ORIENTATIONS;
  variants = VARIANTS;
  @tracked value = 'team';
  @tracked orientation = 'horizontal';
  @tracked disabled = false;
  @tracked variant = 'cards';
  setValue = (v: string) => (this.value = v);
  setOrientation = (v: string) => (this.orientation = v);
  setDisabled = (v: boolean) => (this.disabled = v);
  setVariant = (v: string) => (this.variant = v);
  get variantVal() {
    return this.variant as ChoiceCardVariant;
  }
  get orientationVal() {
    return this.orientation as ChoiceCardOrientation;
  }
  iconFor = (option: ChoiceCardOption) => iconFor(PLAN_ICONS[option.value]);
  get usage() {
    let bits = [
      '@options={{this.plans}}',
      `@value='${this.value}'`,
      `@orientation='${this.orientation}'`,
      '@columns={{3}}',
    ];
    if (this.variant === 'list') bits.push(`@variant='list'`);
    if (this.disabled) bits.push('@disabled={{true}}');
    bits.push('@onValueChange={{this.setValue}}');
    return `<RadioCard ${bits.join(' ')}><:media as |o|>…</:media></RadioCard>`;
  }
  <template>
    <FreestyleUsage
      @name='RadioCard'
      @description='One-of-N where every option is a card: the card is the label and the hit target, a real radio sits inside it, and the chosen card wears the primary hairline. Use RadioGroup when the options are short words; use this when each option needs a title, a line of description and a figure.'
      @source={{this.usage}}
      @viewportMode='wide'
    >
      <:example>
        <RadioCard
          @label='Plan'
          @options={{this.plans}}
          @value={{this.value}}
          @orientation={{this.orientationVal}}
          @columns={{3}}
          @variant={{this.variantVal}}
          @disabled={{this.disabled}}
          @onValueChange={{this.setValue}}
        >
          <:media as |option|>
            {{#let (this.iconFor option) as |Icon|}}
              {{#if Icon}}<Icon width='16' height='16' aria-hidden='true' />{{/if}}
            {{/let}}
          </:media>
        </RadioCard>
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='options'
          @description='The cards. Each has a unique value, a title, and optionally description, meta (a short trailing figure) and disabled. @items is accepted as an alias.'
          @value={{this.plans}}
        />
        <Args.String
          @name='value'
          @optional={{true}}
          @value={{this.value}}
          @options={{this.planValues}}
          @description='The selected value. Omit it and pass @defaultValue for an uncontrolled group.'
          @onInput={{this.setValue}}
        />
        <Args.String
          @name='orientation'
          @optional={{true}}
          @defaultValue='vertical'
          @value={{this.orientation}}
          @options={{this.orientations}}
          @description='vertical stacks the cards; horizontal lays them side by side.'
          @onInput={{this.setOrientation}}
        />
        <Args.String
          @name='variant'
          @optional={{true}}
          @defaultValue='cards'
          @value={{this.variant}}
          @options={{this.variants}}
          @description='cards draws each option as its own card; list draws them as rows in one bordered group, split by hairlines, with meta as the trailing figure. list always stacks, whatever the orientation.'
          @onInput={{this.setVariant}}
        />
        <Args.Number
          @name='columns'
          @optional={{true}}
          @value={{3}}
          @description='Fixed column count for horizontal (2, 3 or 4). Without it the cards take as many columns as fit.'
        />
        <Args.String
          @name='label'
          @optional={{true}}
          @value='Plan'
          @description='The accessible name of the radiogroup when no label element points at it.'
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
          @description="Receives the chosen option's value as a string. @onChange is an alias."
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

export const DEMOS_RADIO_CARD: Record<string, unknown> = {
  RadioCard: RadioCardUsage,
};
