import { sanitizeHtml } from './sanitize-html.ts';

export const BOXEL_SPACING_VARS = [
  'default',
  '6xs',
  '5xs',
  '4xs',
  'xxxs',
  'xxs',
  'xs',
  'sm',
  'm',
  'lg',
  'xl',
  'xxl',
  'xxxl',
];

export type BoxelSpacing =
  | 'default'
  | '6xs'
  | '5xs'
  | '4xs'
  | 'xxxs'
  | 'xxs'
  | 'xs'
  | 'sm'
  | 'm'
  | 'lg'
  | 'xl'
  | 'xxl'
  | 'xxxl';

export default function calcBoxelSpacing(value?: string | BoxelSpacing) {
  if (!value) {
    return;
  }

  value = value.toLowerCase().trim();

  if (value === 'default' || value === 'm') {
    return `var(--boxel-sp)`;
  }
  if (value === '2xs') {
    value = 'xxs';
  }
  if (value === '3xs') {
    value = 'xxxs';
  }
  if (value === '2xl') {
    value = 'xxl';
  }
  if (value === '3xl') {
    value = 'xxxl';
  }
  if (BOXEL_SPACING_VARS.includes(value)) {
    return sanitizeHtml(`var(--boxel-sp-${value})`);
  }
  return sanitizeHtml(value);
}
