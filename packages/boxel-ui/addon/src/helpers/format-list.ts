export default function formatList(
  items: string[] | null | undefined,
  options: {
    fallback?: string;
    locale?: string;
    style?: 'long' | 'short' | 'narrow';
    type?: 'conjunction' | 'disjunction' | 'unit';
  } = {},
): string {
  // Handle null, undefined, or non-array inputs
  if (!Array.isArray(items) || items.length === 0) {
    return options.fallback || '';
  }

  // Handle invalid array content (nested arrays or non-strings)
  const hasInvalidItems = items.some(
    (item) => typeof item !== 'string' || Array.isArray(item),
  );
  if (hasInvalidItems) {
    return options.fallback || '';
  }

  const { style = 'long', type = 'conjunction', locale } = options;

  // Handle single item
  if (items.length === 1) {
    return items[0] || '';
  }

  // Use Intl.ListFormat if available and locale is specified
  if (typeof Intl !== 'undefined' && (Intl as any).ListFormat && locale) {
    try {
      const listFormatter = new (Intl as any).ListFormat(locale, {
        style: style,
        type: type === 'unit' ? 'conjunction' : type,
      });
      return listFormatter.format(items);
    } catch (error) {
      // Fall back to manual formatting if Intl.ListFormat fails
    }
  }

  // Manual formatting for fallback or when no locale is specified
  if (items.length === 2) {
    if (style === 'narrow') {
      return `${items[0]} ${items[1]}`;
    }
    const connector = type === 'disjunction' ? 'or' : 'and';
    if (type === 'unit') {
      return `${items[0]}, ${items[1]}`;
    }
    return `${items[0]} ${connector} ${items[1]}`;
  }

  // Handle 3+ items
  const lastItem = items[items.length - 1];
  const allButLast = items.slice(0, -1);

  switch (style) {
    case 'narrow':
      return items.join(' ');
    case 'short':
      return `${allButLast.join(', ')}, ${lastItem}`;
    case 'long':
    default: {
      if (type === 'unit') {
        return `${allButLast.join(', ')}, ${lastItem}`;
      }
      const connector = type === 'disjunction' ? 'or' : 'and';
      return `${allButLast.join(', ')}, ${connector} ${lastItem}`;
    }
  }
}
