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

// The branch names `toBranchName` makes. A submission's files land in a
// folder of this name, so a name of any other shape could aim them at a
// folder that is not a submission's.
const SUBMISSION_BRANCH_NAME = /^[0-9a-f]{6}(-[a-z0-9]+)*$/;

export function isSubmissionBranchName(branchName: string): boolean {
  return SUBMISSION_BRANCH_NAME.test(branchName);
}
