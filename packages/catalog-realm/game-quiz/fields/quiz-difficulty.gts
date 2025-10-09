import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import { fn } from '@ember/helper';
import { RadioInput } from '@cardstack/boxel-ui/components';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import {
  Component,
  FieldDef,
  contains,
  field,
} from 'https://cardstack.com/base/card-api';

class QuizDifficultyEdit extends Component<typeof QuizDifficultyField> {
  @tracked label = this.args.model.label;

  get difficulties() {
    return QuizDifficultyField.values;
  }

  get selectedDifficulty() {
    return this.difficulties?.find((difficulty) => {
      return difficulty.label === this.label;
    });
  }

  @action handleDifficultyChange(difficulty: QuizDifficultyField): void {
    this.label = difficulty.label;
    this.args.model.label = this.selectedDifficulty?.label;
    this.args.model.index = this.selectedDifficulty?.index;
  }

  <template>
    <div class='difficulty-field'>
      <RadioInput
        @groupDescription='Select Quiz Difficulty'
        @items={{this.difficulties}}
        @checkedId={{this.selectedDifficulty.label}}
        @orientation='horizontal'
        @spacing='default'
        @keyName='label'
        as |item|
      >
        <item.component @onChange={{fn this.handleDifficultyChange item.data}}>
          {{item.data.label}}
        </item.component>
      </RadioInput>
    </div>
  </template>
}

export class QuizDifficultyField extends FieldDef {
  @field label = contains(StringField);
  @field index = contains(NumberField);

  static values = [
    { index: 0, label: 'Beginner' },
    { index: 1, label: 'Intermediate' },
    { index: 2, label: 'Advanced' },
  ];

  static edit = QuizDifficultyEdit;

  static embedded = class Embedded extends Component<
    typeof QuizDifficultyField
  > {
    <template>
      {{@model.label}}
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    get selectedDifficulty() {
      return QuizDifficultyField.values.find((difficulty) => {
        return difficulty.label === this.args.model.label;
      });
    }

    <template>
      <div class='difficulty-container'>
        <span class='difficulty-label'>{{@model.label}}</span>
      </div>
      <style scoped>
        .difficulty-container {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 100%;
          height: 100%;
        }
        .difficulty-label {
          font-size: 0.75rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
      </style>
    </template>
  };
}
