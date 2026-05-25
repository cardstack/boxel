const HASH_BYTES = 3;

function generateHash(): string {
  let bytes = new Uint8Array(HASH_BYTES);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function toKebabSlug(value: string): string {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function toBranchName(listingName: string): string {
  if (!listingName) {
    throw new Error('listingName is required');
  }
  let listingSlug = toKebabSlug(listingName);
  let hash = generateHash();
  return listingSlug ? `${hash}-${listingSlug}` : hash;
}
