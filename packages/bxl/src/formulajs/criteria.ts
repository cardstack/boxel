import { isExcelBlank } from './common.js';

export type CriteriaMatcher = (value: unknown) => boolean;

function castLiteral(value: string): unknown {
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return value.includes('.') ? parseFloat(value) : parseInt(value, 10);
  }

  const upper = value.toUpperCase();
  if (upper === 'TRUE') {
    return true;
  }
  if (upper === 'FALSE') {
    return false;
  }

  return value;
}

function hasWildcards(value: string) {
  let escaped = false;

  for (const char of value) {
    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '~') {
      escaped = true;
      continue;
    }

    if (char === '*' || char === '?') {
      return true;
    }
  }

  return false;
}

function wildcardToRegex(value: string) {
  let escaped = false;
  let pattern = '^';

  for (const char of value) {
    if (escaped) {
      pattern += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      escaped = false;
      continue;
    }

    if (char === '~') {
      escaped = true;
      continue;
    }

    if (char === '*') {
      pattern += '.*';
      continue;
    }

    if (char === '?') {
      pattern += '.';
      continue;
    }

    pattern += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  pattern += '$';
  return new RegExp(pattern, 'i');
}

function normalizeStringValue(value: unknown) {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'boolean') {
    return value ? 'TRUE' : 'FALSE';
  }
  if (isExcelBlank(value)) {
    return '';
  }
  return String(value);
}

function compareStrings(left: string, right: string, operator: string) {
  const leftValue = left.toLowerCase();
  const rightValue = right.toLowerCase();
  const order = leftValue.localeCompare(rightValue);

  switch (operator) {
    case '>':
      return order > 0;
    case '>=':
      return order >= 0;
    case '<':
      return order < 0;
    case '<=':
      return order <= 0;
    case '=':
      return order === 0;
    case '<>':
      return order !== 0;
    default:
      return false;
  }
}

function compareValues(left: unknown, right: unknown, operator: string) {
  if (
    typeof right === 'string' &&
    (operator === '=' || operator === '<>')
  ) {
    if (right === '') {
      const matched = isExcelBlank(left);
      return operator === '=' ? matched : !matched;
    }

    if (hasWildcards(right)) {
      const matched = wildcardToRegex(right).test(normalizeStringValue(left));
      return operator === '=' ? matched : !matched;
    }
  }

  if (typeof left === 'string' || typeof right === 'string') {
    return compareStrings(
      normalizeStringValue(left),
      normalizeStringValue(right),
      operator,
    );
  }

  switch (operator) {
    case '>':
      return (left as never) > (right as never);
    case '>=':
      return (left as never) >= (right as never);
    case '<':
      return (left as never) < (right as never);
    case '<=':
      return (left as never) <= (right as never);
    case '=':
      return (left as never) == (right as never);
    case '<>':
      return (left as never) != (right as never);
    default:
      return false;
  }
}

export function createCriteriaMatcher(criteria: unknown): CriteriaMatcher {
  if (criteria === undefined) {
    return () => true;
  }

  if (typeof criteria === 'string') {
    const match = criteria.match(/^(>=|<=|<>|>|<|=)?(.*)$/);
    const operator = match?.[1] ?? '=';
    const literal = castLiteral(match?.[2] ?? criteria);
    return (value: unknown) => compareValues(value, literal, operator);
  }

  return (value: unknown) => compareValues(value, criteria, '=');
}

export function matchesCriteria(value: unknown, criteria: unknown) {
  return createCriteriaMatcher(criteria)(value);
}
