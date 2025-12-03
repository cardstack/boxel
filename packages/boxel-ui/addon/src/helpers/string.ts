export function substring(str: string, start: number, end?: number) {
  return str.substring(start, end);
}

export function dasherize(str?: string): string {
  return (
    str
      ?.trim()
      .replace(/\s+/g, '-')
      .replace(/([a-zA-Z])(\d)/g, '$1-$2')
      .replace(/([a-z\d])([A-Z])/g, '$1-$2')
      .replace(/([A-Z]+)([A-Z][a-z\d]+)/g, '$1-$2')
      .toLowerCase() ?? ''
  );
}

export function buildCssVariableName(
  name?: string | null,
  prefix?: string | null,
): string {
  const normalize = (segment?: string | null) => {
    if (!segment) {
      return;
    }
    const trimmed = segment.toString().trim();
    if (!trimmed) {
      return;
    }
    const withoutPrefix = trimmed.startsWith('--') ? trimmed.slice(2) : trimmed;
    const dasherized = dasherize(withoutPrefix);
    return dasherized || undefined;
  };

  const normalizedName = normalize(name);
  const normalizedPrefix = normalize(prefix);
  if (!normalizedName && !normalizedPrefix) {
    return '';
  }

  const parts: string[] = [];
  if (normalizedPrefix) {
    parts.push(normalizedPrefix);
  }
  if (normalizedName) {
    parts.push(normalizedName);
  } else {
    return '';
  }

  return `--${parts.join('-')}`;
}
