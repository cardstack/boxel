/**
 * The `@cardstack/<name>/` names that belong to Host packages rather than to
 * realms.
 *
 * `@cardstack/<name>/` is not only an npm scope in this codebase: it is also
 * the realm-alias namespace, and the two share it. That makes the split here
 * load-bearing in both directions.
 *
 * The host's module classifier reads this list to admit a specifier as
 * Host-provided, which lets it run uncaged. The prefix registration reads it to
 * refuse a realm mapping under one of these names, because such a realm's
 * authored content would then be admitted the same way — the caging boundary
 * failing open rather than closed. Neither check is meaningful without the
 * other: one decides what is trusted, the other keeps anything untrusted from
 * being spelled that way.
 *
 * `base` is on the list and is also a registered realm prefix. That is
 * deliberate and the sole exception: the base realm is trusted on its own
 * account, so its alias and its URL agree, and `addRealmMapping` permits it.
 */
export const HOST_PACKAGE_NAMES: ReadonlySet<string> = new Set([
  'base',
  'boxel-host',
  'host',
  'boxel-icons',
  'boxel-ui',
  'bxl',
  'runtime-common',
  'view-transitions',
]);

/**
 * The name segment a `@scope/name/` prefix claims, or undefined when the value
 * is not of that shape. `@cardstack/boxel-ui/` claims `boxel-ui`.
 */
export function scopedPrefixName(prefix: string): string | undefined {
  if (!prefix.startsWith('@')) {
    return undefined;
  }
  let segments = prefix.split('/');
  return segments.length >= 2 && segments[1] !== '' ? segments[1] : undefined;
}

/**
 * Whether a prefix would claim a Host package's name. `base` is excluded: it is
 * a realm as well as a Host package, and registering it is correct.
 */
export function claimsHostPackageName(prefix: string): boolean {
  let name = scopedPrefixName(prefix);
  return name !== undefined && name !== 'base' && HOST_PACKAGE_NAMES.has(name);
}
