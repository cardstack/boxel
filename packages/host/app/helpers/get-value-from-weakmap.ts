import { helper } from '@ember/component/helper';

type PositionalArgs = [WeakMap<any, any>, any];

interface Signature {
  Args: {
    Positional: PositionalArgs;
  };
  Return: string;
}

export function getValueFromWeakMap([map, key]: PositionalArgs) {
  return map.get(key);
}

export default helper<Signature>(getValueFromWeakMap);
