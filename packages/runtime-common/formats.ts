export { FITTED_FORMATS } from '@cardstack/boxel-ui/helpers';

export type Format = 'isolated' | 'embedded' | 'fitted' | 'edit' | 'atom';

export function isValidFormat(
  format: string,
  formatArr = formats,
): format is Format {
  return formatArr.includes(format as Format);
}

export const formats: Format[] = [
  'isolated',
  'embedded',
  'fitted',
  'atom',
  'edit',
];
