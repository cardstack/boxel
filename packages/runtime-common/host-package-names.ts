/**
 * The `@cardstack/<name>/` names that belong to Host packages rather than to
 * realms.
 *
 * `@cardstack/<name>/` is not only an npm scope in this codebase: it is also
 * the realm-alias namespace, and the two share it. That makes the split here
 * load-bearing.
 *
 * The prefix registration reads this list to refuse a realm mapping under one
 * of these names. A realm and a Host package do not coexist under one
 * `@cardstack/<name>/` prefix: both kinds of registration are stored under
 * that single key, so whichever is registered last silently replaces the
 * other, and takes its resolution with it. Which way it breaks depends on the
 * order — an import meant for the Host package answered with realm content, or
 * the package's namespace displacing the realm — and either way it happens
 * from configuration alone.
 *
 * The namespace acquires new members without this file being touched:
 * `network.ts` registers a prefix per realm from the `PREFIX_REALMS`
 * declaration, and `main.ts`/`worker.ts` from their `--fromUrl` arguments,
 * generically for every `https://cardstack.com/<name>/` mapping. That is why
 * the check belongs at registration rather than here — this list cannot see
 * what gets registered, and only the registration can.
 *
 * A Host package missing from this list is simply unprotected: a realm could
 * be registered under its name. Nothing else reads the list, so a stale entry
 * costs only that protection.
 *
 * `base` is on the list and is also a registered realm prefix. That is
 * deliberate and the sole exception: the base realm is what `@cardstack/base`
 * is meant to resolve to, so its alias and its URL agree, and
 * `addRealmMapping` permits it.
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
 * The Host package a `@cardstack/<name>/…` identifier names, or undefined when
 * it names none.
 *
 * This is the one implementation of that question, and `addRealmMapping`'s
 * refusal is only as good as its answer: a spelling this predicate misses is a
 * realm registered onto a Host package's prefix.
 *
 * Hence the decode, and the rejections that go with it. `%62oxel-ui` decodes to
 * `boxel-ui`, so comparing the raw segment would let an encoded spelling of a
 * Host package's name through. An identifier that still holds `%`, `\`, `?` or
 * `#` after decoding, or that walks with `.`/`..`, names nothing: those are
 * ways to write one thing and have it read as another, and the answer for all
 * of them is no.
 *
 * The scope must be `@cardstack` literally. `@other/boxel-ui/` names no Host
 * package however it is spelled, so a realm may hold it.
 *
 * A bare package spelling reaches this boundary BEFORE the Loader resolves it
 * to a URL, so `new URL()` normalization — which is what collapses `..` and
 * decodes escapes for every other identifier here — has not run and cannot
 * protect it. `@cardstack/base/../../evil/card` is a valid ESM specifier that
 * a resolver may take outside the package root while reading as a Host package
 * to a naive prefix test.
 *
 * So a specifier names a Host package only when it is unambiguously a path
 * inside an `@cardstack` package: decodable, free of the characters that carry
 * a second layer of interpretation (`\` as a separator on some resolvers, `%`
 * for a further encoding round, `?`/`#` for a query or fragment that could hide
 * the real path), and free of dot segments. Rejecting `%` outright is what
 * makes the single `decodeURIComponent` sufficient — a doubly-encoded
 * `%252e%252e` decodes to `%2e%2e`, which still carries a `%` and is refused,
 * so there is no need to decode to a fixed point.
 */
export function hostPackageNameOf(identifier: string): string | undefined {
  if (!identifier.startsWith('@cardstack/')) {
    return undefined;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(identifier);
  } catch {
    return undefined;
  }
  if (
    decoded.includes('\\') ||
    decoded.includes('%') ||
    decoded.includes('?') ||
    decoded.includes('#')
  ) {
    return undefined;
  }
  let segments = decoded.split('/');
  if (segments.length < 2 || segments[0] !== '@cardstack') {
    return undefined;
  }
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    return undefined;
  }
  let name = segments[1]!;
  return HOST_PACKAGE_NAMES.has(name) ? name : undefined;
}

/**
 * Whether registering this prefix as a realm would land on a Host package's
 * prefix.
 *
 * The same question `hostPackageNameOf` answers, less the one legitimate
 * overlap: `base` is a Host package name and the base realm's prefix, and the
 * base realm is what that name resolves to, so registering it is correct.
 */
export function claimsHostPackageName(prefix: string): boolean {
  let name = hostPackageNameOf(prefix);
  if (name === undefined) {
    return false;
  }
  // The exemption is the literal spelling, not the name. A mapping is stored
  // and matched under the prefix exactly as given, so `@cardstack/%62ase/`
  // would resolve to whatever target it was registered with while still
  // decoding to `base`. Exempting by name lets an encoded spelling of the base
  // realm point at an arbitrary origin; exempting the literal prefix does not,
  // because that is the spelling whose alias and URL agree.
  return !(name === 'base' && prefix.replace(/\/$/, '') === '@cardstack/base');
}
