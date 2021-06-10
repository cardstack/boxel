import { Value } from 'animations/value';

export type UnitValue = {
  value: number;
  unit: string;
};

export function parse(value: Value): UnitValue {
  let [, _value, unit] =
    `${value}`.match(/^([+-]?(?:\d+|\d*\.\d+))([a-z]*|%)$/) ?? [];

  return {
    value: Number.parseFloat(_value),
    unit: unit ?? '',
  };
}

export default {
  parse,
};
