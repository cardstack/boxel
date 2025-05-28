import { deburr } from 'lodash';
import { v4 as uuidv4 } from 'uuid';

export function listingNameWithUuid(listingName?: string) {
  if (!listingName) {
    return '';
  }
  // sanitize the listing name, eg: Blog App -> blog-app
  const sanitizedListingName = deburr(listingName.toLocaleLowerCase())
    .replace(/ /g, '-')
    .replace(/'/g, '');
  const newPackageName = `${sanitizedListingName}-${uuidv4()}`;
  return newPackageName;
}
