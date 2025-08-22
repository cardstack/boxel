import { helper } from '@ember/component/helper';
import { typeOf } from '@ember/utils';
import { titleize } from '../utils/titleize.ts';

export default helper(function formatComponentName([componentPath]: [string]) {
  if (!componentPath || typeOf(componentPath) !== 'string') {
    return componentPath;
  }
  let result = titleize(componentPath) ?? '';
  result = result.replace(/\//g, '::');
  result = result.replace(/ /g, '');
  return `<${result}>`;
});
