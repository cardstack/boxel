// The separator that joins a JSON:API resource's `(type, id)` into a single
// identity string for map keys and dedup sets. A NUL byte can't appear in a
// resource type or id, so a key can never alias another by concatenation.
//
// Kept in its own dependency-free module — no other runtime-common imports —
// so consumers outside the card-api module graph (e.g. boxel-cli, a plain
// Node CLI) can import the canonical identity helper without pulling in the
// index's `https://cardstack.com/base/*` imports.
export const RESOURCE_IDENTITY_SEPARATOR = '\u0000';

export function resourceIdentity(type: string, id: string | undefined): string {
  return `${type}${RESOURCE_IDENTITY_SEPARATOR}${id}`;
}
