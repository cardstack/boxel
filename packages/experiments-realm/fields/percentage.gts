import { Component } from 'https://cardstack.com/base/card-api';
import NumberField from 'https://cardstack.com/base/number';

import PercentageIcon from '@cardstack/boxel-icons/square-percentage';

const nearestDecimal = (num: number, decimalPlaces: number) => {
  // https://stackoverflow.com/questions/11832914/how-to-round-to-at-most-2-decimal-places-if-necessary
  const factorOfTen = Math.pow(10, decimalPlaces);
  return Math.round(num * factorOfTen + Number.EPSILON) / factorOfTen;
};

const displayPercentage = (num: number) => {
  return `${nearestDecimal(num, 2)}%`;
};

export class PercentageField extends NumberField {
  static icon = PercentageIcon;
  static displayName = 'Percentage';

  static isolated = class Isolated extends Component<typeof PercentageField> {
    <template>
      {{#if @model}}
        {{displayPercentage @model}}
      {{/if}}
    </template>
  };

  static atom = class Atom extends Component<typeof PercentageField> {
    <template>
      {{#if @model}}
        {{displayPercentage @model}}
      {{/if}}
    </template>
  };

  static embedded = class Embedded extends Component<typeof PercentageField> {
    <template>
      {{#if @model}}
        {{displayPercentage @model}}
      {{/if}}
    </template>
  };
}
