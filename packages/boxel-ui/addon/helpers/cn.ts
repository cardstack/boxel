import { helper } from '@ember/component/helper';
import classnames from 'classnames';

export default helper(function classNames(
  params: (string | undefined)[],
  hash: Record<string, string | boolean | number | undefined>,
): string {
  const entries = Object.entries(hash);
  const obj = Object.fromEntries(entries);

  return classnames(...params, obj);
});
