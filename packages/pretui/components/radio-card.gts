// Pretui — RadioCard: a one-of-N choice where each option is a card.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { fn } from '@ember/helper';
import { guidFor } from '@ember/object/internals';
import { emit, firstDefined } from '../pretui-primitives';
import { ChoiceGrid, OptionCard } from '../internal/choice-cards';
import type { ChoiceCardOption, ChoiceCardOrientation, ChoiceCardsSharedArgs } from '../internal/choice-cards';

export interface RadioCardSignature {
  Args: ChoiceCardsSharedArgs & {
    value?: string;
    defaultValue?: string;
    onValueChange?: (value: string) => void;
    /** alias */
    onChange?: (value: string) => void;
  };
  Blocks: {
    /** replaces the generated title and description of every card */
    default: [option: ChoiceCardOption, selected: boolean];
    /** an icon or thumbnail on the card's start edge */
    media: [option: ChoiceCardOption];
  };
  Element: HTMLDivElement;
}

export class RadioCard extends Component<RadioCardSignature> {
  @tracked internal = this.args.defaultValue;
  generatedName = `${guidFor(this)}-rc`;
  get name() {
    return this.args.name ?? this.generatedName;
  }
  get options(): ChoiceCardOption[] {
    return firstDefined(this.args.options, this.args.items) ?? [];
  }
  get value() {
    return this.args.value ?? this.internal;
  }
  get groupDisabled() {
    return firstDefined(this.args.disabled, this.args.isDisabled) ?? false;
  }
  get orientation(): ChoiceCardOrientation {
    return this.args.orientation ?? 'vertical';
  }
  pick = (option: ChoiceCardOption, ev: Event) => {
    if (this.args.value === undefined) {
      this.internal = option.value;
    }
    emit([this.args.onValueChange, this.args.onChange], option.value);
    if (this.args.value !== undefined) {
      // controlled: the platform already moved the radios; put them back until
      // the owner moves @value, so the checked input matches the painted card
      let group = (ev.target as HTMLElement).closest('.pretui-choicecards');
      group
        ?.querySelectorAll<HTMLInputElement>('input[type="radio"]')
        .forEach((input) => (input.checked = input.value === this.value));
    }
  };
  isOn = (option: ChoiceCardOption) => this.value === option.value;
  isDisabled = (option: ChoiceCardOption) =>
    this.groupDisabled || Boolean(option.disabled);
  <template>
    <ChoiceGrid
      role='radiogroup'
      aria-label={{@label}}
      data-orientation={{this.orientation}}
      data-columns={{@columns}}
      data-test-pretui-radio-card
      ...attributes
    >
      {{#each this.options as |option|}}
        <OptionCard
          @kind='radio'
          @name={{this.name}}
          @option={{option}}
          @selected={{this.isOn option}}
          @disabled={{this.isDisabled option}}
          @onChange={{fn this.pick option}}
          @custom={{has-block}}
          @hasMedia={{has-block 'media'}}
        >
          <:default as |o selected|>{{yield o selected}}</:default>
          <:media as |o|>{{yield o to='media'}}</:media>
        </OptionCard>
      {{/each}}
    </ChoiceGrid>
  </template>
}
