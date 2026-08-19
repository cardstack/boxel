// Lives in its own module (rather than realm.ts) so dependency-light, portable
// code — e.g. publishability.ts and the realm operations consumed by boxel-cli
// — can reference it without pulling in realm.ts and its
// `https://cardstack.com/base/*` virtual-module imports.
export type RealmVisibility = 'private' | 'shared' | 'public';
