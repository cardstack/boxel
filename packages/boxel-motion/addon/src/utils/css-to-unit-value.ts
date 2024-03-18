import { type Value } from '../value/index.ts';

export type UnitValue = {
  unit: string;
  value: number;
};

export function parse(value: Value): UnitValue {
  let [, _value, unit] =
    `${value}`.match(/^([+-]?(?:\d+|\d*\.\d+))([a-z]*|%)$/) ?? [];

  return {
    value: Number.parseFloat(_value ?? ''),
    unit: unit ?? '',
  };
}

export default {
  parse,
};
