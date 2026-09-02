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
 * The namespace acquires new members without this file being touched:
 * `network.ts` registers a prefix per realm from the `PREFIX_REALMS`
 * declaration, and `main.ts`/`worker.ts` from their `--fromUrl` arguments,
 * generically for every `https://cardstack.com/<name>/` mapping. That is why
 * the check belongs at registration rather than here — this list cannot see
 * what gets registered, and only the registration can.
 *
 * A Host package missing from that list fails closed: its modules classify as
 * authored, which cages them and makes the walk try to read them. That is the
 * right direction for a stale list — visible, and never an escalation — and it
 * does not break the graph walk, which prunes on the runtime's own shim
 * registry rather than on this list.
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
 * The Host package a `@cardstack/<name>/…` identifier names, or undefined when
 * it names none.
 *
 * This is the one implementation of that question, because two consumers have
 * to agree on it exactly: the host's module classifier decides what runs
 * uncaged, and `addRealmMapping` refuses to register a realm that the
 * classifier would then trust. A second, subtly different predicate is a hole
 * rather than a duplicate — a spelling one accepts and the other rejects
 * reopens the boundary from configuration alone.
 *
 * Hence the decode, and the rejections that go with it. `%62oxel-ui` decodes to
 * `boxel-ui`, so comparing the raw segment would miss it while the classifier
 * does not. An identifier that still holds `%`, `\`, `?` or `#` after decoding,
 * or that walks with `.`/`..`, names nothing: those are ways to write one thing
 * and have it read as another, and the answer for all of them is no.
 *
 * The scope must be `@cardstack` literally. `@other/boxel-ui/` names no Host
 * package however it is spelled, so a realm may hold it.
 *
 * A bare package spelling reaches this boundary BEFORE the Loader resolves it
 * to a URL, so `new URL()` normalization — which is what collapses `..` and
 * decodes escapes for every other identifier here — has not run and cannot
 * protect it. `@cardstack/base/../../evil/card` is a valid ESM specifier that
 * a resolver may take outside the package root while reading as trusted to a
 * naive prefix test.
 *
 * So the specifier is admitted only when it is unambiguously a path inside an
 * `@cardstack` package: decodable, free of the characters that carry a second
 * layer of interpretation (`\` as a separator on some resolvers, `%` for a
 * further encoding round, `?`/`#` for a query or fragment that could hide the
 * real path), and free of dot segments. Rejecting `%` outright is what makes
 * the single `decodeURIComponent` sufficient — a doubly-encoded `%252e%252e`
 * decodes to `%2e%2e`, which still carries a `%` and is refused, so there is
 * no need to decode to a fixed point.
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
 * Whether an identifier names a Host package, and so may run uncaged.
 */
export function isHostPackageSpecifier(identifier: string): boolean {
  return hostPackageNameOf(identifier) !== undefined;
}

/**
 * Whether registering this prefix as a realm would hand the classifier
 * authored content to trust.
 *
 * The same question as `isHostPackageSpecifier`, less the one legitimate
 * overlap: `base` is a Host package name and the base realm's prefix, and the
 * base realm is trusted on its own account, so registering it is correct.
 */
export function claimsHostPackageName(prefix: string): boolean {
  let name = hostPackageNameOf(prefix);
  if (name === undefined) {
    return false;
  }
  // The exemption is the literal spelling, not the name. A mapping is stored
  // and matched under the prefix exactly as given, while the classifier decodes
  // before deciding — so `@cardstack/%62ase/` would resolve to whatever target
  // it was registered with and still be trusted as `base`. Exempting by name
  // hands the base realm's trust to an arbitrary origin; exempting the literal
  // prefix does not, because that is the spelling whose alias and URL agree.
  return !(name === 'base' && prefix.replace(/\/$/, '') === '@cardstack/base');
}
