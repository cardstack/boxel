import { helper } from '@ember/component/helper';

import { titleize } from '../utils/titleize';

export default helper(function formatComponentName([componentPath]: [
  string,
]): string {
  let result = titleize(componentPath as string) || '';
  result = result.replace(/\//g, '::');
  result = result.replace(/ /g, '');
  return `<${result}>`;
});
