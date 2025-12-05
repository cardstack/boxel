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
