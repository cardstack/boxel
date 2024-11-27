import {
  FieldDef,
  field,
  contains,
  StringField,
} from 'https://cardstack.com/base/card-api';
import NumberField from 'https://cardstack.com/base/number';

export interface LooseyGooseyData {
  index: number;
  label: string;
  color?: string;
}

export class LooseGooseyField extends FieldDef {
  @field index = contains(NumberField); //sorting order
  @field label = contains(StringField);
  static values: LooseyGooseyData[] = []; //help with the types

  get color() {
    return LooseGooseyField.values.find((value) => {
      return value.label === this.label;
    })?.color;
  }
}
