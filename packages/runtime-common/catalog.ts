import { deburr } from 'lodash';
import { v4 as uuidv4 } from 'uuid';

export function listingNameWithUuid(listingName?: string) {
  if (!listingName) {
    return '';
  }
  // sanitize the listing name, eg: Blog App -> blog-app
  const name = deburr(listingName.toLocaleLowerCase())
    .replace(/ /g, '-')
    .replace(/'/g, '');
  const uuidName = `${name}-${uuidv4()}`;
  return { uuidName, name };
}
