import { capitalize } from '@ember/string';
import { typeOf } from '@ember/utils';

export function titleize(val: string): string | undefined {
  if (!val || typeOf(val) !== 'string') {
    return;
  }
  let value = val.includes('-') ? val.split('-') : val.split(' ');
  return value.map((el) => capitalize(el)).join(' ');
}
