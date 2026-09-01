// Mirrors the brands in @cardstack/runtime-common so the rule can be exercised
// without depending on that package from the plugin's tests.
export type RealmResourceIdentifier = string & { __rriBrand: unknown };
export type RealmIdentifier = string & { __riBrand: unknown };

export function rri(s: string): RealmResourceIdentifier {
  return s as RealmResourceIdentifier;
}
export function ri(s: string): RealmIdentifier {
  return s as RealmIdentifier;
}
