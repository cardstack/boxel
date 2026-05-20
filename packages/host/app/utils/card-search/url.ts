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

export function resolveSearchKeyAsURL(
  searchKey: string,
  availableRealmIdentifiers: string[],
): string | undefined {
  if (!isURLSearchKey(searchKey)) {
    return undefined;
  }
  let maybeIndexCardURL = availableRealmIdentifiers.find((u) => u === searchKey + '/');
  return maybeIndexCardURL ?? searchKey;
}
