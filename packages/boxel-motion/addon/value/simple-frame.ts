// example values: 123px, 90deg, 0.5
// do we need a transformer to go from primitive/mergable value to final?
import { Value } from '@cardstack/boxel-motion/value/index';

export interface Frame {
  property: string;

  serializeValue(): string | number;
}

export default class SimpleFrame implements Frame {
  property: string;
  value: Value;
  unit: string | undefined;

  // value should exclude the unit if there is one
  // legal values are for example: 0.5, '100', 'block'
  constructor(property: string, value: Value, unit?: string) {
    this.property = property;
    this.value = value;
    this.unit = unit;
  }

  serializeValue(): Value {
    return this.unit ? `${this.value}${this.unit}` : this.value;
  }
}
