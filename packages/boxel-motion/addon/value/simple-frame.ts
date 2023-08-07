// example values: 123px, 90deg, 0.5
// do we need a transformer to go from primitive/mergable value to final?
import { Value } from '@cardstack/boxel-motion/value/index';

export interface Frame {
  property: string;

  serializeValue(): string | number;
}

export type UnitValueSerializer = (
  value: Value,
  unit: string | undefined,
) => Value;

export default class SimpleFrame implements Frame {
  property: string;
  value: Value;
  unit: string | undefined;
  velocity = 0;

  serialize: UnitValueSerializer = (value, unit) =>
    unit ? `${value}${unit}` : value;

  // value should exclude the unit if there is one
  // legal values are for example: 0.5, '100', 'block'
  constructor(
    property: string,
    value: Value,
    unit?: string,
    serialize?: UnitValueSerializer,
  ) {
    this.property = property;
    this.value = value;
    this.unit = unit;
    if (serialize) {
      this.serialize = serialize;
    }
  }

  serializeValue(): Value {
    return this.serialize(this.value, this.unit);
  }
}
