import { helper } from '@ember/component/helper';

// boxel-ui's `cn`: the positional class names given, then each named one
// whose value is truthy, joined by spaces. boxel-ui's own can't ship on the
// secure origin (ADR 008 §1.3).
export default helper(function cn(
  params: (string | undefined)[],
  hash: Record<string, string | boolean | number | undefined>,
): string {
  return [
    ...params.filter(Boolean),
    ...Object.entries(hash)
      .filter(([, value]) => Boolean(value))
      .map(([name]) => name),
  ].join(' ');
});
