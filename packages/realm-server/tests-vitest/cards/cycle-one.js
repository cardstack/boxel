import { two } from './cycle-two';

export function one() {
  return two() - 1;
}
