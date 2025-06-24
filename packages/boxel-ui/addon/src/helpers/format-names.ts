interface NameObject {
  first?: string;
  last?: string;
  middle?: string;
}

export default function formatNames(
  name: NameObject | string | null | undefined,
  options: {
    fallback?: string;
    format?: 'full' | 'first-last' | 'last-first' | 'initials';
    includeMiddle?: boolean;
    locale?: string;
    separator?: string;
  } = {},
): string {
  if (name == null) {
    return options.fallback || '';
  }

  const { format = 'full', includeMiddle = true } = options;

  // Set default separator based on format
  let separator = options.separator;
  if (separator === undefined) {
    switch (format) {
      case 'last-first':
        separator = ', ';
        break;
      case 'initials':
        separator = '.';
        break;
      default:
        separator = ' ';
        break;
    }
  }

  let nameObj: NameObject;

  if (typeof name === 'string') {
    const trimmedName = name.trim();
    if (!trimmedName) {
      return options.fallback || '';
    }
    const parts = trimmedName.split(/\s+/);
    if (parts.length === 1) {
      nameObj = { first: parts[0] };
    } else if (parts.length === 2) {
      nameObj = { first: parts[0], last: parts[1] };
    } else {
      nameObj = {
        first: parts[0],
        middle: parts.slice(1, -1).join(' '),
        last: parts[parts.length - 1],
      };
    }
  } else if (typeof name === 'object') {
    nameObj = name;
  } else {
    return options.fallback || '';
  }

  const { first = '', middle = '', last = '' } = nameObj;

  // Helper function to filter out empty or whitespace-only strings
  const filterEmpty = (value: string) => value && value.trim() !== '';

  // Check if all parts are empty or if the object is effectively empty
  if (!filterEmpty(first) && !filterEmpty(middle) && !filterEmpty(last)) {
    return options.fallback || '';
  }

  // Check if any part is explicitly an empty string (as opposed to undefined/null)
  // This indicates incomplete data that should trigger fallback behavior
  if (nameObj.first === '' || nameObj.middle === '' || nameObj.last === '') {
    return options.fallback || '';
  }

  switch (format) {
    case 'initials': {
      const initials = [first, includeMiddle ? middle : '', last]
        .filter(filterEmpty)
        .map((part) => part.charAt(0).toUpperCase())
        .join(separator);
      // Only add final period if separator includes periods
      return separator === '.' ? initials + '.' : initials;
    }

    case 'last-first':
      return [last, first].filter(filterEmpty).join(separator);

    case 'first-last':
      return [first, last].filter(filterEmpty).join(' ');

    case 'full':
    default:
      if (includeMiddle && filterEmpty(middle)) {
        return [first, middle, last].filter(filterEmpty).join(separator);
      }
      return [first, last].filter(filterEmpty).join(separator);
  }
}
