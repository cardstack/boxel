import type { RealmIdentifier } from '@cardstack/runtime-common';

export function isURLSearchKey(searchKey: string): boolean {
  try {
    new URL(searchKey);
    return true;
  } catch {
    return false;
  }
}

export function isSearchKeyEmpty(searchKey: string): boolean {
  return (searchKey?.trim() ?? '') === '';
}

// `realmIdentifierForURL` answers "is this URL one of the known realms, and
// what is its identifier?". Asking rather than comparing keeps this free of the
// realm-identifier form: the search key is whatever the user typed, a realm
// identifier is canonical, and only the realm server can relate the two.
export function resolveSearchKeyAsURL(
  searchKey: string,
  realmIdentifierForURL: (url: string) => RealmIdentifier | undefined,
): string | undefined {
  if (!isURLSearchKey(searchKey)) {
    return undefined;
  }
  return realmIdentifierForURL(searchKey + '/') ?? searchKey;
}
