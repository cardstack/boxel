import {
  Component,
  FieldDef,
  queryableValue,
  primitive,
} from 'https://cardstack.com/base/card-api';

class View extends Component<typeof SillyNumberField> {
  <template>
    {{this.value}}
  </template>
  get value() {
    if (this.args.model == null) {
      return '';
    }
    return this.args.model.join(' ');
  }
}

export default class SillyNumberField extends FieldDef {
  @field value = primitive<string[]>();
  static [queryableValue](value: string[] | undefined) {
    if (!value) {
      return undefined;
    }
    let result = value.map((word) => {
      switch (word) {
        case 'zero':
          return '0';
        case 'one':
          return '1';
        case 'two':
          return '2';
        case 'three':
          return '3';
        case 'four':
          return '4';
        case 'five':
          return '5';
        case 'six':
          return '6';
        case 'seven':
          return '7';
        case 'eight':
          return '8';
        case 'nine':
          return '9';
        default:
          return '0';
      }
    });
    return parseInt(result.join(''));
  }

  static embedded = View;
  static isolated = View;
  static edit = View;
}
