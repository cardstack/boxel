import { parse } from 'date-fns';

export function cleanWhiteSpace(text: string) {
  return text.replace(/\s+/g, ' ').trim();
}

export function p(dateString: string): Date {
  return parse(dateString, 'yyyy-MM-dd', new Date());
}
