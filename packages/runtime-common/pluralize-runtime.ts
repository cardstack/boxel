import pluralize from 'pluralize';

export function getPlural(s: string, count?: number) {
  return pluralize(s, count);
}
