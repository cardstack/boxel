import { one } from './cycle-one';

export function two() {
  return 2;
}

export function three() {
  return one() * 3;
}
