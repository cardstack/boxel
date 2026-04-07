export type Format =
  | 'isolated'
  | 'embedded'
  | 'fitted'
  | 'edit'
  | 'atom'
  | 'head'
  | 'metadata';

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
  'head',
];

export {
  FITTED_FORMATS,
  FITTED_FORMAT_SIZES,
  fittedFormatById,
  fittedFormatIds,
  type FittedFormatId,
  type FittedFormatSpec,
} from '@cardstack/boxel-ui/helpers';
