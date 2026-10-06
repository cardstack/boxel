// Pretui — CheckboxCard: a many-of-N choice where each option is a card.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { fn } from '@ember/helper';
import { emit, firstDefined } from '../pretui-primitives';
import { ChoiceGrid, OptionCard } from '../internal/choice-cards';
import type { ChoiceCardOption, ChoiceCardOrientation, ChoiceCardsSharedArgs } from '../internal/choice-cards';

export interface CheckboxCardSignature {
  Args: ChoiceCardsSharedArgs & {
    value?: readonly string[];
    defaultValue?: readonly string[];
    onValueChange?: (values: string[]) => void;
    /** alias */
    onChange?: (values: string[]) => void;
  };
  Blocks: {
    /** replaces the generated title and description of every card */
    default: [option: ChoiceCardOption, selected: boolean];
    /** an icon or thumbnail on the card's start edge */
    media: [option: ChoiceCardOption];
  };
  Element: HTMLDivElement;
}

export class CheckboxCard extends Component<CheckboxCardSignature> {
  @tracked internal: readonly string[] = this.args.defaultValue ?? [];
  get options(): ChoiceCardOption[] {
    return firstDefined(this.args.options, this.args.items) ?? [];
  }
  get value(): readonly string[] {
    return this.args.value ?? this.internal;
  }
  get groupDisabled() {
    return firstDefined(this.args.disabled, this.args.isDisabled) ?? false;
  }
  get orientation(): ChoiceCardOrientation {
    return this.args.orientation ?? 'vertical';
  }
  toggle = (option: ChoiceCardOption, ev: Event) => {
    let next = this.value.includes(option.value)
      ? this.value.filter((v) => v !== option.value)
      : [...this.value, option.value];
    if (this.args.value === undefined) {
      this.internal = next;
    }
    emit([this.args.onValueChange, this.args.onChange], next);
    if (this.args.value !== undefined) {
      // controlled: undo the platform's toggle until the owner moves @value
      (ev.target as HTMLInputElement).checked = this.isOn(option);
    }
  };
  isOn = (option: ChoiceCardOption) => this.value.includes(option.value);
  isDisabled = (option: ChoiceCardOption) =>
    this.groupDisabled || Boolean(option.disabled);
  <template>
    <ChoiceGrid
      role='group'
      aria-label={{@label}}
      data-orientation={{this.orientation}}
      data-columns={{@columns}}
      data-test-pretui-checkbox-card
      ...attributes
    >
      {{#each this.options as |option|}}
        <OptionCard
          @kind='checkbox'
          @name={{@name}}
          @option={{option}}
          @selected={{this.isOn option}}
          @disabled={{this.isDisabled option}}
          @onChange={{fn this.toggle option}}
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
